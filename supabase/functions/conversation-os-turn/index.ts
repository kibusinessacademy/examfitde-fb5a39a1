// ConversationOS — Turn (SSE streaming)
// Receives user turn → runs deterministic painpoint detection → updates state →
// streams character response token-by-token.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

interface TurnReq {
  session_id: string;
  message: string;
}

type State = { trust: number; tension: number; confidence: number; rapport: number };

const clamp = (v: number) => Math.max(0, Math.min(1, v));

// ============================================================
// Input Quality Gate — pre-LLM filter for empty/gibberish/evasion answers
// Returns null if input passes, otherwise a structured refusal payload.
// ============================================================
type GateResult =
  | { ok: true }
  | { ok: false; reason: 'too_short' | 'gibberish' | 'silence'; refusalLine: string };

function runInputQualityGate(raw: string, characterName: string): GateResult {
  const t = (raw ?? '').trim();
  if (t.length === 0) {
    return {
      ok: false,
      reason: 'silence',
      refusalLine: `${characterName ? characterName + ': ' : ''}Ich höre nichts. Bitte antworten Sie auf meine Frage — sonst breche ich das Gespräch ab.`,
    };
  }
  const wc = t.split(/\s+/).filter(Boolean).length;
  // Pure gibberish: single token with no vowels or > 12 chars and no recognisable word boundary
  const onlyToken = t.replace(/[^a-zäöüßA-ZÄÖÜ]/g, '');
  if (wc <= 1 && onlyToken.length > 0 && !/[aeiouäöü]/i.test(onlyToken)) {
    return {
      ok: false,
      reason: 'gibberish',
      refusalLine: `Das war keine Antwort. Ich frage konkret: bitte formulieren Sie einen ganzen Satz, sonst breche ich das Gespräch ab.`,
    };
  }
  if (wc < 2 && t.length < 6) {
    return {
      ok: false,
      reason: 'too_short',
      refusalLine: `Ein Wort reicht nicht. Bitte begründen Sie Ihre Position — sonst kann ich dieses Gespräch nicht ernst nehmen.`,
    };
  }
  // Random-key smash: very low vowel ratio in long token
  if (wc <= 2 && onlyToken.length >= 4) {
    const vowels = (onlyToken.match(/[aeiouäöü]/gi) ?? []).length;
    if (vowels / onlyToken.length < 0.15) {
      return {
        ok: false,
        reason: 'gibberish',
        refusalLine: `Bitte schreiben Sie eine echte Antwort. Ich werde nicht auf zufällige Tasten reagieren.`,
      };
    }
  }
  return { ok: true };
}

// ============================================================
// Deterministic User Signal Detector
// Rule-based; no LLM. Returns set of signal flags from user text.
// ============================================================
function detectUserSignals(text: string, lastAssistantContent: string): Set<string> {
  const signals = new Set<string>();
  const t = text.toLowerCase().trim();
  const wc = t.split(/\s+/).filter(Boolean).length;

  // Vagueness / avoidance
  if (wc < 8) signals.add('wordcount_low');
  if (/\b(irgendwie|so ungefähr|ein bisschen|relativ|vielleicht|eventuell|grundsätzlich|prinzipiell)\b/.test(t))
    signals.add('vague_quantifier');
  if (/\b(könnte|würde|hätte|sollte|möglicherweise|denke ich|glaube ich|vermutlich)\b/.test(t))
    signals.add('hedging_words');

  // Numbers — for salary scenarios
  const hasNumber = /\b\d{2,6}(\.\d{3})?\b|\beuro\b|\b€\b/.test(t);
  const numberQuestionContext = /(gehalt|wunschgehalt|vorstellung|zahl|betrag|euro)/.test(lastAssistantContent.toLowerCase());
  if (numberQuestionContext && !hasNumber) signals.add('user_avoids_number');
  if (numberQuestionContext && hasNumber) signals.add('user_provides_number');

  // Justification / defensiveness
  if (/\b(aber|allerdings|jedoch|trotzdem|natürlich nicht|so war das nicht)\b/.test(t)) {
    if (wc > 15) signals.add('justification_excess');
  }

  // Blame shift
  if (/\b(mein chef|mein vorgesetzter|das team|die kollegen|der kunde war|die firma)\b.*\b(falsch|schlecht|problem|schuld|nicht)\b/.test(t)) {
    signals.add('external_blame');
  }

  // Concrete example
  if (!/\b(zum beispiel|beispielsweise|konkret|einmal als|damals als|in dem projekt|bei firma)\b/.test(t)) {
    signals.add('no_concrete_example');
  }

  // Superlatives / overconfidence
  if (/\b(immer|nie|am besten|herausragend|exzellent|perfekt|der beste|absolute spitze)\b/.test(t)) {
    signals.add('superlative_overuse');
  }

  // Topic drift detection — does response share keywords with question?
  const questionWords = lastAssistantContent.toLowerCase().match(/\b[a-zäöüß]{5,}\b/g) ?? [];
  const answerWords = new Set(t.match(/\b[a-zäöüß]{5,}\b/g) ?? []);
  const overlap = questionWords.filter((w) => answerWords.has(w)).length;
  if (questionWords.length >= 4 && overlap === 0) signals.add('topic_drift');

  // Sandwich / euphemism (Leadership)
  if (/\b(eigentlich gut|im großen und ganzen|grundsätzlich positiv|sehr gut, aber|nur)\b/.test(t)) {
    signals.add('sandwich_overuse');
  }

  return signals;
}

