// ConversationOS — Debrief
// Generates premium debrief: annotated transcript, rubric breakdown,
// critical moments, state trajectory, improvement plan.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'auth_required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const authClient = createClient(SUPABASE_URL, SERVICE_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'invalid_user' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { session_id } = await req.json();
    if (!session_id) return new Response(JSON.stringify({ error: 'session_id_required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Idempotent: return existing
    const { data: existing } = await admin
      .from('conversation_os_debriefs')
      .select('*')
      .eq('session_id', session_id)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ debrief: existing, cached: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: session } = await admin
      .from('conversation_os_sessions')
      .select('*, conversation_os_scenarios(title, situation, scoring_rubric, character_brief, vertical_module)')
      .eq('id', session_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!session) return new Response(JSON.stringify({ error: 'session_not_found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: turns = [] } = await admin
      .from('conversation_os_turns')
      .select('turn_index, role, content, painpoint_triggered, state_snapshot, state_delta, character_variant_applied, metadata')
      .eq('session_id', session_id)
      .order('turn_index', { ascending: true });

    const transcriptText = (turns ?? [])
      .map((t) => `[${t.turn_index}] ${t.role === 'assistant' ? 'CHARAKTER' : 'KANDIDAT'}: ${t.content}${t.painpoint_triggered ? ` [Painpoint: ${t.painpoint_triggered}${t.character_variant_applied ? ' · Charakter-Variante' : ''}]` : ''}`)
      .join('\n');

    const characterName = (session.conversation_os_scenarios?.character_brief as any)?.name ?? 'Charakter';
    const variantTurns = (turns ?? []).filter((t: any) => t.character_variant_applied);

    // Cut E: adaptive context from session.metadata.adaptive
    const sessionMeta = (session.metadata as any) ?? {};
    const adaptive = sessionMeta.adaptive ?? null;
    const userClaims = adaptive?.user_claims ?? [];
    const contradictionPairs: Array<{ topic: string; turn_pos: number; turn_neg: number; quote_pos: string; quote_neg: string }> = [];
    const seenPairs = new Set<string>();
    for (const a of userClaims) {
      for (const b of userClaims) {
        if (a.turn >= b.turn) continue;
        if (a.topic !== b.topic) continue;
        if (a.polarity === b.polarity) continue;
        const key = `${a.topic}|${a.turn}|${b.turn}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        const pos = a.polarity === 'pos' ? a : b;
        const neg = a.polarity === 'neg' ? a : b;
        contradictionPairs.push({
          topic: a.topic,
          turn_pos: pos.turn, quote_pos: pos.quote,
          turn_neg: neg.turn, quote_neg: neg.quote,
        });
      }
    }
    const adaptiveContext = adaptive ? `
Adaptive Engine — Endzustand:
- Hidden States: skepsis=${adaptive.adaptive_state?.skepticism?.toFixed(2)} pressure=${adaptive.adaptive_state?.pressure?.toFixed(2)} interest=${adaptive.adaptive_state?.interest?.toFixed(2)} fatigue=${adaptive.adaptive_state?.fatigue?.toFixed(2)} performance=${adaptive.adaptive_state?.performance_score?.toFixed(2)}
- Finale Phase: ${adaptive.phase} · Momentum: ${adaptive.momentum} · Difficulty: ${adaptive.difficulty} · Character-Drift: ${adaptive.character_drift}
- Live-Outcome-Vorhersage: ${adaptive.outcome_live ?? '(keine)'}
- Erkannte Widersprüche (${contradictionPairs.length}): ${JSON.stringify(contradictionPairs)}
- Drill-Chain Endzustand: ${JSON.stringify(adaptive.drill_chain ?? {})}` : '';


    const rubric = session.conversation_os_scenarios?.scoring_rubric ?? {};
    const rubricDimensions = Object.keys(rubric);

    const startedAt = Date.now();

    // Use tool calling for structured output
    const aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          {
            role: 'system',
            content: `Du bist ein Senior-Coach für berufliche Gesprächsführung. Analysiere ein simuliertes Trainingsgespräch und erstelle ein präzises, ehrliches Debrief auf Premium-Niveau.

Stil: konkret, mit Zitaten aus dem Transcript, ohne Schmeichelei, ohne Allgemeinplätze. Jede Aussage muss aus dem Transcript belegbar sein.

WICHTIG für dramaturgy_patterns: Erkenne nicht nur Schwächen, sondern erkläre Eskalations-KAUSALITÄT. Antworte nicht "Confidence war niedrig", sondern: "Nach Turn 4 wechselte der Kandidat in Konjunktiv ('vielleicht', 'eventuell') — das hat Trust um 0.2 gesenkt und den Recruiter härter nachfragen lassen." Nutze die Painpoint-Aktivierungen und den State-Verlauf als Beweismaterial.

Wenn ein Painpoint als "Charakter-Variante" markiert ist, beschreibe explizit, WIE ${characterName} (im Gegensatz zu einem anderen Charakter) auf dieses Verhalten reagiert hat — Tonalität, Härte, Taktik. Das macht das Lernen charakter-spezifisch und replayable.

Wenn Mikro-State-Signale vorhanden sind (filler_words, subjunctive_cluster, apology_cluster, monologue_excessive, uptalk, time_stalling, name_dropping_no_substance, repetition_loop, high_hedging_density usw.), nutze diese als BEWEISMATERIAL für dramaturgy_patterns — sie sind objektiv detektiert und zeigen, warum der Eindruck atmosphärisch gekippt ist, auch ohne harten Painpoint-Hit. Beispiel: "Turn 5 enthielt 4 Hedging-Wörter + Subjunctive-Cluster — Trust −0.09 atmosphärisch, ohne dass ein Painpoint formal ausgelöst wurde."`,
          },
          {
            role: 'user',
            content: `Szenario: ${session.conversation_os_scenarios?.title}
Situation: ${session.conversation_os_scenarios?.situation}
Bewertungsdimensionen: ${rubricDimensions.join(', ') || 'klarheit, fachlichkeit, verhandlungsstaerke, gelassenheit'}

Transcript:
${transcriptText}

Painpoint-Aktivierungen (Eskalations-Marker mit Turn-Index): ${JSON.stringify(session.painpoint_history ?? [])}
Charakter-Varianten von ${characterName} (Painpoints mit charakter-spezifischer Reaktion statt generischer): ${JSON.stringify(variantTurns.map((t: any) => ({ turn: t.turn_index, painpoint: t.painpoint_triggered, variant: t.metadata?.character_variant ?? null })))}
Mikro-State-Signale pro Kandidaten-Turn (linguistische Marker, die State subtle beeinflussen — z.B. filler_words, subjunctive_cluster, apology_cluster, monologue_excessive): ${JSON.stringify((turns ?? []).filter((t: any) => t.role === 'user' && (t.metadata?.micro_state?.applied_signals?.length ?? 0) > 0).map((t: any) => ({ turn: t.turn_index, signals: t.metadata?.micro_state?.applied_signals ?? [], micro_deltas: t.metadata?.micro_state?.micro_deltas ?? {} })))}
State-Verlauf (Trust/Tension/Confidence/Rapport pro Kandidaten-Turn): ${JSON.stringify((turns ?? []).filter((t: any) => t.role === 'user').map((t: any) => ({ turn: t.turn_index, state: t.state_snapshot, delta: t.state_delta })))}
Finaler interner Zustand: ${JSON.stringify(session.conversation_state)}
${adaptiveContext}

WICHTIG zur Adaptive Engine (Cut E):
- Nutze die Hidden-States (skepsis/pressure/interest/fatigue) als Beweismaterial für recruiter_journey.
- Wenn Widersprüche erkannt wurden, MUSS mindestens ein dramaturgy_pattern oder critical_moment darauf eingehen — mit beiden Zitaten und der Eskalations-Konsequenz.
- adaptive_outcome MUSS ehrlich aus dem Verlauf abgeleitet werden, nicht beschönigt. Wenn der Live-Outcome 'recruiter_disengaged' war, ist das ein klares Signal.
- recruiter_journey beschreibt die Charakter-ENTWICKLUNG: wie der Recruiter sich DURCH den Kandidaten verändert hat (z.B. "Werner startete neutral, wurde nach Turn 5 spürbar skeptischer, in Turn 9 aggressiv — Auslöser waren Widerspruch zu Stabilität + 3 Hedging-Cluster in Folge").

Erstelle das Debrief.`,
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'create_debrief',
              description: 'Strukturiertes Premium-Debrief des Trainingsgesprächs.',
              parameters: {
                type: 'object',
                properties: {
                  executive_summary: {
                    type: 'string',
                    description: '3 Sätze: Gesamteinschätzung, größte Stärke, größte Schwäche.',
                  },
                  rubric_breakdown: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        dimension: { type: 'string' },
                        score: { type: 'number', description: '0-100' },
                        evidence_quote: { type: 'string', description: 'wörtliches Zitat aus Transcript' },
                        why: { type: 'string', description: 'kurze Begründung' },
                      },
                      required: ['dimension', 'score', 'evidence_quote', 'why'],
                    },
                  },
                  critical_moments: {
                    type: 'array',
                    description: 'Top 3 Wendepunkte des Gesprächs.',
                    items: {
                      type: 'object',
                      properties: {
                        turn_index: { type: 'number' },
                        moment_type: { type: 'string', enum: ['turning_point', 'missed_opportunity', 'strong_move', 'critical_error'] },
                        quote: { type: 'string' },
                        analysis: { type: 'string' },
                        better_alternative: { type: 'string' },
                      },
                      required: ['turn_index', 'moment_type', 'quote', 'analysis', 'better_alternative'],
                    },
                  },
                  transcript_annotations: {
                    type: 'array',
                    description: 'Kurze Marker pro relevantem Turn.',
                    items: {
                      type: 'object',
                      properties: {
                        turn_index: { type: 'number' },
                        annotation_type: { type: 'string', enum: ['warning', 'good', 'critical', 'observation'] },
                        note: { type: 'string' },
                      },
                      required: ['turn_index', 'annotation_type', 'note'],
                    },
                  },
                  improvement_plan: {
                    type: 'array',
                    description: '3-4 konkrete nächste Schritte.',
                    items: {
                      type: 'object',
                      properties: {
                        focus: { type: 'string' },
                        why: { type: 'string' },
                        drill_suggestion: { type: 'string' },
                      },
                      required: ['focus', 'why', 'drill_suggestion'],
                    },
                  },
                  dramaturgy_patterns: {
                    type: 'array',
                    description: 'Eskalations-Kausalität. Erkenne sprachliche/strukturelle Muster, die den Gesprächsverlauf erklären. Nur Muster nennen, die tatsächlich im Transcript belegbar sind (>=1 Zitat). Reihenfolge: schwerwiegendste zuerst. Maximal 5.',
                    items: {
                      type: 'object',
                      properties: {
                        pattern_key: { type: 'string', enum: ['evasion', 'hedging', 'missing_concretization', 'defensive_language', 'missing_structure', 'over_apologizing', 'monologue', 'interruption_avoidance', 'rambling', 'name_dropping_without_substance'] },
                        pattern_label: { type: 'string', description: 'kurzer deutscher Klartext-Name, z.B. "Ausweichantworten"' },
                        severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                        frequency: { type: 'number', description: 'Anzahl der Belege im Transcript' },
                        evidence_quotes: { type: 'array', items: { type: 'string' }, description: '1-3 wörtliche Zitate aus Kandidaten-Turns' },
                        state_impact: { type: 'string', description: 'Welche State-Dimension hat das gekippt? (z.B. "Trust -0.3, Tension +0.4 nach Turn 5")' },
                        why_it_escalated: { type: 'string', description: 'Warum hat dieses Muster den Gesprächsdruck erhöht? Konkret, nicht generisch.' },
                        fix: { type: 'string', description: 'Konkrete Alternative-Formulierung oder Technik, die genau dieses Muster ersetzt.' },
                      },
                      required: ['pattern_key', 'pattern_label', 'severity', 'frequency', 'evidence_quotes', 'state_impact', 'why_it_escalated', 'fix'],
                    },
                  },
                  total_score: { type: 'number', description: 'Gewichteter Gesamtscore 0-100' },
                  certificate_eligible: { type: 'boolean', description: 'true wenn ≥75' },
                  adaptive_outcome: {
                    type: 'string',
                    enum: ['strong_overall', 'high_potential_but_risky', 'technically_strong_socially_weak', 'confident_but_vague', 'rejected_due_to_inconsistency', 'promising_under_pressure', 'recruiter_uncertain', 'recruiter_disengaged', 'weak_overall'],
                    description: 'Ehrliches Outcome-Label aus Sicht des Recruiters. Nicht beschönigen — am Live-Outcome + Hidden-States + Widersprüchen orientieren.',
                  },
                  adaptive_outcome_rationale: {
                    type: 'string',
                    description: '2-3 Sätze: warum dieses Outcome — mit Bezug auf Phase-Verlauf, Skepsis/Pressure, Widersprüche, Drift.',
                  },
                  recruiter_journey: {
                    type: 'string',
                    description: 'Wie sich der Charakter DURCH das Gespräch verändert hat — Charakter-Entwicklung mit Turn-Bezug, kausal.',
                  },
                  contradictions_addressed: {
                    type: 'array',
                    description: 'Konkret benannte Widersprüche (falls vorhanden), je mit Topic + früherem + späterem Zitat + Auflösungs-Vorschlag.',
                    items: {
                      type: 'object',
                      properties: {
                        topic: { type: 'string' },
                        earlier_quote: { type: 'string' },
                        later_quote: { type: 'string' },
                        why_problematic: { type: 'string' },
                        resolution_advice: { type: 'string' },
                      },
                      required: ['topic', 'earlier_quote', 'later_quote', 'why_problematic', 'resolution_advice'],
                    },
                  },
                },
                required: ['executive_summary', 'rubric_breakdown', 'critical_moments', 'transcript_annotations', 'improvement_plan', 'dramaturgy_patterns', 'total_score', 'certificate_eligible', 'adaptive_outcome', 'adaptive_outcome_rationale', 'recruiter_journey'],
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'create_debrief' } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: 'payment_required' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const errTxt = await aiResp.text();
      console.error('debrief AI error', aiResp.status, errTxt);
      return new Response(JSON.stringify({ error: 'ai_gateway_error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.error('no tool_call in debrief response', JSON.stringify(aiJson).slice(0, 500));
      return new Response(JSON.stringify({ error: 'debrief_generation_failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const parsed = JSON.parse(toolCall.function.arguments);

    // State trajectory from turns
    const stateTrajectory = (turns ?? [])
      .filter((t) => t.role === 'user')
      .map((t) => ({ turn_index: t.turn_index, ...(t.state_snapshot as any) }));

    // Persist debrief
    const { data: debrief, error: dbErr } = await admin
      .from('conversation_os_debriefs')
      .insert({
        session_id,
        user_id: user.id,
        executive_summary: parsed.executive_summary,
        rubric_breakdown: parsed.rubric_breakdown,
        critical_moments: parsed.critical_moments,
        transcript_annotations: parsed.transcript_annotations,
        improvement_plan: parsed.improvement_plan,
        dramaturgy_patterns: parsed.dramaturgy_patterns ?? [],
        state_trajectory: stateTrajectory,
        certificate_eligible: parsed.certificate_eligible,
        generated_by_model: 'google/gemini-2.5-pro',
        generation_ms: Date.now() - startedAt,
      })
      .select()
      .single();

    if (dbErr) {
      console.error('debrief insert', dbErr);
      return new Response(JSON.stringify({ error: 'debrief_persist_failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Update session
    await admin
      .from('conversation_os_sessions')
      .update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        total_score: parsed.total_score,
        rubric_scores: parsed.rubric_breakdown.reduce((acc: any, r: any) => ({ ...acc, [r.dimension]: r.score }), {}),
      })
      .eq('id', session_id);

    return new Response(JSON.stringify({
      debrief,
      cached: false,
      character_variant_meta: {
        character_name: characterName,
        variants_used: variantTurns.length,
        variant_painpoints: Array.from(new Set(variantTurns.map((t: any) => t.painpoint_triggered).filter(Boolean))),
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('debrief error', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
