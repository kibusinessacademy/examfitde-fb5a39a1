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
// Deterministic User Signal Detector — Cut C: erweiterte linguistic markers
// Rule-based; no LLM. Returns set of signal flags from user text.
// ============================================================
function detectUserSignals(text: string, lastAssistantContent: string): Set<string> {
  const signals = new Set<string>();
  const raw = text.trim();
  const t = raw.toLowerCase();
  const wc = t.split(/\s+/).filter(Boolean).length;

  // --- Vagueness / avoidance ---
  if (wc < 8) signals.add('wordcount_low');
  if (/\b(irgendwie|so ungefähr|ein bisschen|relativ|vielleicht|eventuell|grundsätzlich|prinzipiell)\b/.test(t))
    signals.add('vague_quantifier');

  // Hedging — count occurrences for density
  const hedgingRe = /\b(könnte|würde|hätte|sollte|möglicherweise|denke ich|glaube ich|vermutlich|wahrscheinlich|gewissermaßen|sozusagen)\b/g;
  const hedgingHits = (t.match(hedgingRe) ?? []).length;
  if (hedgingHits >= 1) signals.add('hedging_words');
  if (hedgingHits >= 3 || (wc > 0 && hedgingHits / wc > 0.12)) signals.add('high_hedging_density');

  // Subjunctive clustering — ≥2 distinct Konjunktiv-II verbs in same turn
  const subjMatches = new Set((t.match(/\b(würde|hätte|könnte|sollte|wäre|müsste|dürfte|möchte)\b/g) ?? []));
  if (subjMatches.size >= 2) signals.add('subjunctive_cluster');

  // --- Filler / stalling ---
  if (/\b(äh+|ähm+|hm+|also halt|ja eben|so quasi)\b/.test(t)) signals.add('filler_words');
  if (/\b(lassen sie mich überlegen|gute frage|moment mal|wie soll ich sagen|wie sagt man)\b/.test(t))
    signals.add('time_stalling');

  // Self-correction
  if (/\b(ich meine|also nein|korrekt|äh nein|moment, ich)\b/.test(t)) signals.add('self_correction');

  // Apology cluster — ≥2 markers
  const apologyHits = (t.match(/\b(entschuldigung|tut mir leid|sorry|verzeihen sie|pardon)\b/g) ?? []).length;
  if (apologyHits >= 1) signals.add('apology_words');
  if (apologyHits >= 2) signals.add('apology_cluster');

  // Uptalk — statement that ends with question mark (likely upward inflection in voice mode)
  if (/[a-zäöü][^?!]{15,}\?\s*$/.test(raw) && !/\b(wie|was|warum|wann|wo|wer|wieso|weshalb)\b/.test(t.slice(0, 40))) {
    signals.add('uptalk');
  }

  // Monologue length
  if (wc > 80) signals.add('monologue_length');
  if (wc > 140) signals.add('monologue_excessive');

  // Repetition — same 5+ char word repeated ≥3 times
  const wordCounts: Record<string, number> = {};
  for (const w of t.match(/\b[a-zäöüß]{5,}\b/g) ?? []) wordCounts[w] = (wordCounts[w] ?? 0) + 1;
  if (Object.values(wordCounts).some((c) => c >= 3)) signals.add('repetition_loop');

  // --- Numbers / substance (sales/negotiation) ---
  const hasNumber = /\b\d{2,6}(\.\d{3})?\b|\beuro\b|\b€\b/.test(t);
  const numberQuestionContext = /(gehalt|wunschgehalt|vorstellung|zahl|betrag|euro|preis|budget)/.test(lastAssistantContent.toLowerCase());
  if (numberQuestionContext && !hasNumber) signals.add('user_avoids_number');
  if (numberQuestionContext && hasNumber) signals.add('user_provides_number');

  // --- Justification / defensiveness ---
  if (/\b(aber|allerdings|jedoch|trotzdem|natürlich nicht|so war das nicht)\b/.test(t)) {
    if (wc > 15) signals.add('justification_excess');
  }

  // Blame shift
  if (/\b(mein chef|mein vorgesetzter|das team|die kollegen|der kunde war|die firma)\b.*\b(falsch|schlecht|problem|schuld|nicht)\b/.test(t)) {
    signals.add('external_blame');
  }

  // Concrete example presence
  if (!/\b(zum beispiel|beispielsweise|konkret|einmal als|damals als|in dem projekt|bei firma)\b/.test(t)) {
    signals.add('no_concrete_example');
  } else {
    signals.add('concrete_example');
  }

  // Superlatives / overconfidence
  if (/\b(immer|nie|am besten|herausragend|exzellent|perfekt|der beste|absolute spitze)\b/.test(t)) {
    signals.add('superlative_overuse');
  }

  // Name-dropping without substance: ≥2 Capitalized non-stopword tokens + no number + short
  const caps = (raw.match(/\b[A-ZÄÖÜ][a-zäöüß]{3,}\b/g) ?? []).filter((w) => !/^(Ich|Wir|Sie|Der|Die|Das|Ein|Eine|Mein|Unser|Aber|Und|Oder|Weil|Als|Wenn|Dann|Also)$/.test(w));
  if (caps.length >= 2 && !hasNumber && wc < 30 && !/\b(zum beispiel|konkret)\b/.test(t)) {
    signals.add('name_dropping_no_substance');
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

  // Strong substantive turn — used for positive micro-deltas
  if (wc >= 20 && /\b(zum beispiel|konkret|deshalb|weil|aus folgenden gründen)\b/.test(t) && !signals.has('vague_quantifier') && !signals.has('hedging_words')) {
    signals.add('substantive_answer');
  }

  return signals;
}

// ============================================================
// Cut C: Micro-State Atmospheric Deltas — applied per turn from raw signals,
// independent of painpoint activation. Small values (≤0.06) accumulate to make
// pressure feel "atmospheric" without changing painpoint thresholds.
// ============================================================
const MICRO_DELTAS: Record<string, Partial<State>> = {
  filler_words:                 { tension: +0.02 },
  time_stalling:                { tension: +0.03, confidence: -0.02 },
  self_correction:              { confidence: -0.04 },
  apology_cluster:              { trust: -0.03, confidence: -0.05 },
  uptalk:                       { confidence: -0.03 },
  monologue_length:             { rapport: -0.03 },
  monologue_excessive:          { rapport: -0.05, tension: +0.02 },
  repetition_loop:              { confidence: -0.04, rapport: -0.02 },
  high_hedging_density:         { trust: -0.05, confidence: -0.04 },
  subjunctive_cluster:          { trust: -0.04 },
  superlative_overuse:          { trust: -0.04 },
  topic_drift:                  { trust: -0.06, rapport: -0.03 },
  name_dropping_no_substance:   { trust: -0.04 },
  user_provides_number:         { trust: +0.05, confidence: +0.03 },
  substantive_answer:           { trust: +0.04, confidence: +0.04, rapport: +0.02 },
  concrete_example:             { trust: +0.03, confidence: +0.02 },
};

function computeMicroDeltas(signals: Set<string>): { deltas: Record<string, number>; appliedSignals: string[] } {
  const agg: Record<string, number> = {};
  const applied: string[] = [];
  for (const sig of signals) {
    const delta = MICRO_DELTAS[sig];
    if (!delta) continue;
    applied.push(sig);
    for (const k of Object.keys(delta)) {
      agg[k] = (agg[k] ?? 0) + (delta as any)[k];
    }
  }
  // Cap atmospheric delta per dimension to prevent runaway
  for (const k of Object.keys(agg)) {
    agg[k] = Math.max(-0.12, Math.min(0.12, agg[k]));
  }
  return { deltas: agg, appliedSignals: applied };
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
// CUT E — Adaptive Conversation Engine
// ============================================================
//
// Hidden adaptive states (live in session.metadata.adaptive):
//   skepticism, pressure, interest, fatigue, performance_score
// Plus: phase, momentum, character_drift, user_claims, drill_chain.
//
// Goal: make the interview feel ALIVE (not Q&A) — dynamic difficulty,
// contradiction memory, momentum, multi-phase structure, drill-deeper,
// personality drift.
// ============================================================

type AdaptiveState = {
  skepticism: number;     // 0..1 — Recruiter-Skepsis
  pressure: number;       // 0..1 — Druck, den Recruiter aufbaut
  interest: number;       // 0..1 — Interesse des Recruiters
  fatigue: number;        // 0..1 — Recruiter-Erschöpfung (verliert Geduld)
  performance_score: number; // 0..1 — laufender Kandidaten-Score
};

type AdaptiveMeta = {
  adaptive_state: AdaptiveState;
  phase: 'warmup' | 'evaluation' | 'stress' | 'decision';
  momentum: 'strong' | 'neutral' | 'weak';
  difficulty: 'easy' | 'standard' | 'hard' | 'edge_case';
  character_drift: 'neutral' | 'respectful' | 'skeptical' | 'aggressive' | 'disengaged' | 'curious';
  user_claims: Array<{ turn: number; topic: string; polarity: 'pos' | 'neg'; quote: string }>;
  drill_chain: { topic: string | null; depth: number };
  outcome_signals: Record<string, number>; // accumulated for outcome derivation
};

const DEFAULT_ADAPTIVE: AdaptiveMeta = {
  adaptive_state: { skepticism: 0.3, pressure: 0.2, interest: 0.5, fatigue: 0.0, performance_score: 0.5 },
  phase: 'warmup',
  momentum: 'neutral',
  difficulty: 'standard',
  character_drift: 'neutral',
  user_claims: [],
  drill_chain: { topic: null, depth: 0 },
  outcome_signals: {},
};

function loadAdaptive(meta: any): AdaptiveMeta {
  const a = meta?.adaptive;
  if (!a) return JSON.parse(JSON.stringify(DEFAULT_ADAPTIVE));
  return {
    adaptive_state: { ...DEFAULT_ADAPTIVE.adaptive_state, ...(a.adaptive_state ?? {}) },
    phase: a.phase ?? 'warmup',
    momentum: a.momentum ?? 'neutral',
    difficulty: a.difficulty ?? 'standard',
    character_drift: a.character_drift ?? 'neutral',
    user_claims: Array.isArray(a.user_claims) ? a.user_claims : [],
    drill_chain: a.drill_chain ?? { topic: null, depth: 0 },
    outcome_signals: a.outcome_signals ?? {},
  };
}

// ---- Contradiction Memory ------------------------------------
// Tiny lexicon of antonym/conflict pairs. Each pair = (topic, positive markers, negative markers).
const CLAIM_AXES: { topic: string; pos: RegExp; neg: RegExp }[] = [
  { topic: 'teamarbeit',     pos: /\b(team(arbeit)?|gemeinsam|miteinander|kollabor|kollegen)\b.*\b(wichtig|liebe|gerne|stark|gut)\b/, neg: /\b(team(arbeit)?|gemeinsam|kollegen)\b.*\b(schwierig|nicht|lieber allein|ungern)\b|\b(arbeite|arbeiten)\b.*\b(allein|alleine|für mich)\b/ },
  { topic: 'stabilitaet',    pos: /\b(stabil|langfrist|treue|loyal|kontinuität)\b/, neg: /\b(wechsel|gewechselt|verschiedene\s+(arbeitgeber|firmen)|kurzfristig|abwechslung)\b/ },
  { topic: 'führung',        pos: /\b(führ(en|ung)|leiten|verantwortung übernehmen|menschen führen)\b.*\b(gerne|wichtig|liebe|stark)\b/, neg: /\b(führung)\b.*\b(nicht|ungern|schwierig|überfordert)\b|\b(lieber)\b.*\b(ausführen|umsetzen)\b/ },
  { topic: 'detail',         pos: /\b(detail|präzise|genau|akkurat|gründlich)\b/, neg: /\b(big picture|großes ganze|details? sind nicht|ungeduldig mit details)\b/ },
  { topic: 'risiko',         pos: /\b(risiko|risikobereit|wagen|sprung|mutig)\b/, neg: /\b(sicher(heit)?|risikoarm|vorsichtig|absichern|kein risiko)\b/ },
  { topic: 'kommunikation',  pos: /\b(offen(e)? kommunikation|transparent|direkt|feedback geben)\b/, neg: /\b(zurückhaltend|nicht so gerne|konflikt(scheu|vermeid)|um den heißen brei)\b/ },
];

function extractClaim(text: string): { topic: string; polarity: 'pos' | 'neg' } | null {
  const t = text.toLowerCase();
  for (const ax of CLAIM_AXES) {
    if (ax.pos.test(t)) return { topic: ax.topic, polarity: 'pos' };
    if (ax.neg.test(t)) return { topic: ax.topic, polarity: 'neg' };
  }
  return null;
}

function detectContradiction(
  newClaim: { topic: string; polarity: 'pos' | 'neg' },
  history: AdaptiveMeta['user_claims'],
): { earlier_turn: number; earlier_quote: string } | null {
  const opposite = history
    .filter((c) => c.topic === newClaim.topic && c.polarity !== newClaim.polarity)
    .sort((a, b) => a.turn - b.turn)[0];
  return opposite ? { earlier_turn: opposite.turn, earlier_quote: opposite.quote } : null;
}

// ---- Performance scoring per turn ----------------------------
function scoreUserTurn(signals: Set<string>): number {
  // 0..1, 0.5 = neutral
  let s = 0.5;
  const positives = ['substantive_answer', 'concrete_example', 'user_provides_number'];
  const negatives = ['vague_quantifier', 'high_hedging_density', 'subjunctive_cluster', 'wordcount_low',
    'topic_drift', 'name_dropping_no_substance', 'no_concrete_example', 'external_blame',
    'apology_cluster', 'monologue_excessive', 'repetition_loop', 'superlative_overuse',
    'filler_words', 'time_stalling', 'uptalk'];
  for (const p of positives) if (signals.has(p)) s += 0.12;
  for (const n of negatives) if (signals.has(n)) s += -0.07;
  return Math.max(0, Math.min(1, s));
}

// ---- Adaptive state evolution --------------------------------
function evolveAdaptive(prev: AdaptiveState, perf: number, signals: Set<string>): AdaptiveState {
  // Exponential moving averages
  const next: AdaptiveState = { ...prev };
  next.performance_score = prev.performance_score * 0.6 + perf * 0.4;

  // Skepticism rises with weak performance + hedging/contradiction, falls with strong perf
  let skepDelta = (0.5 - perf) * 0.25;
  if (signals.has('high_hedging_density') || signals.has('subjunctive_cluster')) skepDelta += 0.05;
  if (signals.has('contradiction_detected')) skepDelta += 0.18;
  if (signals.has('external_blame')) skepDelta += 0.08;
  if (signals.has('substantive_answer')) skepDelta -= 0.07;
  next.skepticism = clamp(prev.skepticism + skepDelta);

  // Pressure: rises with skepticism, falls in warmup/strong streaks
  let pressDelta = (next.skepticism - 0.4) * 0.15;
  if (signals.has('topic_drift') || signals.has('time_stalling')) pressDelta += 0.05;
  if (perf > 0.7) pressDelta -= 0.04;
  next.pressure = clamp(prev.pressure + pressDelta);

  // Interest: rises with concrete/substantive answers, falls with monologue/repetition/vague
  let intDelta = 0;
  if (signals.has('substantive_answer')) intDelta += 0.06;
  if (signals.has('concrete_example')) intDelta += 0.04;
  if (signals.has('user_provides_number')) intDelta += 0.05;
  if (signals.has('monologue_excessive')) intDelta -= 0.05;
  if (signals.has('repetition_loop')) intDelta -= 0.04;
  if (signals.has('vague_quantifier') && signals.has('no_concrete_example')) intDelta -= 0.05;
  next.interest = clamp(prev.interest + intDelta);

  // Fatigue: slow rise — drains the recruiter's patience
  let fatDelta = 0.01; // baseline drift
  if (signals.has('monologue_excessive')) fatDelta += 0.04;
  if (signals.has('repetition_loop')) fatDelta += 0.03;
  if (signals.has('time_stalling')) fatDelta += 0.02;
  if (signals.has('substantive_answer')) fatDelta -= 0.02;
  next.fatigue = clamp(prev.fatigue + fatDelta);

  return next;
}

// ---- Phase derivation ----------------------------------------
function derivePhase(turnIdx: number, adaptive: AdaptiveState, prevPhase: AdaptiveMeta['phase']): AdaptiveMeta['phase'] {
  // Decision mode: late or extreme states
  if (turnIdx >= 16 || adaptive.skepticism > 0.8 || adaptive.fatigue > 0.7 || adaptive.interest < 0.15) return 'decision';
  // Stress phase: high pressure or pronounced skepticism
  if (turnIdx >= 9 || adaptive.pressure > 0.55 || adaptive.skepticism > 0.6) return 'stress';
  if (turnIdx >= 4) return 'evaluation';
  // No backward drift from later phases — once stress, stay ≥ stress
  if (prevPhase === 'stress' || prevPhase === 'decision') return prevPhase;
  return 'warmup';
}

// ---- Momentum from rolling perf score ------------------------
function deriveMomentum(perfHistory: number[]): AdaptiveMeta['momentum'] {
  const last3 = perfHistory.slice(-3);
  if (last3.length === 0) return 'neutral';
  const avg = last3.reduce((s, x) => s + x, 0) / last3.length;
  if (avg >= 0.65) return 'strong';
  if (avg <= 0.4) return 'weak';
  return 'neutral';
}

// ---- Adaptive difficulty -------------------------------------
function deriveDifficulty(adaptive: AdaptiveState, momentum: AdaptiveMeta['momentum'], phase: AdaptiveMeta['phase']): AdaptiveMeta['difficulty'] {
  if (phase === 'warmup') return 'easy';
  if (momentum === 'strong' && phase === 'stress') return 'edge_case';
  if (momentum === 'strong') return 'hard';
  if (momentum === 'weak' && adaptive.skepticism > 0.6) return 'hard';
  return 'standard';
}

// ---- Personality drift ---------------------------------------
function deriveDrift(adaptive: AdaptiveState, momentum: AdaptiveMeta['momentum']): AdaptiveMeta['character_drift'] {
  if (adaptive.interest < 0.2 && adaptive.fatigue > 0.5) return 'disengaged';
  if (adaptive.skepticism > 0.7 && adaptive.pressure > 0.55) return 'aggressive';
  if (adaptive.skepticism > 0.55) return 'skeptical';
  if (momentum === 'strong' && adaptive.interest > 0.65) return 'curious';
  if (momentum === 'strong' && adaptive.skepticism < 0.35) return 'respectful';
  return 'neutral';
}

// ---- Drill-deeper detection ----------------------------------
function isProbingQuestion(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(warum|wieso|weshalb|konkret|beispiel|genauer|was genau|wie\s+(genau|kam)|begründ)\b/.test(t) && /\?/.test(text);
}

// Extracts a coarse "topic" anchor word from last assistant question (longest noun-ish token).
function extractTopicAnchor(text: string): string | null {
  const caps = text.match(/\b[A-ZÄÖÜ][a-zäöüß]{4,}\b/g) ?? [];
  if (caps.length > 0) return caps[caps.length - 1].toLowerCase();
  const words = (text.toLowerCase().match(/\b[a-zäöüß]{6,}\b/g) ?? [])
    .filter((w) => !/^(warum|wieso|weshalb|konkret|beispiel|genauer|begründen|machen|werden|haben)$/.test(w));
  return words.length > 0 ? words[words.length - 1] : null;
}

// ---- Outcome derivation (for debrief, computed here for live preview too) ----
type Outcome =
  | 'strong_overall' | 'high_potential_but_risky' | 'technically_strong_socially_weak'
  | 'confident_but_vague' | 'rejected_due_to_inconsistency' | 'promising_under_pressure'
  | 'recruiter_uncertain' | 'recruiter_disengaged' | 'weak_overall';

function deriveOutcome(adaptive: AdaptiveState, contradictionCount: number, momentum: AdaptiveMeta['momentum'], drift: AdaptiveMeta['character_drift']): Outcome {
  if (contradictionCount >= 2) return 'rejected_due_to_inconsistency';
  if (drift === 'disengaged') return 'recruiter_disengaged';
  if (adaptive.performance_score >= 0.7 && adaptive.skepticism < 0.4 && momentum === 'strong') return 'strong_overall';
  if (adaptive.performance_score >= 0.6 && adaptive.skepticism > 0.55) return 'high_potential_but_risky';
  if (adaptive.performance_score >= 0.6 && adaptive.interest < 0.4) return 'technically_strong_socially_weak';
  if (adaptive.performance_score >= 0.55 && adaptive.skepticism > 0.5 && momentum === 'neutral') return 'confident_but_vague';
  if (adaptive.performance_score >= 0.5 && adaptive.pressure > 0.6) return 'promising_under_pressure';
  if (adaptive.performance_score < 0.4) return 'weak_overall';
  return 'recruiter_uncertain';
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

    // 3) Apply state delta — Cut B: merge scenario.painpoint_overrides[painpoint_key]
    //                       Cut C: Micro-Deltas atmosphärisch on top
    let stateDelta: Record<string, number> = {};
    let painpointTriggered: string | null = null;
    let characterVariantApplied = false;
    let mergedReaction: any = {};
    const painpointOverrides = (scenario.painpoint_overrides as Record<string, any>) ?? {};
    if (selectedPp) {
      const override = painpointOverrides[selectedPp.painpoint_key] ?? null;
      const baseDeltas = selectedPp.state_deltas ?? {};
      const overrideDeltas = override?.state_deltas ?? null;
      stateDelta = overrideDeltas ? { ...baseDeltas, ...overrideDeltas } : baseDeltas;
      painpointTriggered = selectedPp.painpoint_key;
      mergedReaction = { ...(selectedPp.character_reaction ?? {}), ...(override ?? {}) };
      delete mergedReaction.state_deltas;
      characterVariantApplied = !!override;
    }

    // Cut C: compute micro-atmospheric deltas (independent of painpoint firing)
    const micro = computeMicroDeltas(signals);
    const combinedDelta: Record<string, number> = { ...stateDelta };
    for (const k of Object.keys(micro.deltas)) {
      combinedDelta[k] = (combinedDelta[k] ?? 0) + micro.deltas[k];
    }
    currentState = applyStateDeltas(currentState, combinedDelta);

    // 4) Insert user turn
    await admin.from('conversation_os_turns').insert({
      session_id: session.id,
      user_id: user.id,
      turn_index: userTurnIndex,
      role: 'user',
      content: body.message,
      state_snapshot: currentState,
      state_delta: combinedDelta,
      painpoint_triggered: painpointTriggered,
      character_variant_applied: characterVariantApplied,
      metadata: {
        signals: Array.from(signals),
        character_variant: characterVariantApplied ? mergedReaction : null,
        micro_state: {
          applied_signals: micro.appliedSignals,
          micro_deltas: micro.deltas,
          painpoint_delta: stateDelta,
        },
      },
    });

    // 5) Build character system prompt with state + painpoint guidance
    const brief = scenario.character_brief ?? {};
    const stateDescription = `[Interner Zustand — beeinflusst deine Tonalität, niemals direkt aussprechen]
Trust: ${currentState.trust.toFixed(2)} | Tension: ${currentState.tension.toFixed(2)} | Confidence (Gegenüber): ${currentState.confidence.toFixed(2)} | Rapport: ${currentState.rapport.toFixed(2)}`;

    // Cut C: micro-cue guidance — converts signal-flags into short directive sentences
    const microCueDirectives: string[] = [];
    if (signals.has('filler_words')) microCueDirectives.push('Das Gegenüber stockt sprachlich — werde ungeduldiger, kürzer.');
    if (signals.has('time_stalling')) microCueDirectives.push('Das Gegenüber spielt auf Zeit — dränge auf die Antwort.');
    if (signals.has('apology_cluster')) microCueDirectives.push('Das Gegenüber entschuldigt sich übermäßig — wirke souveräner, nicht versöhnlich.');
    if (signals.has('high_hedging_density') || signals.has('subjunctive_cluster')) microCueDirectives.push('Sehr viel Konjunktiv/Abschwächung — fordere eine klare Aussage im Indikativ.');
    if (signals.has('monologue_excessive')) microCueDirectives.push('Das Gegenüber redet sich um Kopf und Kragen — unterbrich höflich aber bestimmt.');
    if (signals.has('uptalk')) microCueDirectives.push('Das Gegenüber stellt Aussagen als Fragen — adressiere die Unsicherheit.');
    if (signals.has('superlative_overuse')) microCueDirectives.push('Das Gegenüber benutzt absolute Superlative — werde skeptisch, hinterfrage.');
    if (signals.has('substantive_answer') || signals.has('user_provides_number')) microCueDirectives.push('Gute substantielle Antwort — quittieren, aber ohne übertriebenes Lob; vertiefe oder gehe weiter.');
    const microCueBlock = microCueDirectives.length > 0 ? `\n\n[MIKRO-CUES — beeinflussen Ton, nicht Inhalt]\n- ${microCueDirectives.join('\n- ')}` : '';

    let painpointInjection = '';
    if (selectedPp) {
      const reaction = mergedReaction;
      painpointInjection = `\n\n[AKTIVER PAINPOINT: ${selectedPp.painpoint_key}${characterVariantApplied ? ' · CHARAKTER-VARIANTE' : ''}]
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
${painpointInjection}${microCueBlock}

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
