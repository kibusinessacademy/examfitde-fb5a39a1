// VerwaltungsOS — Voice STT (Cut B1)
// Accepts raw audio body, forwards to ElevenLabs Scribe v2 (deu), returns transcript.
// Tracks audio_too_short as quality_gate fail on the session (mirrors ConversationOS).

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!ELEVENLABS_API_KEY) {
      return new Response(JSON.stringify({ error: 'voice_not_configured' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'auth_required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'invalid_user' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');

    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.startsWith('audio/') && !contentType.startsWith('multipart/')) {
      return new Response(JSON.stringify({ error: 'expected_audio_body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const audioBlob = await req.blob();
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    if (audioBlob.size < 1000) {
      // Quality-gate fail: too short
      if (sessionId) {
        await admin.rpc('fn_emit_audit', {
          _action_type: 'verwaltung_voice_quality_gate_fail',
          _payload: {
            session_id: sessionId,
            reason: 'audio_too_short',
            fails_total: 1,
            caller_role: 'authenticated',
          },
          _target_type: 'verwaltung_oral_session',
          _target_id: sessionId,
        }).then(() => {}).catch(() => {});
      }
      return new Response(JSON.stringify({ error: 'audio_too_short', transcript: '' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (audioBlob.size > 25 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'audio_too_large' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const form = new FormData();
    form.append('file', audioBlob, 'turn.webm');
    form.append('model_id', 'scribe_v2');
    form.append('language_code', 'deu');
    form.append('tag_audio_events', 'false');
    form.append('diarize', 'false');

    const startedAt = Date.now();
    const elResp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body: form,
    });

    if (!elResp.ok) {
      const errTxt = await elResp.text();
      console.error('[vos-stt] elevenlabs error', elResp.status, errTxt);
      return new Response(
        JSON.stringify({ error: 'stt_provider_error', status: elResp.status }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const result = await elResp.json();
    const transcript = (result?.text ?? '').toString().trim();

    // Audit
    admin.rpc('fn_emit_audit', {
      _action_type: 'verwaltung_voice_stt_request',
      _payload: {
        session_id: sessionId,
        audio_bytes: audioBlob.size,
        transcript_length: transcript.length,
        caller_role: 'authenticated',
      },
      _target_type: 'verwaltung_oral_session',
      _target_id: sessionId,
    }).then(() => {}).catch((e) => console.error('[vos-stt] audit error', e));

    return new Response(
      JSON.stringify({
        transcript,
        language: 'deu',
        duration_ms: Date.now() - startedAt,
        audio_bytes: audioBlob.size,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('[vos-stt] handler error', e);
    return new Response(JSON.stringify({ error: 'internal' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
