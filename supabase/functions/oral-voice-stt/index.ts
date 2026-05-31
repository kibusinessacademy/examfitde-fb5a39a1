// ExamFit Oral Voice STT — Cut: Oral Voice Activation v1
// BRIDGE_DONT_FORK: spiegelt verwaltung-voice-stt; ElevenLabs Scribe v2 (deu).

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
const MIN_AUDIO_BYTES = 1000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!ELEVENLABS_API_KEY) {
      return new Response(JSON.stringify({ error: 'voice_not_configured' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'auth_required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'invalid_user' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const audio = await req.arrayBuffer();
    const bytes = audio.byteLength;

    if (bytes > MAX_AUDIO_BYTES) {
      return new Response(JSON.stringify({ error: 'audio_too_large', bytes }), {
        status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (bytes < MIN_AUDIO_BYTES) {
      admin.rpc('fn_emit_audit', {
        _action_type: 'oral_voice_quality_gate_fail',
        _payload: { session_id: sessionId, reason: 'audio_too_short', caller_role: 'authenticated' },
        _target_type: 'oral_exam_session',
        _target_id: sessionId,
      }).then(() => {}).catch(() => {});
      return new Response(JSON.stringify({ error: 'audio_too_short', bytes }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fd = new FormData();
    fd.append('file', new Blob([audio], { type: 'audio/webm' }), 'audio.webm');
    fd.append('model_id', 'scribe_v2');
    fd.append('language_code', 'deu');

    const elResp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body: fd,
    });

    if (!elResp.ok) {
      const errTxt = await elResp.text();
      console.error('[oral-voice-stt] elevenlabs error', elResp.status, errTxt);
      return new Response(
        JSON.stringify({ error: 'stt_provider_error', status: elResp.status }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const json = await elResp.json();
    const transcript = (json.text ?? '').toString().trim();

    if (!transcript || transcript.length < 2) {
      admin.rpc('fn_emit_audit', {
        _action_type: 'oral_voice_quality_gate_fail',
        _payload: { session_id: sessionId, reason: 'empty_transcript', caller_role: 'authenticated' },
        _target_type: 'oral_exam_session',
        _target_id: sessionId,
      }).then(() => {}).catch(() => {});
      return new Response(JSON.stringify({ error: 'empty_transcript', transcript: '' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    admin.rpc('fn_emit_audit', {
      _action_type: 'oral_voice_stt_request',
      _payload: {
        session_id: sessionId,
        audio_bytes: bytes,
        transcript_length: transcript.length,
        caller_role: 'authenticated',
      },
      _target_type: 'oral_exam_session',
      _target_id: sessionId,
    }).then(() => {}).catch(() => {});

    return new Response(JSON.stringify({ transcript, language: json.language_code ?? 'deu' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[oral-voice-stt] handler error', e);
    return new Response(JSON.stringify({ error: 'internal' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