// ============================================================
// Painpoint Selection — deterministic, rule + state threshold
// ============================================================
function selectPainpoint(
  signals: Set<string>,
  state: State,
  painpoints: any[],
  activationCounts: Record<string, number>,
  recentTurnIndex: number,
  lastActivations: Record<string, number>,
): any | null {
  const candidates: { pp: any; score: number }[] = [];

  for (const pp of painpoints) {
    // Cooldown check
    const lastActiveAt = lastActivations[pp.painpoint_key] ?? -999;
    if (recentTurnIndex - lastActiveAt < pp.cooldown_turns) continue;

    // Max activations
    const count = activationCounts[pp.painpoint_key] ?? 0;
    if (count >= pp.max_activations_per_session) continue;

    const triggers: string[] = Array.isArray(pp.trigger_conditions) ? pp.trigger_conditions : [];
    let matchScore = 0;

    for (const trig of triggers) {
      // State threshold conditions: "state.trust<0.4"
      const stateMatch = trig.match(/^state\.(trust|tension|confidence|rapport)([<>])(-?\d*\.?\d+)$/);
      if (stateMatch) {
        const key = stateMatch[1] as keyof State;
        const op = stateMatch[2];
        const val = parseFloat(stateMatch[3]);
        if (op === '<' && state[key] < val) matchScore += 1;
        if (op === '>' && state[key] > val) matchScore += 1;
        continue;
      }
      // Signal flag
      if (signals.has(trig)) matchScore += 1;
    }

    // Require at least one trigger to fire
    if (matchScore > 0) candidates.push({ pp, score: matchScore });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].pp;
}

function applyStateDeltas(state: State, deltas: Record<string, number>): State {
  return {
    trust: clamp(state.trust + (deltas.trust ?? 0)),
    tension: clamp(state.tension + (deltas.tension ?? 0)),
    confidence: clamp(state.confidence + (deltas.confidence ?? 0)),
    rapport: clamp(state.rapport + (deltas.rapport ?? 0)),
  };
}

