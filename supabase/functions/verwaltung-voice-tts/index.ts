// VerwaltungsOS — Voice TTS (Cut B1)
// Streams MP3 from ElevenLabs Turbo v2.5. Voice resolved from session.persona
// via verwaltung_persona_voice_id(), tuned by escalation_state + conflict_level.
// Mirrors conversation-os-tts pattern (BRIDGE_DONT_FORK).

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');

const DEFAULT_VOICE_ID = 'nPczCjzI2devNBz1zQrb'; // Brian

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

    const body = (await req.json()) as TtsReq;
    if (!body?.text || typeof body.text !== 'string') {
      return new Response(JSON.stringify({ error: 'text_required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const text = body.text.slice(0, 4000);

    let voiceId = body.voice_id ?? DEFAULT_VOICE_ID;
    let stability = 0.5;
    let style = 0.4;
    let personaKey = 'buerger_neutral';

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    if (body.session_id) {
      const { data: session } = await admin
        .from('verwaltung_oral_sessions')
        .select('persona, conflict_level, escalation_state, scenario_snapshot')
        .eq('id', body.session_id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (session) {
        personaKey = session.persona ?? 'buerger_neutral';
        const snapshotVoice = (session.scenario_snapshot as any)?.voice_id;
        if (snapshotVoice) {
          voiceId = snapshotVoice;
        } else {
          const { data: voiceRow } = await admin
            .rpc('verwaltung_persona_voice_id', { _persona: personaKey });
          if (voiceRow && typeof voiceRow === 'string') voiceId = voiceRow;
        }

        const esc = Number(session.escalation_state ?? 0);
        const high = session.conflict_level === 'high';
        if (esc >= 3 || high) {
          stability = 0.3;
          style = 0.7;
        } else if (esc >= 2) {
          stability = 0.4;
          style = 0.55;
        }
      }
    }

    const elResp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability,
            similarity_boost: 0.75,
            style,
            use_speaker_boost: true,
          },
        }),
      },
    );

    if (!elResp.ok || !elResp.body) {
      const errTxt = await elResp.text();
      console.error('[vos-tts] elevenlabs error', elResp.status, errTxt);
      return new Response(
        JSON.stringify({ error: 'tts_provider_error', status: elResp.status }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fire-and-forget audit
    admin.rpc('fn_emit_audit', {
      _action_type: 'verwaltung_voice_tts_request',
      _payload: {
        session_id: body.session_id ?? null,
        persona: personaKey,
        voice_id: voiceId,
        text_length: text.length,
        caller_role: 'authenticated',
      },
      _target_type: 'verwaltung_oral_session',
      _target_id: body.session_id ?? null,
    }).then(() => {}).catch((e) => console.error('[vos-tts] audit error', e));

    return new Response(elResp.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'x-vos-voice-id': voiceId,
        'x-vos-persona': personaKey,
      },
    });
  } catch (e) {
    console.error('[vos-tts] handler error', e);
    return new Response(JSON.stringify({ error: 'internal' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
