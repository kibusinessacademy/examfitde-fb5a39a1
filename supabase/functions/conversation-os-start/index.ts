// ConversationOS — Start Session
// Creates a session for an authenticated user against a published scenario.
// Initializes conversation_state and produces the opening character turn.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

interface StartReq {
  scenario_id: string;
  context_overrides?: {
    position?: string;
    branche?: string;
    seniority?: string;
    notes?: string;
  };
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'auth_required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const authClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await authClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'invalid_user' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as StartReq;
    if (!body?.scenario_id || typeof body.scenario_id !== 'string') {
      return new Response(JSON.stringify({ error: 'scenario_id_required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load scenario
    const { data: scenario, error: scnErr } = await admin
      .from('conversation_os_scenarios')
      .select('id, scenario_key, vertical_module, persona, title, situation, character_brief, lead_prompts, scoring_rubric, status')
      .eq('id', body.scenario_id)
      .eq('status', 'published')
      .maybeSingle();

    if (scnErr || !scenario) {
      return new Response(JSON.stringify({ error: 'scenario_not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sanitize context overrides
    const ctx = body.context_overrides ?? {};
    const cleanCtx = {
      position: typeof ctx.position === 'string' ? ctx.position.slice(0, 120).trim() : undefined,
      branche: typeof ctx.branche === 'string' ? ctx.branche.slice(0, 80).trim() : undefined,
      seniority: typeof ctx.seniority === 'string' ? ctx.seniority.slice(0, 40).trim() : undefined,
      notes: typeof ctx.notes === 'string' ? ctx.notes.slice(0, 400).trim() : undefined,
    };
    const ctxLine = [
      cleanCtx.position ? `Gesuchte Position: ${cleanCtx.position}` : null,
      cleanCtx.branche ? `Branche: ${cleanCtx.branche}` : null,
      cleanCtx.seniority ? `Seniorität: ${cleanCtx.seniority}` : null,
      cleanCtx.notes ? `Zusatz-Kontext: ${cleanCtx.notes}` : null,
    ].filter(Boolean).join(' · ');

    // Create session
    const { data: session, error: sessErr } = await admin
      .from('conversation_os_sessions')
      .insert({
        user_id: user.id,
        scenario_id: scenario.id,
        vertical_module: scenario.vertical_module,
        status: 'active',
        conversation_state: { trust: 0.5, tension: 0.3, confidence: 0.5, rapport: 0.5 },
        metadata: { context_overrides: cleanCtx },
      })
      .select()
      .single();

    if (sessErr || !session) {
      console.error('session insert failed', sessErr);
      return new Response(JSON.stringify({ error: 'session_create_failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Opening turn — pick first lead_prompt or generate via LLM
    const leadPrompts = Array.isArray(scenario.lead_prompts) ? scenario.lead_prompts : [];
    let opening: string;

    if (leadPrompts.length > 0 && typeof leadPrompts[0] === 'string') {
      opening = leadPrompts[0];
    } else if (leadPrompts.length > 0 && typeof leadPrompts[0]?.prompt === 'string') {
      opening = leadPrompts[0].prompt;
    } else {
      // Generate opening line from character_brief + context overrides
      const brief = scenario.character_brief ?? {};
      const sysPrompt = `Du bist ${brief.name ?? 'der Charakter'} in folgender Situation: ${scenario.situation}\nRolle: ${brief.role ?? scenario.persona}\nStil: ${brief.tone ?? 'professionell, präzise'}\n${ctxLine ? `\nKontext (in dein Verhalten integrieren, nicht 1:1 wiederholen): ${ctxLine}` : ''}\n\nFormuliere eine SEHR KURZE Eröffnungs-Frage oder -Aussage in Rolle (max. 1-2 Sätze, kein Smalltalk).`;

      const aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: 'Eröffne das Gespräch.' }],
        }),
      });
      if (!aiResp.ok) {
        opening = 'Guten Tag. Erzählen Sie mir von sich.';
      } else {
        const j = await aiResp.json();
        opening = j.choices?.[0]?.message?.content?.trim() || 'Guten Tag. Erzählen Sie mir von sich.';
      }
    }

    // Insert opening turn (assistant role)
    const { error: turnErr } = await admin.from('conversation_os_turns').insert({
      session_id: session.id,
      user_id: user.id,
      turn_index: 0,
      role: 'assistant',
      content: opening,
      state_snapshot: session.conversation_state,
      model_used: 'opening',
    });
    if (turnErr) console.error('opening turn insert failed', turnErr);

    await admin
      .from('conversation_os_sessions')
      .update({ turn_count: 1 })
      .eq('id', session.id);

    return new Response(
      JSON.stringify({
        session_id: session.id,
        opening,
        conversation_state: session.conversation_state,
        scenario: {
          title: scenario.title,
          situation: scenario.situation,
          vertical_module: scenario.vertical_module,
          character_brief: scenario.character_brief,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('start error', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
