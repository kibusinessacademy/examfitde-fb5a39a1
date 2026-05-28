// VerwaltungsOS — Realtime WebRTC Token (Cut B2)
// Issues an ElevenLabs Convai conversation token bound to the persona-resolved agent.
// BRIDGE_DONT_FORK: reuses verwaltung-voice-tts auth pattern.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');

interface TokenReq {
  session_id?: string;
  agent_id?: string; // override (admin/debug)
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

    const body = (await req.json().catch(() => ({}))) as TokenReq;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    let personaKey = 'buerger_neutral';
    let agentId: string | null = body.agent_id ?? null;

    if (body.session_id) {
      const { data: session } = await admin
        .from('verwaltung_oral_sessions')
        .select('persona')
        .eq('id', body.session_id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!session) {
        return new Response(JSON.stringify({ error: 'session_not_found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      personaKey = session.persona ?? 'buerger_neutral';
    }

    if (!agentId) {
      const { data: resolved } = await admin.rpc('verwaltung_resolve_persona_agent', {
        _persona: personaKey,
      });
      agentId = (resolved as string | null) ?? null;
    }

    if (!agentId) {
      return new Response(JSON.stringify({
        error: 'agent_not_provisioned',
        persona: personaKey,
        hint: 'Setze elevenlabs_agent_id in public.verwaltung_persona_agent_map für diese Persona.',
      }), {
        status: 412,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Request WebRTC conversation token from ElevenLabs
    const tokenResp = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } },
    );

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      return new Response(JSON.stringify({
        error: 'elevenlabs_token_failed',
        status: tokenResp.status,
        detail: errText.slice(0, 500),
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { token } = await tokenResp.json();

    // Audit
    await admin.rpc('fn_emit_audit', {
      _action_type: 'verwaltung_realtime_token_issued',
      _payload: {
        session_id: body.session_id ?? null,
        persona: personaKey,
        agent_id: agentId,
        caller_role: 'authenticated',
      },
    });

    return new Response(JSON.stringify({
      token,
      agent_id: agentId,
      persona: personaKey,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'internal_error', detail: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