// ============================================================
// Main handler
// ============================================================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'auth_required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const authClient = createClient(SUPABASE_URL, SERVICE_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'invalid_user' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = (await req.json()) as TurnReq;
    if (!body?.session_id || !body?.message) {
      return new Response(JSON.stringify({ error: 'session_id_and_message_required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Load session + scenario + painpoints
    const { data: session } = await admin
      .from('conversation_os_sessions')
      .select('*, conversation_os_scenarios(*)')
      .eq('id', body.session_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!session) return new Response(JSON.stringify({ error: 'session_not_found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (session.status !== 'active') return new Response(JSON.stringify({ error: 'session_not_active' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const scenario = session.conversation_os_scenarios;
    const characterName = (scenario?.character_brief as any)?.name ?? 'Charakter';

    // ============================================================
    // INPUT QUALITY GATE — runs before painpoint detection & LLM
    // ============================================================
    const gate = runInputQualityGate(body.message, characterName);
    if (!gate.ok) {
      const prevFails = (session as any).quality_gate_fails ?? 0;
      const newFails = prevFails + 1;
      const abort = newFails >= 3;

      // Penalise state hard
      const penalisedState: State = {
        trust: clamp((session.conversation_state as State).trust - 0.15),
        tension: clamp((session.conversation_state as State).tension + 0.2),
        confidence: clamp((session.conversation_state as State).confidence - 0.05),
        rapport: clamp((session.conversation_state as State).rapport - 0.1),
      };

      const userIdx = (session.turn_count as number) ?? 0;
      await admin.from('conversation_os_turns').insert({
        session_id: session.id,
        user_id: user.id,
        turn_index: userIdx,
        role: 'user',
        content: body.message,
        state_snapshot: penalisedState,
        state_delta: { trust: -0.15, tension: +0.2 },
        scoring_delta: { quality_gate_fail: true, reason: gate.reason, fail_count: newFails },
        metadata: { quality_gate: gate.reason },
      });

      const refusalText = abort
        ? `${gate.refusalLine}\n\nIch beende dieses Gespräch hier. Wir haben offensichtlich keine Gesprächsgrundlage.`
        : gate.refusalLine;

      await admin.from('conversation_os_turns').insert({
        session_id: session.id,
        user_id: user.id,
        turn_index: userIdx + 1,
        role: 'assistant',
        content: refusalText,
        state_snapshot: penalisedState,
        scoring_delta: { quality_gate_refusal: true, abort },
        model_used: 'quality_gate',
      });

      await admin
        .from('conversation_os_sessions')
        .update({
          conversation_state: penalisedState,
          quality_gate_fails: newFails,
          turn_count: userIdx + 2,
          user_turn_count: ((session.user_turn_count as number) ?? 0) + 1,
          status: abort ? 'aborted_by_character' : session.status,
          finished_at: abort ? new Date().toISOString() : null,
        })
        .eq('id', session.id);

      // Return a synthetic SSE stream so the client UI behaves identically
      const encoder = new TextEncoder();
      const synthChunk = `data: ${JSON.stringify({ choices: [{ delta: { content: refusalText } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(encoder.encode(synthChunk), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'x-conv-painpoint': `quality_gate_${gate.reason}`,
          'x-conv-state': JSON.stringify(penalisedState),
          'x-conv-aborted': abort ? '1' : '0',
          'x-conv-quality-gate': gate.reason,
        },
      });
    }

    // Load painpoints for this vertical
    const { data: painpoints = [] } = await admin
      .from('conversation_os_painpoint_graphs')
      .select('*')
      .eq('vertical_module', scenario.vertical_module)
      .eq('is_active', true);

    // Load turn history (last 12 turns for context)
    const { data: turns = [] } = await admin
      .from('conversation_os_turns')
      .select('turn_index, role, content, painpoint_triggered')
      .eq('session_id', session.id)
      .order('turn_index', { ascending: true });

    const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant');
    const lastAssistantContent = lastAssistant?.content ?? '';

    const currentTurnIndex = (session.turn_count as number) ?? turns.length;
    const userTurnIndex = currentTurnIndex;

    // 1) Detect user signals
    const signals = detectUserSignals(body.message, lastAssistantContent);

    // 2) Select painpoint
    const lastActivations: Record<string, number> = {};
    for (const t of turns) {
      if (t.painpoint_triggered) lastActivations[t.painpoint_triggered] = t.turn_index;
    }
    const activationCounts = (session.painpoint_activation_counts as Record<string, number>) ?? {};

    let currentState = session.conversation_state as State;
    const selectedPp = selectPainpoint(signals, currentState, painpoints ?? [], activationCounts, currentTurnIndex, lastActivations);

    // 3) Apply state delta
    let stateDelta: Record<string, number> = {};
    let painpointTriggered: string | null = null;
    if (selectedPp) {
      stateDelta = selectedPp.state_deltas ?? {};
      painpointTriggered = selectedPp.painpoint_key;
      currentState = applyStateDeltas(currentState, stateDelta);
    }

    // 4) Insert user turn
    await admin.from('conversation_os_turns').insert({
      session_id: session.id,
      user_id: user.id,
      turn_index: userTurnIndex,
      role: 'user',
      content: body.message,
      state_snapshot: currentState,
      state_delta: stateDelta,
      painpoint_triggered: painpointTriggered,
      metadata: { signals: Array.from(signals) },
    });

    // 5) Build character system prompt with state + painpoint guidance
    const brief = scenario.character_brief ?? {};
    const stateDescription = `[Interner Zustand — beeinflusst deine Tonalität, niemals direkt aussprechen]
Trust: ${currentState.trust.toFixed(2)} | Tension: ${currentState.tension.toFixed(2)} | Confidence (Gegenüber): ${currentState.confidence.toFixed(2)} | Rapport: ${currentState.rapport.toFixed(2)}`;

    let painpointInjection = '';
    if (selectedPp) {
      const reaction = selectedPp.character_reaction ?? {};
      painpointInjection = `\n\n[AKTIVER PAINPOINT: ${selectedPp.painpoint_key}]
Tonalitäts-Shift: ${reaction.tone_shift ?? 'neutral'}
Druck-Level: ${reaction.pressure_level ?? 0}
Taktik: ${reaction.tactic ?? 'fortsetzen'}
Orientierungs-Linie (NICHT wörtlich übernehmen, nur Richtung): "${reaction.line_template ?? ''}"
=> Reagiere konsequent mit dieser Taktik. Bleibe in Rolle. Kurz, präzise, ohne Smalltalk.`;
    }

    const ctxOverrides = (session.metadata as any)?.context_overrides ?? {};
    const ctxLine = [
      ctxOverrides.position ? `Gesuchte Position: ${ctxOverrides.position}` : null,
      ctxOverrides.branche ? `Branche: ${ctxOverrides.branche}` : null,
      ctxOverrides.seniority ? `Seniorität: ${ctxOverrides.seniority}` : null,
      ctxOverrides.notes ? `Zusatz-Kontext: ${ctxOverrides.notes}` : null,
    ].filter(Boolean).join(' · ');

    const sysPrompt = `Du bist ${brief.name ?? 'der Charakter'} (${brief.role ?? scenario.persona}) in folgender Situation:
${scenario.situation}${ctxLine ? `\n\nGesprächskontext (in deine Rolle integrieren, nicht 1:1 wiederholen): ${ctxLine}` : ''}

Charakter-Profil:
- Tonalität: ${brief.tone ?? 'professionell, präzise'}
- Ziele: ${Array.isArray(brief.goals) ? brief.goals.join(', ') : 'realistisch reagieren'}
${brief.background ? `- Hintergrund: ${brief.background}` : ''}

${stateDescription}
${painpointInjection}

REGELN:
- Antworte in 1-3 Sätzen, maximal 4. Niemals Romane.
- Bleibe immer in Rolle. Brich niemals die vierte Wand.
- Spreche niemals deinen internen Zustand aus.
- Nutze deutsche Sprache, ${brief.formality ?? 'Sie-Form'}.`;

    const llmMessages = [
      { role: 'system', content: sysPrompt },
      ...turns.map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', content: t.content })),
      { role: 'user', content: body.message },
    ];

    // 6) Stream from Lovable AI
    const aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: llmMessages,
        stream: true,
      }),
    });

    if (!aiResp.ok || !aiResp.body) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: 'payment_required' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'ai_gateway_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Tee the stream: forward to client AND collect for DB persistence
    let assembledContent = '';
    const startedAt = Date.now();

    const transformer = new TransformStream({
      transform(chunk, controller) {
        const decoder = new TextDecoder();
        const text = decoder.decode(chunk, { stream: true });
        // Parse SSE lines to extract content for assembly
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json || json === '[DONE]') continue;
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) assembledContent += delta;
          } catch { /* partial chunk, ignore */ }
        }
        // Forward chunk untouched
        controller.enqueue(chunk);
      },
      async flush() {
        // Persist assistant turn + update session
        const newAssistantIndex = userTurnIndex + 1;
        const newTurnCount = newAssistantIndex + 1;
        const newPainpointHistory = [
          ...((session.painpoint_history as any[]) ?? []),
          ...(painpointTriggered ? [{ turn_index: userTurnIndex, painpoint_key: painpointTriggered, at: new Date().toISOString() }] : []),
        ];
        const newActivationCounts = { ...activationCounts };
        if (painpointTriggered) {
          newActivationCounts[painpointTriggered] = (newActivationCounts[painpointTriggered] ?? 0) + 1;
        }

        await admin.from('conversation_os_turns').insert({
          session_id: session.id,
          user_id: user.id,
          turn_index: newAssistantIndex,
          role: 'assistant',
          content: assembledContent || '...',
          state_snapshot: currentState,
          latency_ms: Date.now() - startedAt,
          model_used: 'google/gemini-3-flash-preview',
        });

        await admin
          .from('conversation_os_sessions')
          .update({
            conversation_state: currentState,
            painpoint_history: newPainpointHistory,
            painpoint_activation_counts: newActivationCounts,
            active_painpoint_id: selectedPp?.id ?? null,
            turn_count: newTurnCount,
            user_turn_count: (session.user_turn_count as number ?? 0) + 1,
            quality_gate_fails: 0, // reset on any successful substantive turn

          })
          .eq('id', session.id);
      },
    });

    const sseStream = aiResp.body.pipeThrough(transformer);

    return new Response(sseStream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        // Meta header so client can show state delta without parsing full stream
        'x-conv-painpoint': painpointTriggered ?? '',
        'x-conv-state': JSON.stringify(currentState),
        'x-conv-voice-id': (scenario?.character_brief as any)?.voice_id ?? '',
      },
    });
  } catch (e) {
    console.error('turn error', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
