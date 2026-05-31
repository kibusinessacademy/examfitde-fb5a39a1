// ExamFit Oral Voice TTS — Cut: Oral Voice Activation v1
// BRIDGE_DONT_FORK: spiegelt verwaltung-voice-tts; resolved Persona aus oral_exam_session_templates.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');

const DEFAULT_VOICE_ID = 'nPczCjzI2devNBz1zQrb';

interface TtsReq {
  session_id?: string;
  text: string;
  voice_id?: string;
}

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

    const body = (await req.json()) as TtsReq;
    if (!body?.text || typeof body.text !== 'string') {
      return new Response(JSON.stringify({ error: 'text_required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const text = body.text.slice(0, 4000);

    let voiceId = body.voice_id ?? DEFAULT_VOICE_ID;
    let stability = 0.5;
    let style = 0.4;
    let examinerMode = 'sachlich';
    let stressLevel = '1';

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    if (body.session_id) {
      const { data: ctx } = await admin.rpc('fn_oral_session_voice_context', {
        _session_id: body.session_id,
      });
      const row = Array.isArray(ctx) ? ctx[0] : ctx;
      if (row) {
        if (row.user_id && row.user_id !== user.id) {
          return new Response(JSON.stringify({ error: 'forbidden' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (!body.voice_id && row.voice_id) voiceId = row.voice_id;
        examinerMode = row.examiner_mode ?? examinerMode;
        stressLevel = String(row.stress_level ?? stressLevel);

        const sl = Number(stressLevel);
        const high = stressLevel === 'high' || sl >= 3;
        const mod = stressLevel === 'moderate' || sl === 2;
        if (high) { stability = 0.3; style = 0.7; }
        else if (mod) { stability = 0.4; style = 0.55; }
      }
    }

    const elResp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability, similarity_boost: 0.75, style, use_speaker_boost: true },
        }),
      },
    );

    if (!elResp.ok || !elResp.body) {
      const errTxt = await elResp.text();
      console.error('[oral-voice-tts] elevenlabs error', elResp.status, errTxt);
      return new Response(
        JSON.stringify({ error: 'tts_provider_error', status: elResp.status }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    admin.rpc('fn_emit_audit', {
      _action_type: 'oral_voice_tts_request',
      _payload: {
        session_id: body.session_id ?? null,
        examiner_mode: examinerMode,
        stress_level: stressLevel,
        voice_id: voiceId,
        text_length: text.length,
        caller_role: 'authenticated',
      },
      _target_type: 'oral_exam_session',
      _target_id: body.session_id ?? null,
    }).then(() => {}).catch((e) => console.error('[oral-voice-tts] audit', e));

    return new Response(elResp.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'x-oral-voice-id': voiceId,
        'x-oral-examiner-mode': examinerMode,
        'x-oral-stress-level': stressLevel,
      },
    });
  } catch (e) {
    console.error('[oral-voice-tts] handler error', e);
    return new Response(JSON.stringify({ error: 'internal' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
