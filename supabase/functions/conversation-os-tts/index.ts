// ConversationOS — Text-to-Speech
// Looks up scenario voice_id, streams MP3 from ElevenLabs Turbo v2.5.
// Voice settings dynamically tuned by session state (tension/trust).

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');

// Default voice fallback (Brian — neutral male German-capable)
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
    const text = body.text.slice(0, 4000); // hard cap

    // Resolve voice_id + tune voice settings from session state
    let voiceId = body.voice_id ?? DEFAULT_VOICE_ID;
    let stability = 0.5;
    let style = 0.4;

    if (body.session_id) {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: session } = await admin
        .from('conversation_os_sessions')
        .select('conversation_state, conversation_os_scenarios(character_brief)')
        .eq('id', body.session_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (session) {
        const brief: any = (session as any).conversation_os_scenarios?.character_brief ?? {};
        if (brief.voice_id) voiceId = brief.voice_id;
        const state: any = session.conversation_state ?? {};
        const tension = Number(state.tension ?? 0.3);
        const trust = Number(state.trust ?? 0.5);
        // Higher tension or low trust → sharper, less stable voice
        if (tension > 0.7 || trust < 0.3) {
          stability = 0.3;
          style = 0.7;
        } else if (tension > 0.5) {
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
      console.error('[tts] elevenlabs error', elResp.status, errTxt);
      return new Response(JSON.stringify({ error: 'tts_provider_error', status: elResp.status }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(elResp.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[tts] handler error', e);
    return new Response(JSON.stringify({ error: 'internal' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
