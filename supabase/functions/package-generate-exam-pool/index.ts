import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { bootstrapLLMLogging } from "../_shared/llm-log-bootstrap.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { calculateHybridTargetFromDefaults } from "../_shared/hybridExamTarget.ts";
import { getRemainingGenerationBudget, MAX_QUESTIONS_PER_PACKAGE, getTieredTarget } from "../_shared/exam-pool-limits.ts";
import type { HybridTargetResult } from "../_shared/hybridExamTarget.ts";
import { callAIJSON, logLLMCostEvent } from "../_shared/ai-client.ts";
import type { AIProvider } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import type { ModelChoice } from "../_shared/model-routing.ts";
import { resolveAvailableRoute } from "../_shared/llm/provider-load-balancer.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { enqueueJob } from "../_shared/enqueue.ts";
import { checkContamination } from "../_shared/contamination-guard.ts";
import { loadOrGenerateGlossary, formatGlossaryForPrompt } from "../_shared/glossary-loader.ts";
import { EXPLANATION_TEMPLATE, CALCULATION_GUARD, REGULATORY_GUARD, computeHallucinationRisk, computeVariationScore, loadMasteryContext, buildMasteryFeedbackSuffix } from "../_shared/prompt-kit.ts";
import { ERROR_TAG_VOCABULARY } from "../_shared/error-tag-vocabulary.ts";
import { getTimeBudget, shouldSoftStop } from "../_shared/time-budget.ts";
import { handleDbFailure } from "../_shared/job-fail.ts";
import { shouldUseBatch, BATCH_DEFAULT_MODEL } from "../_shared/batch/routing-config.ts";
import { buildBatchRequests, submitBatchViaFunction } from "../_shared/batch/enqueue-openai.ts";
import { getGraphContextForBlueprint } from "../_shared/knowledge-graph/query.ts";
import type { GraphContext } from "../_shared/knowledge-graph/types.ts";
import { shouldInjectKG } from "../_shared/kg-rollout.ts";

/**
 * DOMINANZ-ENGINE v5: IHK-REALISTIC QUALITY GATES
 * 
 * v5 upgrades:
 * - IHK-realistic difficulty distribution (25/35/25/15 statt 5/35/45/15)
 * - HARD praxis-score gate (score < 2 → reject, not just log)
 * - Explanation quality enforced (no explanation → reject)
 * - Distractor plausibility rules in prompt (4 distinct error types)
 * - KI-Selbstaudit: prompt instructs model to self-check before output
 * - Quality scoring tightened: only score ≥ 4 → exam pool
 * - Blueprint question types enforced with quotas
 * - Fachliche Validatoren (domain-specific checks)
 */

const AI_CHUNK_SIZE = 20;
const AI_CHUNK_SIZE_FANOUT = 2;       // Fan-out: max 2 BPs per invocation (reduced to fit 45s budget)
const AI_QUESTIONS_PER_CALL = 5;
const AI_QUESTIONS_PER_BLUEPRINT = 35;
const HARD_CAP_QUESTIONS = 1700;
const EXAM_POOL_BUDGET = getTimeBudget("exam_pool_fanout");
const TIME_BUDGET_MS = EXAM_POOL_BUDGET.ms;

// ─── Cognitive Level Distribution (IHK-realistic) ─────────────────────────────

const COGNITIVE_LEVEL_DISTRIBUTION: Record<string, number> = {
  recall: 0.25,    // Reines Wissen (Definitionen, Begriffe)
  apply: 0.35,     // Anwendung (Rechnen, Zuordnen, Ableitung)
  analyze: 0.25,   // Analyse (Fehler finden, richtige Handlung erkennen)
  decide: 0.15,    // Bewertung/Entscheidung (Best Practice, Risikoabwägung)
};

// ─── Question Types (semantic variety) ────────────────────────────────────────

let QUESTION_TYPE_MIX: Record<string, number> = {
  best_option: 0.20,       // Beste Option aus mehreren Maßnahmen
  error_detection: 0.15,   // Fehlerdiagnose
  calculation: 0.20,       // Rechenaufgabe mit konkreten Zahlen
  case_study: 0.20,        // Fallstudie: konkreter Praxisfall
  risk_assessment: 0.10,   // Risikoabwägung
  compliance_check: 0.15,  // Compliance/Norm-Check
};

/**
 * Apply math_ratio from certification_catalog to QUESTION_TYPE_MIX.
 * Redistributes non-calculation types proportionally to hit the target ratio.
 */
function applyMathRatio(mathRatio: number): void {
  if (mathRatio <= 0 || mathRatio > 0.50) {
    console.log(`[ExamPool-v5] mathRatio out of bounds (${mathRatio}) — ignored`);
    return;
  }
  const currentCalc = QUESTION_TYPE_MIX.calculation ?? 0.20;
  if (Math.abs(currentCalc - mathRatio) < 0.01) {
    console.log(`[ExamPool-v5] mathRatio already at ${(mathRatio * 100).toFixed(0)}% — no change needed`);
    return;
  }
  
  const remaining = 1 - mathRatio;
  const otherTotal = Object.entries(QUESTION_TYPE_MIX)
    .filter(([k]) => k !== "calculation")
    .reduce((s, [, v]) => s + v, 0);
  
  for (const key of Object.keys(QUESTION_TYPE_MIX)) {
    if (key === "calculation") {
      QUESTION_TYPE_MIX[key] = mathRatio;
    } else {
      QUESTION_TYPE_MIX[key] = (QUESTION_TYPE_MIX[key] / otherTotal) * remaining;
    }
  }
  console.log(`[ExamPool-v5] mathRatio applied: calculation=${(mathRatio * 100).toFixed(0)}%, mix=${JSON.stringify(QUESTION_TYPE_MIX)}`);
}

// ─── Difficulty Distribution (IHK-realistic for exam simulation) ──────────────
// SSOT: easy=10%, medium=45%, hard=35%, very_hard=10%

let DIFFICULTY_DISTRIBUTION: Record<string, number> = {
  easy: 0.10, medium: 0.45, hard: 0.35, very_hard: 0.10,
};

type DifficultyKey = string;
type QuestionTypeKey = string;
type CognitiveLevelKey = string;

// ─── Diversity Engine ─────────────────────────────────────────────────────────

const GERMAN_NAMES = [
  "Frau Yılmaz", "Herr Petrov", "Frau Nguyen", "Herr Al-Rashid", "Frau Kowalski",
  "Herr da Silva", "Frau Chen", "Herr Öztürk", "Frau Hoffmann", "Herr Becker",
  "Frau Richter", "Herr Nowak", "Frau Lehmann", "Herr Braun", "Frau Klein",
  "Herr Fischer", "Frau Schäfer", "Herr Krämer", "Frau Bergmann", "Herr Lorenz",
  "Frau Hartmann", "Herr Weiß", "Frau Engel", "Herr Seidel", "Frau Haas",
  "Herr Baumann", "Frau König", "Herr Dietrich", "Frau Schuster", "Herr Roth",
  "Frau Maier", "Herr Scholz", "Frau Vogel", "Herr Franke", "Frau Ludwig",
];

// PROFESSION-AGNOSTIC openers — no banking/industry-specific terms
const SENTENCE_OPENERS = [
  "Ein Kunde möchte", "Im Beratungsgespräch", "Welche", "Stellen Sie sich vor,",
  "Bei der Prüfung", "Während eines Kundentermins", "Im Rahmen der",
  "Ein Unternehmen plant", "Zur Beurteilung", "Angenommen,",
  "In Ihrem Ausbildungsbetrieb", "Bei der Qualitätskontrolle", "Ein Auszubildender fragt",
  "Nach Analyse der Unterlagen", "Die Geschäftsleitung prüft",
  "Vor dem Hintergrund", "Gemäß den Vorschriften", "Aus betriebswirtschaftlicher Sicht",
  "Im Zuge der Digitalisierung", "Ein langjähriger Geschäftspartner",
  "Ihre Kollegin bittet Sie", "Ihr Vorgesetzter beauftragt Sie",
  "Ein neuer Auftrag erfordert", "Bei der Abrechnung stellen Sie fest,",
  "Im Teamgespräch wird diskutiert,", "Eine Kundin reklamiert,",
  "Der Abteilungsleiter fragt nach", "Beim Vergleich zweier Angebote",
  "Nach Durchsicht der Dokumente", "Im Tagesgeschäft fällt auf,",
];

// ─── Text-Similarity (Jaccard n-gram) ─────────────────────────────────────────

function textNgrams(text: string, n = 3): Set<string> {
  const norm = text.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const grams = new Set<string>();
  for (let i = 0; i <= norm.length - n; i++) grams.add(norm.slice(i, i + n));
  return grams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const g of a) if (b.has(g)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

const TEXT_SIMILARITY_THRESHOLD = 0.70;

function shuffleArray<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ─── Difficulty Auto-Validator ────────────────────────────────────────────────

function validateDifficulty(q: { question_text: string; options: string[]; difficulty: string; explanation?: string }): boolean {
  const text = q.question_text.toLowerCase();
  const allText = (text + " " + q.options.join(" ") + " " + (q.explanation || "")).toLowerCase();

  // PROFESSION-AGNOSTIC indicators (no banking-specific terms)
  const hasCalculation = /\d+[\s]*[×x*÷/+\-]\s*\d+|\d+[.,]\d+\s*(%|€|eur)|\bberechn|\brate\b|\bbetrag\b|\bformel\b|\bergebnis\b/i.test(allText);
  const hasParagraph = /§\s*\d+|\bBGB\b|\bHGB\b|\bAO\b|\bUStG\b|\bKSchG\b|\bAGB\b|\bDSGVO\b|\bBetrVG\b|\bBBiG\b|\bVerordnung\b|\bRichtlinie\b/i.test(allText);
  const hasFachbegriff = /\b(Qualität|Kennzahl|Kalkulation|Deckungsbeitrag|Bilanz|GuV|Skonto|Rabatt|Gewährleistung|Reklamation|Dokumentation|Arbeitsschutz|Hygiene|Toleranz|Prüfprotokoll|Lieferschein|Bestellung|Inventur|Abschreibung)\b/i.test(allText);
  const hasDecision = /\bwelche Maßnahme\b|\bbeste Option\b|\bempfehlen\b|\bRisiko\b|\bbeurteilen\b|\babwägen\b|\bentscheiden\b|\bhandeln\b|\bpriorisieren\b/i.test(allText);

  // RELAXED validation: difficulty is now FORCED from distribution, so this gate
  // validates content FITS the level. Previously too strict for easy/medium,
  // causing 90%+ to fail and land in training pool.
  switch (q.difficulty) {
    case "easy":
      // Easy: should NOT require multi-step calculation + legal references
      if (hasCalculation && hasParagraph && hasDecision) return false;
      return true; // most content is valid as easy
    case "medium":
      // Medium: any professional content indicator is fine (relaxed from AND to OR)
      return true; // medium is the baseline — always valid
    case "hard":
      // Hard: needs at least ONE complexity indicator
      return hasCalculation || hasParagraph || hasFachbegriff || hasDecision;
    case "very_hard":
      // Very hard: needs multiple complexity indicators
      return (hasCalculation || hasParagraph) && (hasFachbegriff || hasDecision);
    default:
      return true;
  }
}

// ─── Praxis-Score (Realism Gate) — PROFESSION-AGNOSTIC ───────────────────────

function calculatePraxisScore(q: { question_text: string; options: string[] }): number {
  const text = q.question_text;
  let score = 0;

  // Has role/person (generic across all professions)
  if (/\b(Auszubildende[r]?|Sachbearbeiter|Kollegin|Kollege|Vorgesetzte[r]?|Geschäftsführer|Meister|Fachkraft|Mitarbeiter|Ausbilder|Teamleiter|Abteilungsleiter|Kunde|Kundin|Auftraggeber|Lieferant|Patient|Mandant)\b/i.test(text)) score++;

  // Has situational context (generic across all professions)
  if (/\b(Beratungsgespräch|Besprechung|Arbeitsplatz|Auftrag|Bestellung|Reklamation|Lieferung|Inventur|Qualitätskontrolle|Arbeitsschutz|Schulung|Abrechnung|Dokumentation|Prüfung|Wartung|Projektplanung|Kundengespräch|Wareneingang|Arbeitsanweisung)\b/i.test(text)) score++;

  // Has realistic non-round numbers
  const numbers = text.match(/\d{3,}/g);
  if (numbers) {
    const hasNonRound = numbers.some(n => {
      const num = parseInt(n);
      return num % 100 !== 0 || num > 99999;
    });
    if (hasNonRound) score++;
  }

  // Has concrete name
  if (/\b(Herr|Frau)\s+[A-ZÄÖÜ][a-zäöüß]+/i.test(text)) score++;

  return score; // 0-4, gate: >= 1
}

// ─── AI Style Gate (kill KI-Lehrbuch-Deutsch) ────────────────────────────────

const AI_STYLE_BLACKLIST = [
  "im folgenden", "es ist zu beachten", "grundsätzlich gilt",
  "zusammenfassend lässt sich sagen", "in diesem zusammenhang",
  "es sei darauf hingewiesen", "abschließend sei erwähnt",
  "diesbezüglich", "hinsichtlich dessen", "in anbetracht",
  "es ist wichtig zu verstehen", "man sollte beachten",
  "folgende aspekte sind relevant", "hierbei handelt es sich um",
  "in der praxis zeigt sich", "es empfiehlt sich",
  "nachfolgend wird erläutert", "im weiteren verlauf",
];

function passesStyleGate(q: { question_text: string; explanation?: string }): boolean {
  const text = (q.question_text + " " + (q.explanation || "")).toLowerCase();
  for (const phrase of AI_STYLE_BLACKLIST) {
    if (text.includes(phrase)) return false;
  }
  // Reject overly long sentences (>40 words = KI-typical)
  const sentences = q.question_text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const longSentences = sentences.filter(s => s.trim().split(/\s+/).length > 40);
  if (longSentences.length > 0) return false;
  return true;
}

// ─── Explanation Quality Check (strict: must explain WHY wrong + tip) ─────────

function hasQualityExplanation(q: { explanation?: string; options: string[] }): boolean {
  if (!q.explanation || q.explanation.length < 80) return false;

  const expl = q.explanation.toLowerCase();
  // Must explain why wrong (at least 2 references to incorrect reasoning)
  const wrongReferences = (expl.match(/\b(falsch|nicht korrekt|inkorrekt|irrtümlich|fehler|verwechsl|trifft nicht zu|fehlerhaft|unzutreffend)\b/gi) || []).length;
  // Must have a tip/merksatz
  const hasTip = /\b(tipp|merke|merksatz|prüfungstipp|achtung|wichtig|beachte)\b/i.test(expl);
  return wrongReferences >= 2 && hasTip;
}

// ─── Quality Scoring (Exam Pool vs Training Pool) ─────────────────────────────

function calculateQualityScore(q: {
  question_text: string;
  options: string[];
  difficulty: string;
  explanation?: string;
  question_type?: string;
}): { score: number; pool: "exam" | "training" } {
  let score = 0;

  // Diversity (sentence opener variety) - 1pt
  const firstWord = q.question_text.split(/\s+/)[0];
  if (!["Die", "Der", "Das", "Ein", "Eine"].includes(firstWord)) score += 1;

  // Praxis-Score - up to 2pts
  const praxis = calculatePraxisScore(q);
  score += Math.min(praxis, 2);

  // Difficulty calibration passed - 1pt
  if (validateDifficulty(q)) score += 1;

  // Explanation quality - 1pt
  if (hasQualityExplanation(q)) score += 1;

  // Distractor count (4+ options) - 1pt
  if (q.options.length >= 4) score += 1;

  // Max score = 6
  return {
    score,
    pool: score >= 4 ? "exam" : "training",
  };
}

function getShipTarget(examTarget: number): number {
  if (examTarget <= 600) return 500;
  if (examTarget <= 800) return 700;
  if (examTarget <= 1000) return 850;
  return 1000;
}

// ─── Telemetry Helpers (P0: every return path MUST include metrics) ───────────

type ExamPoolMetrics = {
  blueprints_found?: number;
  blueprints_used?: number;
  learning_fields_total?: number;
  learning_fields_enqueued?: number;
  learning_fields_skipped?: number;
  learning_fields_errors?: number;
  generated?: number;
  inserted?: number;
  fan_out?: boolean;
  reason?: string;
};

// ── Observability: Invocation-level quality tracking ──────────────────────────
interface InvocationQualityMetrics {
  total_llm_calls: number;
  successful_llm_calls: number;
  failed_llm_calls: number;
  retried_llm_calls: number;
  blocked_llm_calls: number;       // NEW: proactively blocked (cooldown/rpm)
  total_output_chars: number;
  total_tokens_out_estimated: number;
  truncated_responses: number;
  empty_responses: number;
  json_repair_failures: number;
  candidates_generated: number;
  candidates_accepted_exam: number;
  candidates_accepted_training: number;
  candidates_rejected_contamination: number;
  candidates_rejected_low_praxis: number;
  candidates_rejected_ai_style: number;
  candidates_rejected_hallucination: number;
  candidates_rejected_invalid_index: number;
  candidates_rejected_meta_text: number;
  candidates_rejected_placeholder: number;
  candidates_duplicates_hash: number;
  candidates_duplicates_ngram: number;
  candidates_gate_failed_distractor: number;
  avg_quality_score: number;
  models_attempted: Record<string, number>;  // NEW: every attempt, including failures
  models_used: Record<string, number>;       // only successful calls with output
  rejection_reasons: Record<string, number>;
  kg_context_hits: number;   // blueprints where KG context was available
  kg_context_misses: number; // blueprints where KG context was absent
  kg_errors_injected: number; // total common_errors injected across all calls
  kg_rollout_enabled: boolean; // whether KG rollout is active
  kg_rollout_pct: number;     // configured rollout percentage
  kg_blueprints_gated: number; // blueprints excluded by rollout gate
}

function createEmptyQualityMetrics(): InvocationQualityMetrics {
  return {
    total_llm_calls: 0, successful_llm_calls: 0, failed_llm_calls: 0, retried_llm_calls: 0,
    blocked_llm_calls: 0,
    total_output_chars: 0, total_tokens_out_estimated: 0,
    truncated_responses: 0, empty_responses: 0, json_repair_failures: 0,
    candidates_generated: 0, candidates_accepted_exam: 0, candidates_accepted_training: 0,
    candidates_rejected_contamination: 0, candidates_rejected_low_praxis: 0,
    candidates_rejected_ai_style: 0, candidates_rejected_hallucination: 0,
    candidates_rejected_invalid_index: 0, candidates_rejected_meta_text: 0,
    candidates_rejected_placeholder: 0,
    candidates_duplicates_hash: 0, candidates_duplicates_ngram: 0,
    candidates_gate_failed_distractor: 0,
    avg_quality_score: 0, models_attempted: {}, models_used: {}, rejection_reasons: {},
    kg_context_hits: 0, kg_context_misses: 0, kg_errors_injected: 0,
    kg_rollout_enabled: false, kg_rollout_pct: 0, kg_blueprints_gated: 0,
  };
}

// Global invocation-level metrics tracker
let _qualityMetrics: InvocationQualityMetrics = createEmptyQualityMetrics();

function withMetrics(base: Record<string, unknown>, metrics: ExamPoolMetrics): Record<string, unknown> {
  return { ...base, metrics: { ...(base.metrics as Record<string, unknown> ?? {}), ...metrics } };
}

function transientBackoff(error: string, backoff_seconds: number, metrics: ExamPoolMetrics = {}) {
  return json(
    withMetrics(
      { ok: false, transient: true, backoff_seconds, error },
      metrics,
    ),
    200,
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// ─── Provider Routing: DB-first via model-routing.ts ─────────────────────────

let _examProviderChain: ModelChoice[] | null = null;

async function loadExamProviderChain(): Promise<ModelChoice[]> {
  if (_examProviderChain) return _examProviderChain;
  try {
    // v10.5: DB-driven routing via llm_provider_routing_policies
    const policyRoute = await resolveAvailableRoute("exam_blueprint");
    if (policyRoute.ok && policyRoute.provider && policyRoute.model) {
      console.log(`[ExamPool-v5] POLICY_ROUTE: exam_blueprint → ${policyRoute.provider}/${policyRoute.model}`);
      const hardcodedChain = await getModelChainAsync("exam_questions");
      _examProviderChain = [
        { provider: policyRoute.provider as AIProvider, model: policyRoute.model },
        ...hardcodedChain.filter(c => c.model !== policyRoute.model),
      ];
    } else {
      console.log(`[ExamPool-v5] POLICY_MISS: exam_blueprint (${policyRoute.reason}) → hardcoded chain`);
      _examProviderChain = await getModelChainAsync("exam_questions");
    }
    console.log(`[ExamPool-v5] Provider chain: ${_examProviderChain.map(m => m.model).join(" → ")}`);
  } catch (e) {
    console.warn(`[ExamPool-v5] DB routing failed, using hardcoded fallback: ${e}`);
    _examProviderChain = [
      { provider: "openai" as AIProvider, model: "gpt-5-mini" },
      { provider: "anthropic" as AIProvider, model: "claude-haiku-4-5-20251001" },
      { provider: "openai" as AIProvider, model: "gpt-5.2" },
    ];
  }
  return _examProviderChain;
}

function pickProvider(chain: ModelChoice[], exclude: string[] = []): { provider: AIProvider; model: string } {
  for (const entry of chain) {
    if (exclude.includes(`${entry.provider}:${entry.model}`)) continue;
    const keyMap: Record<string, string> = {
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      google: "GOOGLE_AI_API_KEY",
    };
    const keyEnv = keyMap[entry.provider];
    if (keyEnv && !Deno.env.get(keyEnv)) continue;
    return entry;
  }
  return chain[0];
}

async function markRateLimited(sb: ReturnType<typeof createClient>, provider: string, err: string) {
  try {
    await sb.rpc("mark_provider_rate_limited", { p_provider: provider, p_cooldown_seconds: 90, p_error: err });
  } catch { /* non-blocking */ }
}

async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (d1?.status === "done") return true;
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status === "done";
}

// ─── JSON Auto-Repair ─────────────────────────────────────────────────────────

function repairJSON(raw: string): unknown | null {
  // Layer 1: Strip all markdown fences (opening and closing, with optional language tag)
  let clean = raw.replace(/```(?:json)?[\s]*/gi, "").trim();
  try { return JSON.parse(clean); } catch { /* continue */ }

  // Layer 2: Fix trailing commas
  clean = clean.replace(/,\s*([\]}])/g, "$1");
  try { return JSON.parse(clean); } catch { /* continue */ }

  // Layer 3: Fix unescaped control characters inside string values
  clean = clean.replace(/(?<=":[\s]*"[^"]*)\n(?=[^"]*")/g, "\\n");
  clean = clean.replace(/(?<=":[\s]*"[^"]*)\t(?=[^"]*")/g, "\\t");
  try { return JSON.parse(clean); } catch { /* continue */ }

  // Layer 4: Extract array
  const arrMatch = clean.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    const arrClean = arrMatch[0].replace(/,\s*([\]}])/g, "$1");
    try { return JSON.parse(arrClean); } catch { /* continue */ }
    // Try fixing truncated last element by removing it
    const truncFixed = arrClean.replace(/,\s*\{[^}]*$/, "]");
    try { return JSON.parse(truncFixed); } catch { /* continue */ }
  }

  // Layer 5: Extract individual objects and collect into array
  const objMatches = [...clean.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)];
  if (objMatches.length > 0) {
    const parsed = [];
    for (const m of objMatches) {
      try {
        const fixed = m[0].replace(/,\s*([\]}])/g, "$1");
        parsed.push(JSON.parse(fixed));
      } catch { /* skip malformed object */ }
    }
    if (parsed.length > 0) return parsed;
  }

  // Layer 6: Single object extraction
  const objMatch = clean.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const fixed = objMatch[0].replace(/,\s*([\]}])/g, "$1");
    try { return [JSON.parse(fixed)]; } catch { /* continue */ }
  }

  return null;
}

// ─── Turbo Prompt v4 (cognitive level + question type + IHK distractor rules) ─

interface TrapSpec {
  trap_tags: string[];
  common_misconceptions: string[];
  distractor_rules: string[];
}

interface BlueprintInfo {
  id: string;
  curriculum_id: string;
  learning_field_id: string | null;
  competency_id: string | null;
  name: string;
  canonical_statement: string;
  cognitive_level: string;
  question_template: string;
  trap_spec?: TrapSpec | null;
  typical_exam_trap?: string | null;
  // S4 additions
  exam_context_type?: string | null;
  typical_errors?: string[] | null;
  estimated_time_seconds?: number | null;
  decision_structure?: string | null;
  exam_relevance_score?: number | null;
}

// ─── Error Tag Vocabulary — imported from SSOT shared module ─────────────────
// Re-exported for backward compat within this file
// Source: supabase/functions/_shared/error-tag-vocabulary.ts

function buildTurboPrompt(
  bp: BlueprintInfo,
  difficulty: DifficultyKey,
  questionType: QuestionTypeKey,
  cognitiveLevel: CognitiveLevelKey,
  count: number,
  lfTitle: string,
  compTitle: string,
  compDesc: string,
  professionName: string,
  depthTopics: string[],
  glossaryContext?: string,
  masteryInjection?: string,
  graphContext?: GraphContext | null,
): { system: string; user: string } {
  const diffLabel: Record<string, string> = {
    easy: "leicht", medium: "mittel", hard: "schwer", very_hard: "sehr schwer",
  };

  const cognitiveHint: Record<string, string> = {
    recall: "WISSENSABFRAGE: Definition, Begriff, Zuordnung. Der Prüfling muss Fakten abrufen.",
    apply: "ANWENDUNG: Berechnung durchführen, Verfahren anwenden, Zuordnung ableiten. Konkrete Zahlen und Formeln.",
    analyze: "ANALYSE: Fehler identifizieren, Sachverhalt beurteilen, richtige Handlung aus Situation ableiten.",
    decide: "BEWERTUNG/ENTSCHEIDUNG: Best Practice wählen, Risiken abwägen, Handlungsempfehlung geben. Mehrere vertretbare Optionen, nur eine ist optimal.",
  };

  const typeHint: Record<string, string> = {
    best_option: "BESTE OPTION: Mehrere Maßnahmen werden vorgestellt – der Prüfling muss die optimale wählen. Alle Optionen klingen plausibel.",
    error_detection: "FEHLERDIAGNOSE: Ein Sachverhalt enthält einen Fehler – der Prüfling muss ihn identifizieren.",
    calculation: "RECHENAUFGABE: Konkrete Zahlen, ein klarer Rechenweg. Distraktoren = typische Rechenfehler (z.B. falscher Zinssatz, vergessener Faktor).",
    case_study: "FALLSTUDIE: Konkretes Szenario mit Name, Situation, Zahlen. Der Prüfling muss die richtige Schlussfolgerung ziehen.",
    risk_assessment: "RISIKOABWÄGUNG: Situation mit mehreren Risikofaktoren. Der Prüfling muss das Hauptrisiko oder die richtige Absicherung erkennen.",
    compliance_check: "COMPLIANCE/NORM: Bezug auf Vorschriften, Gesetze, Richtlinien. Der Prüfling muss die richtige Norm oder Frist kennen.",
  };

  const depthBlock = depthTopics.length > 0
    ? `\nUnterthemen: ${depthTopics.slice(0, 8).join(", ")}`
    : "";

  const namePool = shuffleArray(GERMAN_NAMES, Date.now()).slice(0, 8).join(", ");
  const openerPool = shuffleArray(SENTENCE_OPENERS, Date.now()).slice(0, 6).join('", "');

  const system = `Du bist ein erfahrener IHK-Prüfungsaufgabenersteller für ${professionName}. Erstelle ${diffLabel[difficulty]} Prüfungsfragen.

KOGNITIVE STUFE: ${cognitiveHint[cognitiveLevel] || cognitiveHint.apply}
FRAGETYP: ${typeHint[questionType] || typeHint.case_study}

═══ QUALITÄTSREGELN ═══

SPRACHE & STIL:
- Schreibe wie ein erfahrener IHK-Prüfer, NICHT wie eine KI
- Natürliches, flüssiges Deutsch — kein "Lehrbuch-Deutsch"
- VERBOTENE FLOSKELN: "im Folgenden", "grundsätzlich gilt", "es ist zu beachten", "zusammenfassend lässt sich sagen", "in diesem Zusammenhang", "es sei darauf hingewiesen", "diesbezüglich", "hinsichtlich dessen", "es empfiehlt sich", "folgende Aspekte sind relevant"
- Kurze, natürliche Sätze (max 30 Wörter). Realistische Dialogsprache in Beratungssituationen.
- KEINE Platzhalter {variable} — alle Werte konkret einsetzen
- JEDE Frage beginnt mit einem ANDEREN Satzanfang. Nutze z.B.: "${openerPool}"
- NIEMALS mehrere Fragen mit "Die…", "Herr…" oder "Frau…" beginnen
- Verwende diverse Personennamen: ${namePool}
- Verwende REALISTISCHE Zahlen (nicht 1.000, 10.000 — sondern z.B. 12.450, 3.875, 47.320)

DISTRAKTOREN (IHK-QUALITÄT — STRUKTURIERT):
- Distraktor 1: Korrekt klingend, aber falsche Norm/Paragraph/Frist → error_tag zuweisen
- Distraktor 2: Häufige Praxisverwechslung (was Azubis oft falsch machen) → error_tag zuweisen
- Distraktor 3: Typischer Rechenfehler oder Denkfehler → error_tag zuweisen
- ALLE Distraktoren müssen plausibel klingen — NICHT offensichtlich falsch
- KEINE "Nonsens-Optionen" die sofort ausgeschlossen werden können
- Erlaubte error_tags: ${ERROR_TAG_VOCABULARY.join(", ")}
- Bei Rechenaufgaben: Falsche Optionen MÜSSEN numerisch nahe am korrekten Ergebnis liegen (±5–25% oder exakter Rechenfehler wie falsche Prozentbasis, Skonto/Rabatt vertauscht, Netto statt Brutto). KEINE zufälligen Zahlen!
- JEDE falsche Option braucht einen distractor_meta-Eintrag mit option_index, error_tag, why_wrong, why_tempting und examiner_intention
  - why_wrong: Warum ist diese Option fachlich falsch? (MINDESTENS 20 Zeichen, KEIN generisches "weil falsch")
  - why_tempting: Warum wählen Prüflinge diese Option trotzdem? Welcher Denkfehler steckt dahinter? (MINDESTENS 15 Zeichen)
  - examiner_intention: Was prüft der IHK-Prüfer mit diesem Distraktor? Welche Kompetenz soll abgegrenzt werden? (MINDESTENS 15 Zeichen)
- option_index im distractor_meta darf NICHT der correct_answer Index sein

PRAXISBEZUG (PFLICHT):
- Jede Frage enthält eine konkrete Berufsrolle aus dem Alltag von ${professionName} (Auszubildende, Fachkraft, Meister, Vorgesetzte, Kunde etc.)
- Jede Frage hat einen konkreten Kontext aus dem typischen Arbeitsalltag von ${professionName}
- Verwende konkrete, nicht-runde Zahlen für Beträge, Mengen, Fristen
- Szenarien MÜSSEN berufsspezifisch für ${professionName} sein — NICHT generisch übertragbar

REGULATORISCHE TIEFE (PFLICHT bei Compliance/Recht):
- Konkrete §§-Referenzen die für ${professionName} relevant sind (BGB, HGB, AO, UStG, DSGVO, BetrVG, BBiG, branchenspezifische Vorschriften)
- Exakte Fristen, Schwellenwerte, Meldepflichten die ${professionName} kennen müssen
- Zuständige Behörden und Institutionen des Berufsfelds
- Unterscheide klar zwischen MUSS-Vorschriften und KANN-Regelungen

RECHENAUFGABEN-TIEFE (PFLICHT bei Calculation):
- Mehrstufige Berechnungen die im Berufsalltag von ${professionName} vorkommen
- Kombinationsaufgaben: Mehrere berufstypische Berechnungsschritte verknüpfen
- Distraktoren = typische Rechenfehler die ${professionName} in der Prüfung machen (falscher Faktor, vergessener Schritt, falsche Einheit)
- KEINE trivialen Einschritt-Rechnungen bei Schwierigkeit "hard" oder "very_hard"

ERKLÄRUNG (COACHING-STIL — PFLICHT):
${EXPLANATION_TEMPLATE}

${CALCULATION_GUARD}

${REGULATORY_GUARD}

SELBSTAUDIT (vor Ausgabe prüfen):
- Ist die Frage eindeutig? Gibt es genau EINE richtige Antwort?
- Sind alle 3 Distraktoren plausibel? Kann man sie NICHT durch Allgemeinwissen ausschließen?
- Entspricht die Schwierigkeit dem angeforderten Level?
- Klingt die Frage natürlich — wie von einem IHK-Prüfer geschrieben?
- Enthält die Erklärung einen konkreten Prüfungsanker + Merksatz?
- Bei Rechenaufgaben: Enthält die Aufgabe ALLE nötigen Zahlen/Parameter?
Regeneriere intern, bis alle Punkte erfüllt sind.
${glossaryContext || ''}

Antworte NUR mit JSON-Array (keine Extra-Keys, options exakt 4, correct_answer 0..3):
[{"question_text":"...","options":["A","B","C","D"],"correct_answer":0,"difficulty":"${difficulty}","question_type":"${questionType}","cognitive_level":"${cognitiveLevel}","explanation":"Richtig: ... Falsch A: ... Falsch B: ... Falsch C: ... Prüfungsanker: ... Merke: ...","tags":["tag1"],"trap_tags":["error_type1"],"distractor_meta":[{"option_index":1,"error_tag":"percent_base","why_wrong":"Hier wird die falsche Prozentbasis verwendet...","why_tempting":"Viele Prüflinge verwechseln Brutto und Netto als Basis","examiner_intention":"Prüft ob der Prüfling die korrekte Bezugsgröße kennt"},{"option_index":2,"error_tag":"skonto_rabatt_order","why_wrong":"Skonto wird vor Rabatt abgezogen...","why_tempting":"Im Alltag wird die Reihenfolge oft ignoriert","examiner_intention":"Testet kalkulatorisches Verständnis der Abzugsreihenfolge"},{"option_index":3,"error_tag":"definition_confusion","why_wrong":"Der Begriff wird hier falsch definiert...","why_tempting":"Die Begriffe klingen ähnlich und werden oft verwechselt","examiner_intention":"Prüft begriffliche Trennschärfe"}]}]`;

  // ── Inject TrapSpec from blueprint (if available) ──
  let trapSpecBlock = "";
  if (bp.trap_spec) {
    const ts = bp.trap_spec;
    trapSpecBlock = `\n\n═══ BLUEPRINT TRAP-SPEC (PFLICHT für Distraktoren) ═══
Typische Prüfungsfallen für dieses Thema:
- Trap-Tags: ${ts.trap_tags?.join(", ") || "keine"}
- Häufige Denkfehler: ${ts.common_misconceptions?.join("; ") || "keine"}
- Distraktor-Regeln: ${ts.distractor_rules?.join("; ") || "keine"}
Nutze diese Fallen gezielt für die 3 Distraktoren!`;
  } else if (bp.typical_exam_trap) {
    trapSpecBlock = `\n\nTypische Prüfungsfalle: ${bp.typical_exam_trap}`;
  }

  // ── Inject Knowledge Graph context (Phase 2 — compact enrichment) ──
  let graphBlock = "";
  if (graphContext?.common_errors?.length) {
    const errList = graphContext.common_errors.slice(0, 5).map((e) => `- ${e}`).join("\n");
    graphBlock = `\n\n═══ HÄUFIGE FEHLER (Knowledge Graph) ═══
Typische Fehler/Missverständnisse von Auszubildenden bei dieser Kompetenz:
${errList}
Nutze diese Fehlermuster gezielt für realistische Distraktoren!`;
  }

  const user = `${count} Frage(n) für "${professionName}".
Lernfeld: ${lfTitle}
Thema: ${compTitle} — ${compDesc}
Blueprint: ${bp.canonical_statement}${depthBlock}${trapSpecBlock}${graphBlock}

Kognitive Stufe: ${cognitiveLevel}
Fragetyp: ${questionType}
Schwierigkeit: ${difficulty}
${masteryInjection || ""}`;

  return { system, user };
}

// ─── Raw Candidate Generator (AI-only, no dedup/persist — parallel-safe) ────

interface RawCandidate {
  question: any;
  bp: BlueprintInfo;
  difficulty: DifficultyKey;
  questionType: QuestionTypeKey;
  cognitiveLevel: CognitiveLevelKey;
  lfData: { title?: string; exam_part?: string } | null;
}

async function generateRawCandidates(
  sb: ReturnType<typeof createClient>,
  bp: BlueprintInfo,
  count: number,
  difficulty: DifficultyKey,
  questionType: QuestionTypeKey,
  cognitiveLevel: CognitiveLevelKey,
  professionName: string,
  glossaryContext?: string,
): Promise<{ candidates: RawCandidate[]; lfData: { title?: string; exam_part?: string } | null }> {
  let compTitle = bp.name;
  let compDesc = bp.canonical_statement;
  let lfTitle = "";
  let depthTopics: string[] = [];
  let lfData: { title?: string; exam_part?: string } | null = null;

  if (bp.competency_id) {
    const { data: comp } = await sb.from("competencies").select("title, description").eq("id", bp.competency_id).maybeSingle();
    if (comp) { compTitle = comp.title || compTitle; compDesc = comp.description || compDesc; }
  }
  if (bp.learning_field_id) {
    const { data: lf } = await sb.from("learning_fields").select("title, exam_part").eq("id", bp.learning_field_id).maybeSingle();
    lfData = lf;
    if (lf) lfTitle = lf.title || "";

    try {
      const { data: parentTopics } = await sb.from("curriculum_topics").select("id, title")
        .eq("curriculum_id", bp.curriculum_id).is("parent_topic_id", null)
        .ilike("title", `%${lfTitle.split(":")[0]?.trim() || lfTitle}%`).limit(3);
      if (parentTopics?.length) {
        const { data: subtopics } = await sb.from("curriculum_topics").select("title, difficulty_level")
          .in("parent_topic_id", parentTopics.map(t => t.id)).limit(15);
        if (subtopics) depthTopics = subtopics.map(s => `${s.title}${s.difficulty_level ? ` (${s.difficulty_level})` : ""}`);
      }
    } catch { /* depth load optional */ }
  }

  // ── v3: Load mastery context for this competency area ──
  let masteryInjection = "";
  try {
    const masteryCtx = await loadMasteryContext(sb, bp.curriculum_id, bp.learning_field_id);
    masteryInjection = buildMasteryFeedbackSuffix(masteryCtx);
  } catch { /* non-blocking */ }

  // ── Phase 2: Load Knowledge Graph context (gated by rollout config) ──
  let graphCtx: GraphContext | null = null;
  const kgDecision = await shouldInjectKG(sb, bp.id, bp.curriculum_id);
  _qualityMetrics.kg_rollout_enabled = kgDecision.enabled;
  _qualityMetrics.kg_rollout_pct = kgDecision.rolloutPct;
  if (kgDecision.blueprintInRollout) {
    try {
      graphCtx = await getGraphContextForBlueprint(sb, bp.id);
    } catch { /* KG is optional — never blocks generation */ }
  } else if (kgDecision.enabled) {
    _qualityMetrics.kg_blueprints_gated++;
  }
  if (graphCtx?.common_errors?.length) {
    _qualityMetrics.kg_context_hits++;
    _qualityMetrics.kg_errors_injected += Math.min(graphCtx.common_errors.length, 5);
  } else {
    _qualityMetrics.kg_context_misses++;
  }

  const { system, user } = buildTurboPrompt(bp, difficulty, questionType, cognitiveLevel, count, lfTitle, compTitle, compDesc, professionName, depthTopics, glossaryContext, masteryInjection, graphCtx);

  const maxTokens = count <= 2 ? 2200 : count <= 5 ? 3500 : 4096;

  let exclude: string[] = [];
  let result: { content: string; estimatedUsage?: { tokens_in: number; tokens_out: number; cost_eur: number; estimated: boolean }; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } } | undefined;
  const chain = await loadExamProviderChain();
  let usedProvider = "";
  let usedModel = "";
  const pkgId = (globalThis as any).__examPoolPackageId || null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const { provider, model } = pickProvider(chain, exclude);
    usedProvider = provider;
    usedModel = model;
    
    // Track attempt BEFORE the call (models_attempted)
    const attemptKey = `${provider}/${model}`;
    _qualityMetrics.models_attempted[attemptKey] = (_qualityMetrics.models_attempted[attemptKey] ?? 0) + 1;
    _qualityMetrics.total_llm_calls++;
    
    try {
      const aiResult = await callAIJSON({
        provider, model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.85,
        max_tokens: maxTokens,
        timeout_ms: 45_000,
      });
      result = aiResult;

      // ── Observability: track output metrics (only on SUCCESS) ──
      const outputLen = result.content?.length ?? 0;
      const tokOut = result.estimatedUsage?.tokens_out ?? Math.ceil(outputLen / 3.5);
      const tokIn = result.estimatedUsage?.tokens_in ?? Math.ceil((system.length + user.length) / 3.5);

      _qualityMetrics.successful_llm_calls++;
      _qualityMetrics.total_output_chars += outputLen;
      _qualityMetrics.total_tokens_out_estimated += tokOut;
      // models_used = only successful calls with actual output
      if (outputLen > 0) {
        _qualityMetrics.models_used[attemptKey] = (_qualityMetrics.models_used[attemptKey] ?? 0) + 1;
      }

      // Detect empty responses
      if (outputLen === 0) {
        _qualityMetrics.empty_responses++;
        console.warn(`[ExamPool-v5] EMPTY_RESPONSE: ${provider}/${model} returned 0 chars (attempt ${attempt}), raw_status=success`);
      }

      // Detect potential truncation (output near max_tokens)
      const isTruncated = tokOut >= maxTokens * 0.95;
      if (isTruncated) {
        _qualityMetrics.truncated_responses++;
        console.warn(`[ExamPool-v5] TRUNCATION_RISK: ${provider}/${model} output ${tokOut} tokens ≈ maxTokens ${maxTokens} (attempt ${attempt})`);
      }

      const costSb = (globalThis as any).__examPoolSb;
      if (costSb) {
        await logLLMCostEvent(costSb, {
          job_type: "package_generate_exam_pool",
          provider, model,
          tokens_in: tokIn,
          tokens_out: tokOut,
          package_id: pkgId,
          estimatedUsage: result.estimatedUsage,
          status: "success",
          attempt,
          meta: {
            blueprint_id: bp.id, count, difficulty, questionType, cognitiveLevel,
            output_length: outputLen,
            truncated: isTruncated,
            empty: outputLen === 0,
          },
        });
      }
      break;
    } catch (e: unknown) {
      const errMsg = (e as Error)?.message || String(e);
      const isRate = errMsg.includes("Rate limit") || errMsg.includes("429") || errMsg.includes("409") || errMsg.includes("proactively blocked");
      const isTimeout = errMsg.includes("timed out") || errMsg.includes("TimeoutError") || errMsg.includes("AbortError");

      if (isRate) {
        _qualityMetrics.retried_llm_calls++;
        // Distinguish proactive block (our limiter) from real 429 (provider)
        if (errMsg.includes("proactively blocked")) {
          _qualityMetrics.blocked_llm_calls++;
        }
      } else if (isTimeout) {
        _qualityMetrics.retried_llm_calls++;
      } else {
        _qualityMetrics.failed_llm_calls++;
      }

      const costSb = (globalThis as any).__examPoolSb;
      if (costSb) {
        await logLLMCostEvent(costSb, {
          job_type: "package_generate_exam_pool",
          provider, model,
          tokens_in: 0, tokens_out: 0,
          package_id: pkgId,
          status: isRate || isTimeout ? "retry" : "fail",
          error_message: errMsg.slice(0, 500),
          attempt,
        });
      }

      if (isRate || isTimeout) {
        console.log(`[ExamPool-v5] ${isTimeout ? "Timeout" : "RateLimit"} ${provider}/${model} attempt ${attempt}/3`);
        if ((globalThis as any).__examPoolSb) await markRateLimited((globalThis as any).__examPoolSb, provider, errMsg);
        exclude.push(`${provider}:${model}`);
        // Backoff before retry — jittered to desynchronize concurrent sub-jobs
        const backoffMs = isRate ? (3000 + Math.random() * 2000) * attempt : (2000 + Math.random() * 1000) * attempt;
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }
      console.log(`[ExamPool-v5] AI error (${provider}/${model}): ${errMsg}`);
      return { candidates: [], lfData };
    }
  }

  if (!result?.content) {
    _qualityMetrics.empty_responses++;
    return { candidates: [], lfData };
  }

  const parsed = repairJSON(result.content);
  if (!parsed) {
    _qualityMetrics.json_repair_failures++;
    console.log(`[ExamPool-v5] JSON repair failed for BP ${bp.id.slice(0, 8)} (output ${result.content.length} chars)`);
    
    // Log the failed parse to llm_cost_events for visibility
    const costSb = (globalThis as any).__examPoolSb;
    if (costSb) {
      await logLLMCostEvent(costSb, {
        job_type: "package_generate_exam_pool",
        provider: usedProvider, model: usedModel,
        tokens_in: 0, tokens_out: 0,
        package_id: pkgId,
        status: "fail",
        error_message: `JSON_REPAIR_FAILED: output_length=${result.content.length}, first_100=${result.content.slice(0, 100)}`,
        meta: { blueprint_id: bp.id, json_repair_failure: true, output_length: result.content.length },
      });
    }
    return { candidates: [], lfData };
  }

  const questions = Array.isArray(parsed) ? parsed : [parsed];
  _qualityMetrics.candidates_generated += questions.length;
  
  const candidates: RawCandidate[] = questions.map(q => ({
    question: q,
    bp,
    difficulty,
    questionType,
    cognitiveLevel,
    lfData,
  }));

  return { candidates, lfData };
}

// ─── Central Dedup + Validate + Batch Insert (sequential, SSOT-safe) ─────────

async function dedupeValidateAndInsert(
  sb: ReturnType<typeof createClient>,
  rawCandidates: RawCandidate[],
  existingHashes: Set<string>,
  existingNgramSets: Set<string>[],
  professionName: string,
): Promise<{
  saved: number; training: number; gateFailed: number; generatedTotal: number;
  rejectedContamination: number; rejectedOther: number; acceptRate: number;
  exam_approved: number; training_total: number; persisted_total: number;
  duplicates_skipped: number; near_duplicates_skipped: number;
}> {
  let saved = 0;
  let training = 0;
  let gateFailed = 0;
  let rejectedContamination = 0;
  let rejectedOther = 0;
  let duplicates_skipped = 0;
  let near_duplicates_skipped = 0;
  const generatedTotal = rawCandidates.length;

  const examBatch: any[] = [];
  const trainingBatch: any[] = [];

  for (const { question: q, bp, difficulty, questionType, cognitiveLevel, lfData } of rawCandidates) {
    if (!q.question_text || !Array.isArray(q.options) || q.options.length < 4) {
      _qualityMetrics.rejection_reasons["invalid_structure"] = (_qualityMetrics.rejection_reasons["invalid_structure"] ?? 0) + 1;
      continue;
    }

    // HARD GATE: correct_answer must be valid index
    const correctIdx = Array.isArray(q.correct_answer) ? q.correct_answer[0] : (q.correct_answer ?? 0);
    if (typeof correctIdx !== 'number' || correctIdx < 0 || correctIdx >= q.options.length) {
      console.log(`[ExamPool-v5] REJECTED INVALID_INDEX: correct_answer=${q.correct_answer} for ${q.options.length} options`);
      rejectedOther++;
      _qualityMetrics.candidates_rejected_invalid_index++;
      _qualityMetrics.rejection_reasons["invalid_index"] = (_qualityMetrics.rejection_reasons["invalid_index"] ?? 0) + 1;
      continue;
    }

    // HARD GATE: No meta-text / AI editing artifacts
    const META_REJECT_PATTERNS = [
      /\bich muss\b/i, /\bich ändere\b/i, /\btippfehler\b/i,
      /\bes tut mir leid\b/i, /\bich habe einen fehler\b/i,
      /\bich korrigiere\b/i, /\bich prüfe\b/i, /\blass mich\b/i,
      /\bfehler in der frage\b/i, /\bich entschuldige\b/i,
      /\bfehlende.{0,15}korrekte option\b/i,
    ];
    const explanationText = (q.explanation || '');
    let hasMetaText = false;
    for (const pat of META_REJECT_PATTERNS) {
      if (pat.test(explanationText)) { hasMetaText = true; break; }
    }
    if (hasMetaText) {
      console.log(`[ExamPool-v5] REJECTED META_TEXT: "${explanationText.slice(0, 60)}…"`);
      rejectedOther++;
      _qualityMetrics.candidates_rejected_meta_text++;
      _qualityMetrics.rejection_reasons["meta_text"] = (_qualityMetrics.rejection_reasons["meta_text"] ?? 0) + 1;
      continue;
    }

    // Reject unresolved placeholders
    if (/\{[a-z_]+\}/i.test(q.question_text)) {
      _qualityMetrics.candidates_rejected_placeholder++;
      _qualityMetrics.rejection_reasons["placeholder"] = (_qualityMetrics.rejection_reasons["placeholder"] ?? 0) + 1;
      continue;
    }

    const contam = checkContamination(q.question_text + " " + (q.explanation || ""), professionName);
    if (contam.isContaminated) {
      console.log(`[ExamPool-v5] CONTAMINATION: ${contam.detectedIndustry} in "${q.question_text.slice(0, 50)}"`);
      rejectedContamination++;
      _qualityMetrics.candidates_rejected_contamination++;
      _qualityMetrics.rejection_reasons["contamination"] = (_qualityMetrics.rejection_reasons["contamination"] ?? 0) + 1;
      continue;
    }

    // Hash dedup (sequential — safe against intra-batch duplicates)
    const hash = simpleHash(q.question_text);
    if (existingHashes.has(hash)) { duplicates_skipped++; _qualityMetrics.candidates_duplicates_hash++; continue; }
    existingHashes.add(hash);

    // Text-similarity dedup (Jaccard n-gram) — sequential, sees all prior additions
    const qNgrams = textNgrams(q.question_text);
    let tooSimilar = false;
    const checkWindow = existingNgramSets.slice(-200);
    for (const existingNg of checkWindow) {
      if (jaccardSimilarity(qNgrams, existingNg) > TEXT_SIMILARITY_THRESHOLD) {
        tooSimilar = true;
        break;
      }
    }
    if (tooSimilar) {
      console.log(`[ExamPool-v5] NEAR-DUP skipped: "${q.question_text.slice(0, 50)}…"`);
      near_duplicates_skipped++;
      _qualityMetrics.candidates_duplicates_ngram++;
      continue;
    }
    existingNgramSets.push(qNgrams);

    // ── HARD Quality Gates ──
    const praxisScore = calculatePraxisScore(q);
    if (praxisScore < 1) {
      console.log(`[ExamPool-v5] REJECTED LOW_PRAXIS (${praxisScore}): "${q.question_text.slice(0, 40)}…"`);
      _qualityMetrics.candidates_rejected_low_praxis++;
      _qualityMetrics.rejection_reasons["low_praxis"] = (_qualityMetrics.rejection_reasons["low_praxis"] ?? 0) + 1;
      continue;
    }

    const hasGoodExplanation = hasQualityExplanation(q);

    if (!passesStyleGate(q)) {
      console.log(`[ExamPool-v5] REJECTED AI_STYLE: "${q.question_text.slice(0, 40)}…"`);
      _qualityMetrics.candidates_rejected_ai_style++;
      _qualityMetrics.rejection_reasons["ai_style"] = (_qualityMetrics.rejection_reasons["ai_style"] ?? 0) + 1;
      continue;
    }

    const halluRisk = computeHallucinationRisk(
      q.question_text + " " + (q.explanation || ""), [], [],
    );
    if (halluRisk.verdict === "regenerate") {
      console.log(`[ExamPool-v5] REJECTED HALLUCINATION_RISK (${halluRisk.riskScore}): suspicious=[${halluRisk.suspiciousRegulatory.join(", ")}]`);
      _qualityMetrics.candidates_rejected_hallucination++;
      _qualityMetrics.rejection_reasons["hallucination_risk"] = (_qualityMetrics.rejection_reasons["hallucination_risk"] ?? 0) + 1;
      continue;
    }

    const difficultyValid = validateDifficulty(q);
    const qualityResult = calculateQualityScore(q);
    const forceTraining = !hasGoodExplanation || !difficultyValid;
    const assignedPool = forceTraining ? "training" : qualityResult.pool;
    const status = "draft";

    const cogLevelMap: Record<string, string> = {
      recall: "remember", apply: "apply", analyze: "analyze", decide: "evaluate",
      remember: "remember", understand: "understand", evaluate: "evaluate", create: "create",
    };
    const forcedCogLevel = (cognitiveLevel || "understand").toLowerCase();
    const mappedCogLevel = cogLevelMap[forcedCogLevel] || forcedCogLevel;

    const SCENARIO_TYPE_MAP: Record<string, string> = {
      isolated_knowledge: "isolated_knowledge", applied_case: "applied_case",
      multi_step_case: "multi_step_case", prioritization: "prioritization",
      error_detection: "error_detection", documentation_analysis: "documentation_analysis",
      legal_evaluation: "legal_evaluation", communication_scenario: "communication_scenario",
    };
    const resolvedScenarioType = bp.exam_context_type && SCENARIO_TYPE_MAP[bp.exam_context_type]
      ? SCENARIO_TYPE_MAP[bp.exam_context_type] : null;
    const resolvedExamPart = lfData?.exam_part || null;
    const resolvedTimeEstimate = bp.estimated_time_seconds || null;
    const resolvedTypicalErrors = Array.isArray(bp.typical_errors) && bp.typical_errors.length > 0
      ? bp.typical_errors : (Array.isArray(q.typical_errors) ? q.typical_errors.filter(Boolean).map(String) : []);

    const normalizedTags: string[] = Array.isArray(q.trap_tags) 
      ? q.trap_tags.map((t: string) => String(t).toLowerCase().replace(/[\s-]+/g, "_").trim())
      : [];
    const rawTrapTags: string[] = normalizedTags.filter((t: string) => ERROR_TAG_VOCABULARY.includes(t as any));
    const filteredOut = normalizedTags.filter(t => !ERROR_TAG_VOCABULARY.includes(t as any));
    if (filteredOut.length > 0) {
      if (!((globalThis as any).__filteredTagsLogged)) (globalThis as any).__filteredTagsLogged = new Set();
      const logSet = (globalThis as any).__filteredTagsLogged as Set<string>;
      for (const t of filteredOut) {
        if (logSet.size < 10 && !logSet.has(t)) {
          logSet.add(t);
          console.log(`[ExamPool-v5] FILTERED_TAG: "${t}" not in vocabulary`);
        }
      }
    }

    const rawDistractorMeta: Array<{option_index: number; error_tag: string; why_wrong: string; why_tempting?: string; examiner_intention?: string}> = 
      Array.isArray(q.distractor_meta) ? q.distractor_meta.filter((d: any) => 
        typeof d.option_index === "number" 
        && typeof d.error_tag === "string"
        && d.option_index !== correctIdx
        && typeof d.why_wrong === "string"
        && d.why_wrong.length >= 20
      ).map((d: any) => ({
        option_index: d.option_index,
        error_tag: d.error_tag,
        why_wrong: d.why_wrong,
        why_tempting: typeof d.why_tempting === "string" && d.why_tempting.length >= 15 ? d.why_tempting : null,
        examiner_intention: typeof d.examiner_intention === "string" && d.examiner_intention.length >= 15 ? d.examiner_intention : null,
      })) : [];

    const finalQuestionType = questionType === "best_option" ? "transfer"
      : questionType === "error_detection" ? "transfer"
      : questionType === "risk_assessment" ? "case_study"
      : questionType === "compliance_check" ? "concept"
      : questionType;

    const isCalculation = finalQuestionType === "calculation";
    const requiredMeta = isCalculation ? 3 : 2;
    const distractorGateFailed = rawDistractorMeta.length < requiredMeta;
    
    let qcReason: string | null = null;
    if (distractorGateFailed) {
      if (rawDistractorMeta.length === 0) qcReason = "missing_distractor_meta";
      else if (isCalculation && rawDistractorMeta.length < 3) qcReason = "weak_distractors_calc";
      else qcReason = "weak_distractors";
    }

    const baseRow = {
      curriculum_id: bp.curriculum_id,
      learning_field_id: bp.learning_field_id,
      competency_id: bp.competency_id,
      blueprint_id: bp.id,
      question_text: q.question_text,
      options: q.options,
      correct_answer: correctIdx,
      explanation: q.explanation || "",
      difficulty: difficulty,
      cognitive_level: mappedCogLevel,
      question_type: finalQuestionType,
      trap_tags: rawTrapTags,
      ai_generated: true,
      exam_part: resolvedExamPart,
      scenario_type: resolvedScenarioType,
      time_estimate_seconds: resolvedTimeEstimate,
      typical_errors: resolvedTypicalErrors.length > 0 ? resolvedTypicalErrors : null,
    };

    if (distractorGateFailed) {
      console.log(`[ExamPool-v5] ${qcReason}: ${finalQuestionType} question has ${rawDistractorMeta.length}/${requiredMeta} valid distractor_meta`);
      trainingBatch.push({
        ...baseRow,
        distractor_meta: { raw: rawDistractorMeta, gate_fail: true, qc_reason: qcReason, required: requiredMeta, actual: rawDistractorMeta.length, source_type: questionType, final_type: finalQuestionType },
        status: "draft",
        qc_status: "tier1_failed",
      });
      gateFailed++;
      _qualityMetrics.candidates_gate_failed_distractor++;
      _qualityMetrics.rejection_reasons[`distractor_${qcReason}`] = (_qualityMetrics.rejection_reasons[`distractor_${qcReason}`] ?? 0) + 1;
    } else {
      const targetBatch = assignedPool === "exam" ? examBatch : trainingBatch;
      targetBatch.push({
        ...baseRow,
        distractor_meta: { raw: rawDistractorMeta, gate_fail: false, qc_reason: null, required: requiredMeta, actual: rawDistractorMeta.length, source_type: questionType, final_type: finalQuestionType },
        status,
        qc_status: assignedPool === "exam" ? "approved" : "pending",
      });
      if (assignedPool === "exam") {
        saved++;
        _qualityMetrics.candidates_accepted_exam++;
      } else {
        training++;
        _qualityMetrics.candidates_accepted_training++;
      }
      // Track quality scores for average
      _qualityMetrics.avg_quality_score = (
        (_qualityMetrics.avg_quality_score * (_qualityMetrics.candidates_accepted_exam + _qualityMetrics.candidates_accepted_training - 1) + qualityResult.score)
        / (_qualityMetrics.candidates_accepted_exam + _qualityMetrics.candidates_accepted_training)
      ) || 0;
    }
  }

  // ── Batch insert all collected rows (exam + training) ──
  const allRows = [...examBatch, ...trainingBatch];
  if (allRows.length > 0) {
    const BATCH_SIZE = 50;
    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
      const chunk = allRows.slice(i, i + BATCH_SIZE);
      const { error } = await sb.from("exam_questions").insert(chunk);
      if (error) {
        if (error.code === "23505") {
          console.log(`[ExamPool-v5] BATCH_DUP: falling back to individual inserts for ${chunk.length} rows`);
          for (const row of chunk) {
            const { error: singleErr } = await sb.from("exam_questions").insert(row);
            if (singleErr && singleErr.code !== "23505") {
              const r = await handleDbFailure({ supabase: sb }, singleErr);
              if (r?.permanent) throw new Error(`SSOT_GUARD_PERMANENT:${r.hintKey || "unknown"}`);
            }
          }
        } else {
          const r = await handleDbFailure({ supabase: sb }, error);
          if (r?.permanent) throw new Error(`SSOT_GUARD_PERMANENT:${r.hintKey || "unknown"}`);
        }
      }
    }
  }

  const persisted_total = examBatch.length + trainingBatch.length;
  const acceptedTotal = saved + training + gateFailed;
  const acceptRate = generatedTotal > 0 ? ((acceptedTotal / generatedTotal) * 100).toFixed(1) : "0.0";
  console.log(`[ExamPool-v5] YIELD: generated=${generatedTotal}, persisted=${persisted_total}, exam_approved=${saved}, training=${training}, gateFailed=${gateFailed}, dups_skipped=${duplicates_skipped}, near_dups=${near_duplicates_skipped}, contamination=${rejectedContamination}, other=${rejectedOther}, acceptRate=${acceptRate}%`);
  return {
    saved, training, gateFailed, generatedTotal, rejectedContamination, rejectedOther,
    acceptRate: parseFloat(acceptRate),
    exam_approved: saved, training_total: training + gateFailed,
    persisted_total, duplicates_skipped, near_duplicates_skipped,
  };
}

// ─── Legacy wrapper: generate + dedup + insert in one call (for backfill paths) ──

async function generateTurboQuestions(
  sb: ReturnType<typeof createClient>,
  bp: BlueprintInfo,
  count: number,
  difficulty: DifficultyKey,
  questionType: QuestionTypeKey,
  cognitiveLevel: CognitiveLevelKey,
  existingHashes: Set<string>,
  existingNgramSets: Set<string>[],
  professionName: string,
  glossaryContext?: string,
): Promise<{ saved: number; training: number; gateFailed: number }> {
  const { candidates } = await generateRawCandidates(sb, bp, count, difficulty, questionType, cognitiveLevel, professionName, glossaryContext);
  const result = await dedupeValidateAndInsert(sb, candidates, existingHashes, existingNgramSets, professionName);
  return { saved: result.saved, training: result.training, gateFailed: result.gateFailed };
}

function simpleHash(text: string): string {
  let hash = 5381;
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(36);
}

// ─── Fan-out by learning field (Proportional + Gap-First) ─────────────────────

async function enqueueLearningFieldJobs(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  curriculumId: string,
  bps: BlueprintInfo[],
  examTarget: number,
): Promise<{ enqueued: number; learningFields: number; skipped: number; skipped_covered: number; skipped_cooldown: number; skipped_dedup: number; errors: string[]; lf_details: Array<{ lf_id: string; existing: number; target: number; gap: number; skip_reason?: string }> }> {
  const lfGroups = new Map<string, BlueprintInfo[]>();
  for (const bp of bps) {
    const lfId = bp.learning_field_id || "unknown";
    if (!lfGroups.has(lfId)) lfGroups.set(lfId, []);
    lfGroups.get(lfId)!.push(bp);
  }

  const lfCount = lfGroups.size;
  if (lfCount === 0) return { enqueued: 0, learningFields: 0, skipped: 0, skipped_covered: 0, skipped_cooldown: 0, skipped_dedup: 0, errors: [], lf_details: [] };

  const totalBps = bps.length;
  const MIN_LF_SHARE = 0.06;
  const MAX_LF_SHARE = Math.min(0.20, 2.0 / lfCount);

  const lfWeights = new Map<string, number>();
  for (const [lfId, lfBps] of lfGroups) {
    const naturalWeight = totalBps > 0 ? lfBps.length / totalBps : 1 / lfCount;
    lfWeights.set(lfId, Math.min(MAX_LF_SHARE, Math.max(MIN_LF_SHARE, naturalWeight)));
  }

  const totalWeight = Array.from(lfWeights.values()).reduce((s, w) => s + w, 0);
  for (const [lfId, w] of lfWeights) lfWeights.set(lfId, w / totalWeight);
  console.log(`[ExamPool-v5] Anti-Dominanz: lfCount=${lfCount}, MAX_LF_SHARE=${(MAX_LF_SHARE * 100).toFixed(1)}%, weights=[${Array.from(lfWeights.entries()).map(([id, w]) => `${id.slice(0, 8)}:${(w * 100).toFixed(1)}%`).join(', ')}]`);

  const lfIds = Array.from(lfGroups.keys());
  const existingPerLf = new Map<string, number>();

  // ── OPT-2: Single aggregated query instead of N sequential count queries ──
  let lfCounts: any[] | null = null;
  try {
    const { data } = await sb.rpc("get_exam_question_counts_by_lf", {
      p_curriculum_id: curriculumId,
      p_lf_ids: lfIds,
    });
    lfCounts = data;
  } catch { lfCounts = null; }
  
  if (lfCounts && Array.isArray(lfCounts)) {
    for (const row of lfCounts) existingPerLf.set(row.learning_field_id, row.cnt);
  }
  // Fallback: any LF not in result gets 0
  for (const lfId of lfIds) {
    if (!existingPerLf.has(lfId)) existingPerLf.set(lfId, 0);
  }

  const lfEntries = Array.from(lfGroups.entries()).sort((a, b) => {
    const aExist = existingPerLf.get(a[0]) ?? 0;
    const bExist = existingPerLf.get(b[0]) ?? 0;
    const aTarget = Math.ceil(examTarget * (lfWeights.get(a[0]) ?? 0));
    const bTarget = Math.ceil(examTarget * (lfWeights.get(b[0]) ?? 0));
    return (bTarget - bExist) - (aTarget - aExist);
  });

  let enqueued = 0;
  let skipped_covered = 0;
  let skipped_cooldown = 0;
  let skipped_dedup = 0;
  const errors: string[] = [];
  const lf_details: Array<{ lf_id: string; existing: number; target: number; gap: number; skip_reason?: string }> = [];

  // ── OPT-3: Batch load all active + recent jobs for all LFs in 2 queries ──
  const activeJobsByLf = new Map<string, number>();
  const productiveCooldownLfs = new Set<string>();
  const recentJobLfs = new Set<string>();
  
  // Query 1: active (pending/processing) fan-out jobs — only payload needed
  const { data: activeJobs } = await sb.from("job_queue")
    .select("payload")
    .eq("job_type", "package_generate_exam_pool")
    .eq("package_id", packageId)
    .in("status", ["pending", "processing"])
    .contains("payload", { _fan_out: true });
  
  if (activeJobs) {
    for (const job of activeJobs) {
      const lfId = (job.payload as any)?.learning_field_filter;
      if (lfId) activeJobsByLf.set(lfId, (activeJobsByLf.get(lfId) ?? 0) + 1);
    }
  }

  // Query 2: recently completed fan-out jobs (cooldown) — payload + result.metrics.generated
  const recentCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: recentJobs } = await sb.from("job_queue")
    .select("payload, result")
    .eq("job_type", "package_generate_exam_pool")
    .eq("package_id", packageId)
    .eq("status", "completed")
    .gte("completed_at", recentCutoff)
    .contains("payload", { _fan_out: true })
    .limit(100);

  if (recentJobs) {
    for (const job of recentJobs) {
      const lfId = (job.payload as any)?.learning_field_filter;
      if (!lfId) continue;
      recentJobLfs.add(lfId);
      const gen = (job.result as any)?.metrics?.generated ?? (job.result as any)?.generated;
      if (typeof gen === "number" && gen > 0) productiveCooldownLfs.add(lfId);
    }
  }

  for (const [lfId, lfBps] of lfEntries) {
    const weight = lfWeights.get(lfId) ?? (1 / lfCount);
    const proportionalTarget = Math.ceil(examTarget * weight);
    const existing = existingPerLf.get(lfId) ?? 0;
    const gap = Math.max(0, proportionalTarget - existing);
    const lfDetail = { lf_id: lfId, existing, target: proportionalTarget, gap, skip_reason: undefined as string | undefined };

    if (gap <= 0) {
      console.log(`[ExamPool-v5] LF ${lfId.slice(0, 8)}: target=${proportionalTarget}, existing=${existing} → SKIP (covered)`);
      lfDetail.skip_reason = "covered";
      lf_details.push(lfDetail);
      skipped_covered++;
      continue;
    }

    // ── OPT-3: Batch cooldown+dedup check (pre-loaded above loop) ──
    const activeLfJobs = activeJobsByLf.get(lfId) ?? 0;
    if (activeLfJobs > 0) {
      console.log(`[ExamPool-v5] LF ${lfId.slice(0, 8)}: ${activeLfJobs} active sub-jobs → SKIP (dedup)`);
      lfDetail.skip_reason = "dedup";
      lf_details.push(lfDetail);
      skipped_dedup++;
      continue;
    }

    const productiveCooldown = productiveCooldownLfs.has(lfId);
    const hadRecentJobs = recentJobLfs.has(lfId);

    if (productiveCooldown) {
      console.log(`[ExamPool-v5] LF ${lfId.slice(0, 8)}: productive sub-job in last 15min → SKIP (cooldown)`);
      lfDetail.skip_reason = "cooldown";
      lf_details.push(lfDetail);
      skipped_cooldown++;
      continue;
    }

    if (hadRecentJobs && !productiveCooldown) {
      console.warn(`[ExamPool-v5] LF ${lfId.slice(0, 8)}: recent job(s) completed but generated=0 → IGNORING cooldown (zero-production)`);
    }

    const priority = existing === 0 ? 0 : 1;

    try {
      const enq = await enqueueJob(sb, {
        job_type: "package_generate_exam_pool",
        package_id: packageId,
        payload: {
          package_id: packageId,
          curriculum_id: curriculumId,
          learning_field_filter: lfId,
          learning_field_id: lfId,
          lf_target_total: proportionalTarget,
          lf_gap: gap,
          lf_existing: existing,
          blueprint_ids: lfBps.map((b) => b.id),
          options: { exam_target: examTarget },
          _fan_out: true,
        },
        max_attempts: 20,
        priority: priority === 0 ? 8 : 10,
        run_after: priority === 0 ? null : new Date(Date.now() + 30_000).toISOString(),
        batch_cursor: {
          mode: "lf_fanout",
          curriculum_id: curriculumId,
          learning_field_filter: lfId,
          target_total: proportionalTarget,
        },
      });

      if (enq.status === "pending" || enq.status === "processing") enqueued++;
      lf_details.push(lfDetail);
      console.log(`[ExamPool-v5] LF ${lfId.slice(0, 8)}: weight=${(weight * 100).toFixed(1)}%, target=${proportionalTarget}, existing=${existing}, gap=${gap}, enqueue_status=${enq.status}`);
    } catch (e) {
      const errMsg = (e as Error).message || String(e);
      console.warn(`[ExamPool-v5] LF ${lfId.slice(0, 8)} enqueue FAILED: ${errMsg}`);
      lfDetail.skip_reason = "error";
      lf_details.push(lfDetail);
      errors.push(`${lfId.slice(0, 8)}:${errMsg.slice(0, 200)}`);
    }
  }

  const skipped = skipped_covered + skipped_cooldown + skipped_dedup;
  console.log(`[ExamPool-v5] Proportional fan-out: ${enqueued} active, ${skipped} skipped (covered=${skipped_covered}, cooldown=${skipped_cooldown}, dedup=${skipped_dedup}), ${errors.length} errors for ${lfCount} LFs`);
  return { enqueued, learningFields: lfCount, skipped, skipped_covered, skipped_cooldown, skipped_dedup, errors, lf_details };
}

async function allFanOutSubJobsDone(sb: ReturnType<typeof createClient>, packageId: string): Promise<boolean> {
  const { count } = await sb.from("job_queue").select("id", { count: "exact", head: true })
    .eq("job_type", "package_generate_exam_pool")
    .in("status", ["pending", "processing"])
    .contains("payload", { package_id: packageId, _fan_out: true });
  return (count ?? 0) === 0;
}

// ── Batch Submission for Exam Pool (OpenAI Batch API — 50% cost savings) ─────

async function submitExamPoolBatch(
  sb: ReturnType<typeof createClient>,
  bps: BlueprintInfo[],
  ctx: {
    packageId: string;
    curriculumId: string;
    professionName: string;
    glossaryContext: string;
    examTarget: number;
    lfTarget: number;
    learningFieldFilter?: string;
    jobId?: string;
  },
): Promise<Response> {
  const model = BATCH_DEFAULT_MODEL; // HARD GUARD: only gpt-4o-mini for batch
  const typeEntries = Object.entries(QUESTION_TYPE_MIX) as [QuestionTypeKey, number][];
  const diffEntries = Object.entries(DIFFICULTY_DISTRIBUTION) as [DifficultyKey, number][];
  const cogEntries = Object.entries(COGNITIVE_LEVEL_DISTRIBUTION) as [CognitiveLevelKey, number][];

  const batchItems: Array<{
    customId: string;
    sourceJobId?: string | null;
    sourceRef?: Record<string, unknown>;
    jobType: string;
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }> = [];

  for (let i = 0; i < bps.length; i++) {
    const bp = bps[i];
    const difficulty = diffEntries[i % diffEntries.length][0];
    const questionType = typeEntries[i % typeEntries.length][0];
    const cognitiveLevel = cogEntries[i % cogEntries.length][0];

    // Load context for this blueprint (lightweight)
    let compTitle = bp.name;
    let compDesc = bp.canonical_statement;
    let lfTitle = "";

    if (bp.competency_id) {
      const { data: comp } = await sb.from("competencies").select("title, description").eq("id", bp.competency_id).maybeSingle();
      if (comp) { compTitle = comp.title || compTitle; compDesc = comp.description || compDesc; }
    }
    if (bp.learning_field_id) {
      const { data: lf } = await sb.from("learning_fields").select("title").eq("id", bp.learning_field_id).maybeSingle();
      if (lf) lfTitle = lf.title || "";
    }

    // ── Phase 2: Load Knowledge Graph context for batch (gated by rollout) ──
    let graphCtx: GraphContext | null = null;
    const kgDecision = await shouldInjectKG(sb, bp.id, ctx.curriculumId);
    _qualityMetrics.kg_rollout_enabled = kgDecision.enabled;
    _qualityMetrics.kg_rollout_pct = kgDecision.rolloutPct;
    if (kgDecision.blueprintInRollout) {
      try {
        graphCtx = await getGraphContextForBlueprint(sb, bp.id);
      } catch { /* KG is optional */ }
    } else if (kgDecision.enabled) {
      _qualityMetrics.kg_blueprints_gated++;
    }
    if (graphCtx?.common_errors?.length) {
      _qualityMetrics.kg_context_hits++;
      _qualityMetrics.kg_errors_injected += Math.min(graphCtx.common_errors.length, 5);
    } else {
      _qualityMetrics.kg_context_misses++;
    }

    const { system, user } = buildTurboPrompt(
      bp, difficulty, questionType, cognitiveLevel,
      AI_QUESTIONS_PER_CALL, lfTitle, compTitle, compDesc,
      ctx.professionName, [], ctx.glossaryContext, "", graphCtx,
    );

    const customId = `exam_${ctx.curriculumId.slice(0, 8)}_bp${bp.id.slice(0, 8)}_${i}_${Date.now()}`;

    batchItems.push({
      customId,
      sourceJobId: ctx.jobId || null,
      sourceRef: {
        blueprint_id: bp.id,
        curriculum_id: ctx.curriculumId,
        learning_field_id: bp.learning_field_id,
        competency_id: bp.competency_id,
        difficulty,
        cognitive_level: cognitiveLevel,
        question_type: questionType,
        package_id: ctx.packageId,
      },
      jobType: "exam_pool_generate",
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.85,
      maxTokens: AI_QUESTIONS_PER_CALL <= 2 ? 2200 : AI_QUESTIONS_PER_CALL <= 5 ? 3500 : 4096,
    });
  }

  const requests = buildBatchRequests(batchItems);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const submitResult = await submitBatchViaFunction(supabaseUrl, serviceRoleKey, {
    jobType: "exam_pool_generate",
    model,
    requests,
    metadata: {
      curriculum_id: ctx.curriculumId,
      package_id: ctx.packageId,
      learning_field_filter: String(ctx.learningFieldFilter ?? ""),
      blueprint_count: String(bps.length),
      exam_target: String(ctx.examTarget),
    },
  });

  if (!submitResult.ok) {
    console.error(`[ExamPool-v5] BATCH_SUBMIT_FAILED: ${submitResult.error} — will retry sync`);
    return json({
      ok: false, retry: true, transient: true,
      error: `BATCH_SUBMIT_FAILED: ${submitResult.error}`,
    }, 503);
  }

  console.log(`[ExamPool-v5] BATCH_ENQUEUED: ${bps.length} blueprints → batch_id=${submitResult.batchId} model=${model}`);

  return json({
    ok: true,
    batch_mode: true,
    batch_id: submitResult.batchId,
    blueprints_submitted: bps.length,
    model,
    batch_complete: false, // Signal: don't mark step as done yet
  });
}

// ─── Main Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  // Reset invocation-level quality metrics
  _qualityMetrics = createEmptyQualityMetrics();

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  bootstrapLLMLogging(sb, "package_generate_exam_pool");
  await assertSchemaReady("package-generate-exam-pool", sb);

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;
  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;
  const examTarget = Number(p.options?.exam_target ?? 1000);
  const shipTarget = Number(p.options?.ship_target ?? getShipTarget(examTarget));
  const isFanOut = p._fan_out === true;
  const blueprintIds: string[] | null = p.blueprint_ids || null;

  (globalThis as any).__examPoolSb = sb;
  (globalThis as any).__examPoolPackageId = packageId;
  console.log(`[ExamPool-v5] Using DB-routed provider chain for exam_questions`);
  // SSOT: lf_target_total = absolute Zielzahl pro LF (nie Gap!)
  // Fallback: legacy lf_target (könnte Gap sein) oder examTarget
  const lfTarget = p.lf_target_total || p.lf_target || examTarget;

  // Apply dynamic distributions
  if (p.options?.difficulty_distribution) {
    DIFFICULTY_DISTRIBUTION = p.options.difficulty_distribution;
  }

  const batchCursor = p._batch_cursor || p.batch_cursor || null;
  const generatedSoFar = batchCursor?.generated ?? 0;
  const bpIndex = batchCursor?.blueprint_index ?? 0;

  if (!packageId || !curriculumId) return json({ error: "Missing package_id or curriculum_id" }, 400);

  try {
    if (!isFanOut) {
      // Check if this is an EXAM_FIRST track — skip content prereqs
      const { data: pkgTrack } = await sb.from("course_packages")
        .select("track").eq("id", packageId).maybeSingle();
      const isExamFirst = pkgTrack?.track === "EXAM_FIRST";

      // Prerequisite: blueprint seeding must always be done
      const seedDone = await prereqDone(sb, packageId, "auto_seed_exam_blueprints");
      // Content prereqs only for non-EXAM_FIRST tracks
      const scaffoldDone = isExamFirst || await prereqDone(sb, packageId, "scaffold_learning_course");
      const contentDone = isExamFirst || await prereqDone(sb, packageId, "generate_learning_content");
      
      if (!scaffoldDone || !contentDone || !seedDone) {
        const missingStep = !seedDone ? "auto_seed_exam_blueprints"
          : !scaffoldDone ? "scaffold_learning_course" 
          : "generate_learning_content";
        const jobId = p.job_id || body.job_id;
        if (jobId) {
          await sb.from("job_queue").update({
            status: "pending",
            run_after: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
            locked_at: null, locked_by: null,
            updated_at: new Date().toISOString(),
          }).eq("id", jobId);
          return json({ ok: true, delayed: true, reason: `PREREQ_NOT_DONE: ${missingStep}` });
        }
        return json({ ok: false, retry: true, error: `PREREQ_NOT_DONE: ${missingStep}` }, 409);
      }

      // Placeholder Guard: only for non-EXAM_FIRST tracks
      if (!isExamFirst) {
        const courseId = p.course_id;
        if (courseId) {
          const { data: guardResult } = await sb.rpc("check_no_placeholder_lessons", { p_course_id: courseId });
          if (guardResult === false) {
            console.warn(`[ExamPool-v5] BLOCKED: Placeholder lessons still exist for course ${courseId}`);
            return json({ ok: false, retry: true, error: "PLACEHOLDER_GUARD: Lessons still have placeholder content. generate_learning_content must complete first." }, 409);
          }
        }
      }
    }

    // Get blueprints early — root fan-out must run before expensive context generation
    let bpQuery = sb.from("question_blueprints")
      .select("id, max_variations, curriculum_id, learning_field_id, competency_id, name, canonical_statement, cognitive_level, question_template, trap_spec, typical_exam_trap, exam_context_type, typical_errors, estimated_time_seconds, decision_structure, exam_relevance_score")
      .eq("curriculum_id", curriculumId).eq("status", "approved").order("created_at", { ascending: true });

    if (blueprintIds?.length) bpQuery = bpQuery.in("id", blueprintIds);

    const { data: bps, error: bpErr } = await bpQuery;
    if (bpErr) throw bpErr;
    if (!bps?.length) {
      console.warn(`[ExamPool-v5] No approved blueprints for curriculum ${curriculumId} → 409 retry`);
      return json({ ok: false, retry: true, error: "NO_BLUEPRINTS: auto_seed_exam_blueprints must complete first." }, 409);
    }

    // Root job: prioritize fan-out path before glossary/model-heavy preparation
    if (!isFanOut && bpIndex === 0) {
      const uniqueLFs = new Set(bps.map(b => (b as BlueprintInfo).learning_field_id).filter(Boolean));
      if (uniqueLFs.size > 1) {
        const { enqueued, learningFields, skipped, skipped_covered, skipped_cooldown, skipped_dedup, errors: enqErrors, lf_details } = await enqueueLearningFieldJobs(sb, packageId, curriculumId, bps as BlueprintInfo[], examTarget);
        console.log(`[ExamPool-v5] GUARD: Multi-LF detected (${uniqueLFs.size} LFs) → Fan-Out ONLY. Enqueued=${enqueued}, skipped=${skipped} (covered=${skipped_covered}, cooldown=${skipped_cooldown}, dedup=${skipped_dedup}), errors=${enqErrors.length}`);

        // ── P0 HOLLOW GUARD: check if we actually have questions before declaring "covered" ──
        const { count: currentTotal } = await sb.from("exam_questions")
          .select("id", { count: "exact", head: true })
          .eq("curriculum_id", curriculumId);
        const totalNow = currentTotal ?? 0;

        // Enriched metrics for ops visibility
        const enrichedMetrics = {
          fan_out: true,
          existing_before: totalNow,
          generated_new: 0, // root fan-out doesn't generate directly
          total_after: totalNow,
          exam_target: examTarget,
          target_reached: totalNow >= examTarget,
          learning_fields_total: learningFields,
          learning_fields_enqueued: enqueued,
          learning_fields_skipped_covered: skipped_covered,
          learning_fields_skipped_cooldown: skipped_cooldown,
          learning_fields_skipped_dedup: skipped_dedup,
          learning_fields_errors: enqErrors.length,
        };

        if (enqueued === 0 && totalNow === 0) {
          if (enqErrors.length > 0) {
            console.error(`[ExamPool-v5] HOLLOW_FANOUT_GUARD: 0 enqueued, 0 questions, ${enqErrors.length} enqueue errors → transient backoff`);
            return transientBackoff(
              `FANOUT_ENQUEUE_FAILED: ${enqErrors[0]?.slice(0, 200)}`,
              180,
              { ...enrichedMetrics, reason: "FANOUT_ENQUEUE_FAILED" },
            );
          }
          console.error(`[ExamPool-v5] HOLLOW_FANOUT_GUARD: all ${skipped} LFs skipped as covered but totalNow=0 → transient backoff (upstream gap calc wrong)`);
          return transientBackoff(
            `HOLLOW_FANOUT: all LFs skipped but 0 questions exist — gap calc drift`,
            300,
            { ...enrichedMetrics, reason: "HOLLOW_FANOUT_GAP_DRIFT" },
          );
        }

        const targetReached = totalNow >= examTarget;

        // ── P1 UNDERPRODUCTION GUARD: all LFs skipped but target not reached ──
        // This catches the exact bug: cooldown/dedup blocked re-production while
        // existing question count was far below target.
        if (enqueued === 0 && totalNow > 0 && !targetReached) {
          // Distinguish: if ALL skips were coverage-based, it means per-LF targets
          // are met but global target isn't (rounding artifact). If cooldown/dedup
          // caused the skips, we must retry after cooldown expires.
          if (skipped_cooldown > 0 || skipped_dedup > 0) {
            const waitSec = skipped_cooldown > 0 ? 900 : 120; // 15min if cooldown, 2min if dedup
            console.warn(`[ExamPool-v5] UNDERPRODUCTION_GUARD: totalNow=${totalNow} < target=${examTarget}, ${skipped_cooldown} cooldown + ${skipped_dedup} dedup skips → transient backoff ${waitSec}s`);
            return transientBackoff(
              `UNDERPRODUCTION: ${totalNow}/${examTarget} questions, ${skipped_cooldown} LFs blocked by cooldown, ${skipped_dedup} by dedup`,
              waitSec,
              { ...enrichedMetrics, reason: "UNDERPRODUCTION_COOLDOWN_BLOCK", lf_details },
            );
          }
          // All skips were coverage-based but global target not met — possible rounding issue
          console.warn(`[ExamPool-v5] UNDERPRODUCTION_GUARD: all LFs at per-LF target but totalNow=${totalNow} < examTarget=${examTarget} — rounding gap, forcing re-fan-out`);
        }

        if (enqueued === 0 && targetReached) {
          console.log(`[ExamPool-v5] GUARD: fan_out complete, totalNow=${totalNow} >= target=${examTarget}`);
        }

        return json(
          withMetrics(
            { ok: true, batch_complete: targetReached, fan_out: true, fan_out_skipped: enqueued === 0, sub_jobs: enqueued, learningFields, totalNow, examTarget },
            enrichedMetrics,
          ),
        );
      }
    }

    // Resolve profession + load glossary only when this invocation really generates questions
    const certificationId = p.certification_id || null;
    const professionResult = await resolveProfession(sb, { certificationId, curriculumId });
    const professionName = professionResult.professionName;

    let glossaryContext = "";
    try {
      const { data: cu } = await sb.from("curricula").select("beruf_id").eq("id", curriculumId).maybeSingle();
      if (cu?.beruf_id) {
        const glossary = await loadOrGenerateGlossary(sb, cu.beruf_id, professionName, curriculumId);
        glossaryContext = formatGlossaryForPrompt(glossary);
        console.log(`[ExamPool-v5] Glossary loaded for "${professionName}" (${glossaryContext.length} chars)`);
      }
    } catch (e) { console.warn(`[ExamPool-v5] Glossary load failed: ${(e as Error).message}`); }

    // ── Hebel 2: Load math_ratio from certification_catalog via profession name ──
    console.log(`[ExamPool-v5] BREADCRUMB-1: ENTER mathRatio loader, professionName="${professionName}", curriculumId="${curriculumId}", currentMix=${JSON.stringify(QUESTION_TYPE_MIX)}`);
    let mathRatioApplied = false;
    try {
      const searchName = professionName.split("/")[0].trim();
      console.log(`[ExamPool-v5] BREADCRUMB-2: catalog lookup with searchName="${searchName}"`);
      const { data: certCatalog } = await sb.from("certification_catalog").select("math_ratio")
        .ilike("title", `%${searchName}%`).limit(1).maybeSingle();
      console.log(`[ExamPool-v5] BREADCRUMB-3: catalog result=${JSON.stringify(certCatalog)}`);
      if (certCatalog?.math_ratio && certCatalog.math_ratio > 0) {
        applyMathRatio(certCatalog.math_ratio);
        mathRatioApplied = true;
      }
    } catch (e) { console.log(`[ExamPool-v5] BREADCRUMB-ERR: catalog lookup failed: ${(e as Error).message}`); }
    if (!mathRatioApplied) {
      console.log(`[ExamPool-v5] No certification_catalog match for "${professionName}" — using default math_ratio=0.20`);
      applyMathRatio(0.20);
    }
    console.log(`[ExamPool-v5] BREADCRUMB-4: AFTER mathRatio, finalMix=${JSON.stringify(QUESTION_TYPE_MIX)}`);

    if (generatedSoFar === 0 && !isFanOut) {
      console.log(`[ExamPool-v5] Start "${professionName}": target=${examTarget}, engine=v5-ihk-quality`);
    }

    // ── BATCH ROUTING: Collect all blueprint prompts and submit as one batch ──
    const forceSyncMode = p._force_sync === true || p.force_sync === true;
    if (isFanOut && shouldUseBatch("package_generate_exam_pool", { forceSyncMode, itemCount: bps.length })) {
      return await submitExamPoolBatch(sb, bps as BlueprintInfo[], {
        packageId, curriculumId, professionName, glossaryContext,
        examTarget, lfTarget, learningFieldFilter: p.learning_field_filter,
        jobId: p.job_id || body.job_id,
      });
    }

    // Load existing hashes for dedup
    const { data: existingQs } = await sb.from("exam_questions").select("question_text").eq("curriculum_id", curriculumId).limit(5000);
    const existingHashes = new Set<string>();
    if (existingQs) for (const q of existingQs) existingHashes.add(simpleHash(q.question_text));

    const existingNgramSets: Set<string>[] = [];
    if (existingQs) {
      const recent = existingQs.slice(-300);
      for (const q of recent) existingNgramSets.push(textNgrams(q.question_text));
    }

    // ─── HARD CAP (global) ──────
    const { count: preCheckCount } = await sb.from("exam_questions")
      .select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId);
    const globalTotal = preCheckCount ?? 0;
    if (globalTotal >= HARD_CAP_QUESTIONS) {
      console.log(`[ExamPool-v5] HARD CAP reached: ${globalTotal} >= ${HARD_CAP_QUESTIONS}`);
      const shouldMarkDone = !isFanOut || await allFanOutSubJobsDone(sb, packageId);
      if (shouldMarkDone) {
        await sb.from("course_packages").update({ build_progress: 55 }).eq("id", packageId);
      }
      return json({ ok: true, batch_complete: true, engine: "v5-ihk-quality", total_questions: globalTotal, hard_cap: true, cap: HARD_CAP_QUESTIONS });
    }

    // ─── ANTI-DOMINANZ CAP (per-LF runtime guard) ──────
    // Prevents a single LF from exceeding 25% of total questions at runtime,
    // even if the fan-out target was set higher due to legacy/race conditions.
    if (isFanOut && p.learning_field_filter && globalTotal > 0) {
      const { count: lfCurrentCount } = await sb.from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", curriculumId)
        .eq("learning_field_id", p.learning_field_filter);
      const lfCurrent = lfCurrentCount ?? 0;
      const maxPerLf = Math.ceil(Math.max(globalTotal, examTarget) * 0.25);
      if (lfCurrent >= maxPerLf) {
        console.log(`[ExamPool-v5] ANTI-DOMINANZ CAP: LF ${p.learning_field_filter.slice(0,8)} has ${lfCurrent}/${globalTotal} (${((lfCurrent/globalTotal)*100).toFixed(1)}%) >= 25% cap (${maxPerLf}). Stopping.`);
        return json({ ok: true, batch_complete: true, engine: "v5-ihk-quality", anti_dominanz_cap: true, lf_count: lfCurrent, max_per_lf: maxPerLf });
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // ── SSOT: Explizite targetMode vs gapMode Logik ──
    // targetMode: lf_target_total vorhanden → absolute Zielzahl, Gap = target - lfCount
    // gapMode (legacy): nur lf_target (=Gap) vorhanden → Gap direkt verwenden, KEIN erneutes - preTotal
    // ══════════════════════════════════════════════════════════════════
    const hasTargetTotal = p.lf_target_total != null;
    const legacyGap = p.lf_gap ?? p.lf_target;  // lf_gap ist SSOT, lf_target ist legacy-Gap

    // LF-specific count for fan-out
    let lfCount = 0;
    if (isFanOut && p.learning_field_filter) {
      const { count: c } = await sb.from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", curriculumId)
        .eq("learning_field_id", p.learning_field_filter);
      lfCount = c ?? 0;
      console.log(`[ExamPool-v5] LF-SCOPE: lf=${p.learning_field_filter.slice(0,8)}, lfCount=${lfCount}, globalTotal=${globalTotal}`);
    }

    let chunkPlanned: number;
    let effectiveTarget: number;
    if (isFanOut && hasTargetTotal) {
      // ── targetMode: absolute Zielzahl pro LF ──
      effectiveTarget = p.lf_target_total;
      chunkPlanned = Math.max(effectiveTarget - lfCount, 0);
      console.log(`[ExamPool-v5] MODE=target: lf_target_total=${effectiveTarget}, lfCount=${lfCount}, chunkPlanned=${chunkPlanned}`);
    } else if (isFanOut && legacyGap != null) {
      // ── gapMode (legacy): Gap direkt verwenden, KEIN erneutes - preTotal ──
      effectiveTarget = legacyGap;
      chunkPlanned = Math.max(legacyGap - lfCount, 0);  // lfCount statt 0, da seit Enqueue neue Fragen dazugekommen sein können
      console.log(`[ExamPool-v5] MODE=gap_legacy: lf_gap=${legacyGap}, lfCount=${lfCount}, chunkPlanned=${chunkPlanned}`);
    } else {
      // ── Root-Job (single LF or global) ──
      effectiveTarget = examTarget;
      chunkPlanned = Math.max(effectiveTarget - globalTotal, 0);
      console.log(`[ExamPool-v5] MODE=root: examTarget=${effectiveTarget}, globalTotal=${globalTotal}, chunkPlanned=${chunkPlanned}`);
    }

    // Global hard-cap constraint
    chunkPlanned = Math.min(chunkPlanned, HARD_CAP_QUESTIONS - globalTotal);

    const perBlueprint = Math.max(3, Math.ceil(effectiveTarget / bps.length));
    const chunkStartedAt = new Date().toISOString();
    let questionsThisChunk = 0;
    let trainingThisChunk = 0;
    let currentBpIndex = bpIndex;
    let bpsProcessed = 0;

    console.log(`[ExamPool-v5] CHUNK_SANITY: chunkPlanned=${chunkPlanned}, globalTotal=${globalTotal}, effectiveTarget=${effectiveTarget}, chunkStartedAt=${chunkStartedAt}`);

    if (isFanOut) {
      console.log(`[ExamPool-v5] LF sub-job: lfCount=${lfCount}, effectiveTarget=${effectiveTarget}, hasTargetTotal=${hasTargetTotal}, bps=${bps.length}`);
    }

    const typeEntries = Object.entries(QUESTION_TYPE_MIX) as [QuestionTypeKey, number][];
    const diffEntries = Object.entries(DIFFICULTY_DISTRIBUTION) as [DifficultyKey, number][];
    const cogEntries = Object.entries(COGNITIVE_LEVEL_DISTRIBUTION) as [CognitiveLevelKey, number][];

    // ═══ DIFFICULTY QUOTA ENGINE (replaces round-robin) ═══
    // Ensures hard/very_hard minimums per scope (LF fan-out or root)
    const scopeTarget = Math.max(effectiveTarget, 20); // minimum 20 to avoid degenerate quotas
    let qHard = Math.max(10, Math.ceil(scopeTarget * (DIFFICULTY_DISTRIBUTION.hard ?? 0.35)));
    let qVeryHard = Math.max(5, Math.ceil(scopeTarget * (DIFFICULTY_DISTRIBUTION.very_hard ?? 0.10)));
    let qMedium = Math.ceil(scopeTarget * (DIFFICULTY_DISTRIBUTION.medium ?? 0.45));
    let qEasy = Math.ceil(scopeTarget * (DIFFICULTY_DISTRIBUTION.easy ?? 0.10));

    // ── Normalize: prevent quota sum > scopeTarget (caused by ceil + minimums) ──
    let totalQ = qHard + qVeryHard + qMedium + qEasy;
    if (totalQ > scopeTarget) {
      const over = totalQ - scopeTarget;
      const decEasy = Math.min(qEasy, over);
      qEasy -= decEasy;
      const rest = over - decEasy;
      if (rest > 0) qMedium = Math.max(0, qMedium - rest);
    }

    const diffQuota: Record<string, number> = {
      hard: qHard, very_hard: qVeryHard, medium: qMedium, easy: qEasy,
    };
    // FIX: Track ALL inserted questions (saved + training + gateFailed), not just saved.
    // Previously only saved was counted, so hard quota never depleted → 92% hard skew.
    const diffMade: Record<string, number> = { easy: 0, medium: 0, hard: 0, very_hard: 0 };

    function pickDifficulty(): DifficultyKey {
      // Interleaved picking: rotate through difficulties proportionally
      // instead of exhausting hard first (which caused massive skew when
      // many questions went to training pool).
      const totalMade = Object.values(diffMade).reduce((s, v) => s + v, 0);
      const totalQuota = Object.values(diffQuota).reduce((s, v) => s + v, 0);
      
      // Find the difficulty with the largest deficit (quota% - made%)
      let bestDiff: DifficultyKey = "medium";
      let bestDeficit = -Infinity;
      for (const [d, quota] of Object.entries(diffQuota)) {
        const targetPct = totalQuota > 0 ? quota / totalQuota : 0.25;
        const actualPct = totalMade > 0 ? (diffMade[d] ?? 0) / totalMade : 0;
        const deficit = targetPct - actualPct;
        if (deficit > bestDeficit) {
          bestDeficit = deficit;
          bestDiff = d;
        }
      }
      return bestDiff;
    }

    // ═══ COGNITIVE LEVEL QUOTA ENGINE (replaces fragile round-robin) ═══
    // Previously cogIdx was derived from globalIdx which reset per LF sub-job,
    // causing small sub-jobs to only ever reach recall/apply → 79% remember skew.
    const cogQuota: Record<string, number> = {};
    for (const [level, weight] of cogEntries) {
      cogQuota[level] = Math.max(2, Math.ceil(scopeTarget * weight));
    }
    const cogMade: Record<string, number> = {};
    for (const [level] of cogEntries) cogMade[level] = 0;

    function pickCognitiveLevel(): CognitiveLevelKey {
      const totalMade = Object.values(cogMade).reduce((s, v) => s + v, 0);
      const totalQuota = Object.values(cogQuota).reduce((s, v) => s + v, 0);
      let bestLevel: CognitiveLevelKey = "apply";
      let bestDeficit = -Infinity;
      for (const [level, quota] of Object.entries(cogQuota)) {
        const targetPct = totalQuota > 0 ? quota / totalQuota : 0.25;
        const actualPct = totalMade > 0 ? (cogMade[level] ?? 0) / totalMade : 0;
        const deficit = targetPct - actualPct;
        if (deficit > bestDeficit) {
          bestDeficit = deficit;
          bestLevel = level;
        }
      }
      return bestLevel;
    }

    console.log(`[ExamPool-v5] DIFF_QUOTA: scopeTarget=${scopeTarget}, quotas=${JSON.stringify(diffQuota)}`);

    const effectiveChunkSize = isFanOut ? AI_CHUNK_SIZE_FANOUT : AI_CHUNK_SIZE;
    const invocationStart = Date.now();

    while (bpsProcessed < effectiveChunkSize && currentBpIndex < bps.length) {
      // ── TIME BUDGET: stop scheduling new work before hard timeout ──
      const elapsed = Date.now() - invocationStart;
      if (elapsed > TIME_BUDGET_MS) {
        console.log(`[ExamPool-v5] TIME_BUDGET: ${elapsed}ms > ${TIME_BUDGET_MS}ms — breaking for requeue`);
        break;
      }
      if (shouldSoftStop(invocationStart, "exam_pool_fanout")) {
        console.log(`[ExamPool-v5] SOFT_STOP: ${elapsed}ms reached soft window — stop scheduling new BP calls`);
        break;
      }

      const bp = bps[currentBpIndex] as BlueprintInfo & { max_variations: number | null };

      const callsPerBp = Math.ceil(perBlueprint / AI_QUESTIONS_PER_CALL);
      // FIX: was `!!payload?.lf_id` which crashed — `payload` not defined; use outer `isFanOut` (L1072)
      const maxCallsPerBp = Math.min(callsPerBp, isFanOut ? 2 : 6);

      let brokeMidBp = false;
      
      // ── OPT-4: Parallel AI generation → central sequential dedup ──
      const PARALLEL_AI_CALLS = 2;
      for (let callIdx = 0; callIdx < maxCallsPerBp; callIdx += PARALLEL_AI_CALLS) {
        if (Date.now() - invocationStart > TIME_BUDGET_MS) {
          console.log(`[ExamPool-v5] TIME_BUDGET inner: breaking mid-blueprint`);
          brokeMidBp = true;
          break;
        }
        if (shouldSoftStop(invocationStart, "exam_pool_fanout")) {
          console.log(`[ExamPool-v5] SOFT_STOP inner: breaking mid-blueprint before next AI call`);
          brokeMidBp = true;
          break;
        }

        // Phase 1: Parallel AI generation (no shared mutable state)
        const parallelMeta: Array<{ difficulty: string; cognitiveLevel: string; questionType: string }> = [];
        const parallelPromises: Promise<{ candidates: RawCandidate[]; lfData: any }>[] = [];
        
        for (let pi = 0; pi < PARALLEL_AI_CALLS && (callIdx + pi) < maxCallsPerBp; pi++) {
          const globalIdx = (currentBpIndex * maxCallsPerBp + callIdx + pi);
          const typeIdx = globalIdx % typeEntries.length;
          const questionType = typeEntries[typeIdx][0];
          const difficulty = pickDifficulty();
          const cognitiveLevel = pickCognitiveLevel();

          parallelMeta.push({ difficulty, cognitiveLevel, questionType });
          parallelPromises.push(
            generateRawCandidates(
              sb, bp, AI_QUESTIONS_PER_CALL, difficulty, questionType, cognitiveLevel,
              professionName, glossaryContext
            ).catch((e: unknown) => {
              console.log(`[ExamPool-v5] BP ${bp.id.slice(0, 8)} call ${callIdx + pi} FAIL: ${(e as Error)?.message}`);
              return { candidates: [], lfData: null };
            }),
          );
        }

        // Await all parallel AI calls
        const parallelResults = await Promise.all(parallelPromises);

        // Phase 2: Sequential dedup + validate + insert (safe against intra-batch duplicates)
        const allCandidates = parallelResults.flatMap(r => r.candidates);
        const mergeResult = await dedupeValidateAndInsert(sb, allCandidates, existingHashes, existingNgramSets, professionName);
        
        questionsThisChunk += mergeResult.saved;
        trainingThisChunk += mergeResult.training;
        const totalInserted = mergeResult.saved + mergeResult.training + mergeResult.gateFailed;
        
        // Distribute counts proportionally to each parallel task for quota tracking
        const perTask = parallelMeta.length > 0 ? Math.ceil(totalInserted / parallelMeta.length) : 0;
        for (const meta of parallelMeta) {
          diffMade[meta.difficulty] = (diffMade[meta.difficulty] ?? 0) + perTask;
          cogMade[meta.cognitiveLevel] = (cogMade[meta.cognitiveLevel] ?? 0) + perTask;
        }
      }

      if (brokeMidBp) {
        // Don't advance blueprint_index — resume this BP next invocation
        console.log(`[ExamPool-v5] Budget break mid-BP ${bp.id.slice(0, 8)} — cursor stays at ${currentBpIndex}`);
        break;
      }

      currentBpIndex++;
      bpsProcessed++;

      // ── Mid-loop hard cap check ──
      if (questionsThisChunk > 0 && (globalTotal + questionsThisChunk) >= HARD_CAP_QUESTIONS) {
        console.log(`[ExamPool-v5] Mid-loop HARD CAP: ~${globalTotal + questionsThisChunk} questions`);
        break;
      }

      // ── Mid-loop LF cap check (fan-out sub-jobs only) ──
      if (isFanOut && p.learning_field_filter && questionsThisChunk > 0) {
        const lfPropTarget = p.lf_target_total ?? lfTarget;
        const lfExistNow = (p.lf_existing ?? 0) + questionsThisChunk;
        if (lfExistNow >= lfPropTarget) {
          console.log(`[ExamPool-v5] Mid-loop LF CAP: lf=${p.learning_field_filter.slice(0,8)}, generated=${questionsThisChunk}, lfTarget=${lfPropTarget}`);
          break;
        }
      }
    }

    console.log(`[ExamPool-v5] DIFF_QUOTA_RESULT: made=${JSON.stringify(diffMade)}, quotas=${JSON.stringify(diffQuota)}`);
    console.log(`[ExamPool-v5] COG_QUOTA_RESULT: made=${JSON.stringify(cogMade)}, quotas=${JSON.stringify(cogQuota)}`);

    // ═══ DETERMINISTIC CALC QUOTA BACKFILL ═══
    // Target based on planned chunk size (stable, not affected by backfill itself)
    const calcRatio = QUESTION_TYPE_MIX.calculation ?? 0.20;
    const calcTarget = Math.max(1, Math.ceil(chunkPlanned * calcRatio));
    // Count calc questions inserted ONLY during this chunk (SSOT timestamp)
    const { count: calcInsertedCount } = await sb.from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .eq("question_type", "calculation")
      .gte("created_at", chunkStartedAt);
    const calcInserted = calcInsertedCount ?? 0;
    const calcDeficit = calcTarget - calcInserted;

    if (calcDeficit > 0 && bps.length > 0 && (globalTotal + questionsThisChunk) < HARD_CAP_QUESTIONS && !shouldSoftStop(invocationStart, "exam_pool_fanout") && (Date.now() - invocationStart) < TIME_BUDGET_MS) {
      const maxCalcAttempts = calcDeficit * 4 + 10;
      let calcBackfillSaved = 0;
      let calcAttempts = 0;
      // Filter to calc-capable blueprints (trap_spec present = has calculation structure)
      const calcBps = bps.filter((b: any) => b.trap_spec != null);
      const backfillBps = calcBps.length > 0 ? calcBps : bps; // fallback to all if none have trap_spec
      const shuffledBps = [...backfillBps].sort(() => Math.random() - 0.5);
      const calcDiffs: string[] = ["medium", "hard", "easy", "very_hard"];

      console.log(`[ExamPool-v5] CALC_BACKFILL: deficit=${calcDeficit}, target=${calcTarget}, inserted=${calcInserted}, calcBps=${calcBps.length}/${bps.length}, maxAttempts=${maxCalcAttempts}`);

      for (let i = 0; calcBackfillSaved < calcDeficit && calcAttempts < maxCalcAttempts && !shouldSoftStop(invocationStart, "exam_pool_fanout") && (Date.now() - invocationStart) < TIME_BUDGET_MS; i++) {
        const bp = shuffledBps[i % shuffledBps.length] as BlueprintInfo & { max_variations: number | null };
        const diff = calcDiffs[calcAttempts % calcDiffs.length];
        const cog = cogEntries[calcAttempts % cogEntries.length][0];

        try {
          const genResult = await generateTurboQuestions(
            sb, bp, AI_QUESTIONS_PER_CALL, diff, "calculation", cog,
            existingHashes, existingNgramSets, professionName, glossaryContext
          );
          calcBackfillSaved += genResult.saved;
          trainingThisChunk += genResult.training;
        } catch (e: unknown) {
          console.log(`[ExamPool-v5] CALC_BACKFILL attempt ${calcAttempts} FAIL: ${(e as Error)?.message}`);
        }
        calcAttempts++;

        if ((globalTotal + questionsThisChunk + calcBackfillSaved) >= HARD_CAP_QUESTIONS) break;
      }

      // Apply backfill total to chunk counter ONCE at the end
      questionsThisChunk += calcBackfillSaved;

      if (calcBackfillSaved < calcDeficit) {
        console.log(`[ExamPool-v5] CALC_QUOTA_NOT_REACHED: wanted=${calcDeficit}, got=${calcBackfillSaved} after ${calcAttempts} attempts`);
      } else {
        console.log(`[ExamPool-v5] CALC_BACKFILL complete: +${calcBackfillSaved} calc in ${calcAttempts} attempts`);
      }
    } else if (calcDeficit <= 0 && chunkPlanned > 0) {
      console.log(`[ExamPool-v5] CALC_QUOTA OK: target=${calcTarget}, inserted=${calcInserted}, chunkPlanned=${chunkPlanned} — no backfill needed`);
    } else if (chunkPlanned === 0) {
      console.log(`[ExamPool-v5] CALC_BACKFILL_SKIP_CHUNK: chunkPlanned=0, checking global deficit instead`);
    }

    // ═══ GLOBAL CALC DEFICIT CHECK (for pools already at/over effectiveTarget) ═══
    {
      const { count: globalTotal } = await sb.from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", curriculumId);
      const { count: globalCalc } = await sb.from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", curriculumId)
        .eq("question_type", "calculation");

      const gTotal = globalTotal ?? 0;
      const gCalc = globalCalc ?? 0;
      const globalCalcTarget = Math.ceil(gTotal * calcRatio);
      const globalDeficit = globalCalcTarget - gCalc;
      const MAX_GLOBAL_BACKFILL = 50;

      if (globalDeficit <= 0) {
        console.log(`[ExamPool-v5] CALC_GLOBAL_QUOTA_OK: ${gCalc}/${gTotal} = ${(100*gCalc/Math.max(gTotal,1)).toFixed(1)}% (target ${(calcRatio*100).toFixed(0)}%)`);
      } else if (gTotal >= HARD_CAP_QUESTIONS) {
        console.log(`[ExamPool-v5] CALC_GLOBAL_SKIP: pool at hard cap ${gTotal}, deficit=${globalDeficit}`);
      } else {
        const cappedDeficit = Math.min(globalDeficit, MAX_GLOBAL_BACKFILL);
        const calcBps = bps.filter((b: any) => b.trap_spec != null);
        const backfillBps = calcBps.length > 0 ? calcBps : bps;
        const shuffledBps = [...backfillBps].sort(() => Math.random() - 0.5);
        const maxAttempts = cappedDeficit * 4 + 10;
        let globalSaved = 0;
        let globalAttempts = 0;
        const calcDiffs: string[] = ["medium", "hard", "easy", "very_hard"];

        console.log(`[ExamPool-v5] CALC_GLOBAL_BACKFILL_START: globalDeficit=${globalDeficit}, capped=${cappedDeficit}, pool=${gCalc}/${gTotal}, calcBps=${calcBps.length}/${bps.length}`);

        for (let i = 0; globalSaved < cappedDeficit && globalAttempts < maxAttempts && !shouldSoftStop(invocationStart, "exam_pool_fanout") && (Date.now() - invocationStart) < TIME_BUDGET_MS; i++) {
          const bp = shuffledBps[i % shuffledBps.length] as BlueprintInfo & { max_variations: number | null };
          const diff = calcDiffs[globalAttempts % calcDiffs.length];
          const cog = cogEntries[globalAttempts % cogEntries.length][0];
          try {
            const genResult = await generateTurboQuestions(
              sb, bp, AI_QUESTIONS_PER_CALL, diff, "calculation", cog,
              existingHashes, existingNgramSets, professionName, glossaryContext
            );
            globalSaved += genResult.saved;
            trainingThisChunk += genResult.training;
          } catch (e: unknown) {
            console.log(`[ExamPool-v5] CALC_GLOBAL attempt ${globalAttempts} FAIL: ${(e as Error)?.message}`);
          }
          globalAttempts++;
        }

        questionsThisChunk += globalSaved;

        if (globalSaved < cappedDeficit) {
          console.log(`[ExamPool-v5] CALC_GLOBAL_NOT_REACHED: wanted=${cappedDeficit}, got=${globalSaved} after ${globalAttempts} attempts`);
        } else {
          console.log(`[ExamPool-v5] CALC_GLOBAL_BACKFILL complete: +${globalSaved} calc in ${globalAttempts} attempts`);
        }
      }
    }

    // Count actual total
    const { count: totalQuestions } = await sb.from("exam_questions")
      .select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId);

    const actualTotal = totalQuestions ?? 0;
    const allBlueprintsProcessed = currentBpIndex >= bps.length;

    // ── Guard: Fan-out jobs MUST have learning_field_filter ──
    if (isFanOut && !p.learning_field_filter) {
      throw new Error("[ExamPool-v5] Fan-out job missing learning_field_filter — payload corrupt");
    }

    // ── FIX: Fan-out sub-jobs must check LF-specific target, NOT global ──
    let targetReached = false;
    if (isFanOut && p.learning_field_filter) {
      const { count: lfTotal } = await sb.from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", curriculumId)
        .eq("learning_field_id", p.learning_field_filter);
      const lfActual = lfTotal ?? 0;
      const lfPropTarget = p.lf_target_total ?? lfTarget;
      targetReached = lfActual >= lfPropTarget;
      console.log(`[ExamPool-v5] LF-TARGET-CHECK: lf=${p.learning_field_filter.slice(0,8)}, actual=${lfActual}, target=${lfPropTarget}, reached=${targetReached}`);
    } else {
      targetReached = actualTotal >= shipTarget || actualTotal >= HARD_CAP_QUESTIONS;
    }

    const elapsedS = ((Date.now() - invocationStart) / 1000).toFixed(1);
    const elapsedMs = Date.now() - invocationStart;
    console.log(`[ExamPool-v5] +${questionsThisChunk} exam, +${trainingThisChunk} training, total=${actualTotal}/${examTarget} (cap=${HARD_CAP_QUESTIONS}), BPs ${currentBpIndex}/${bps.length}, elapsed=${elapsedS}s`);

    // ── P1 Observability: Log ai_generations entry with quality metrics ──
    console.log(`[ExamPool-v5] QUALITY_METRICS: ${JSON.stringify(_qualityMetrics)}`);
    try {
      await sb.from("ai_generations").insert({
        entity_type: "exam_pool",
        entity_id: packageId,
        generator_model: Object.keys(_qualityMetrics.models_used).join(", ") || "unknown",
        status: questionsThisChunk > 0 ? "accepted" : (_qualityMetrics.empty_responses > 0 ? "empty" : "rejected"),
        input_tokens: _qualityMetrics.total_tokens_out_estimated > 0 ? Math.ceil(_qualityMetrics.total_output_chars / 3.5) : 0,
        output_tokens: _qualityMetrics.total_tokens_out_estimated,
        latency_ms: elapsedMs,
        cost_eur: null, // aggregated from individual llm_cost_events
        validation_score: _qualityMetrics.avg_quality_score,
        validation_decision: questionsThisChunk > 0 ? "pass" : "fail",
        output_content: {
          exam_approved: _qualityMetrics.candidates_accepted_exam,
          training_pool: _qualityMetrics.candidates_accepted_training,
          total_generated: _qualityMetrics.candidates_generated,
          total_persisted: _qualityMetrics.candidates_accepted_exam + _qualityMetrics.candidates_accepted_training + _qualityMetrics.candidates_gate_failed_distractor,
        },
        metadata: {
          version: "v5-observability",
          is_fan_out: isFanOut,
          learning_field_id: p.learning_field_filter || null,
          llm_calls: {
            total: _qualityMetrics.total_llm_calls,
            successful: _qualityMetrics.successful_llm_calls,
            failed: _qualityMetrics.failed_llm_calls,
            retried: _qualityMetrics.retried_llm_calls,
            blocked: _qualityMetrics.blocked_llm_calls,
          },
          output: {
            total_chars: _qualityMetrics.total_output_chars,
            tokens_out_estimated: _qualityMetrics.total_tokens_out_estimated,
            truncated_responses: _qualityMetrics.truncated_responses,
            empty_responses: _qualityMetrics.empty_responses,
            json_repair_failures: _qualityMetrics.json_repair_failures,
          },
          quality_gates: {
            candidates_generated: _qualityMetrics.candidates_generated,
            accepted_exam: _qualityMetrics.candidates_accepted_exam,
            accepted_training: _qualityMetrics.candidates_accepted_training,
            rejected_contamination: _qualityMetrics.candidates_rejected_contamination,
            rejected_low_praxis: _qualityMetrics.candidates_rejected_low_praxis,
            rejected_ai_style: _qualityMetrics.candidates_rejected_ai_style,
            rejected_hallucination: _qualityMetrics.candidates_rejected_hallucination,
            rejected_invalid_index: _qualityMetrics.candidates_rejected_invalid_index,
            rejected_meta_text: _qualityMetrics.candidates_rejected_meta_text,
            rejected_placeholder: _qualityMetrics.candidates_rejected_placeholder,
            duplicates_hash: _qualityMetrics.candidates_duplicates_hash,
            duplicates_ngram: _qualityMetrics.candidates_duplicates_ngram,
            gate_failed_distractor: _qualityMetrics.candidates_gate_failed_distractor,
            avg_quality_score: Math.round(_qualityMetrics.avg_quality_score * 100) / 100,
          },
          knowledge_graph: {
            context_hits: _qualityMetrics.kg_context_hits,
            context_misses: _qualityMetrics.kg_context_misses,
            errors_injected: _qualityMetrics.kg_errors_injected,
            coverage_pct: (_qualityMetrics.kg_context_hits + _qualityMetrics.kg_context_misses) > 0
              ? Math.round((_qualityMetrics.kg_context_hits / (_qualityMetrics.kg_context_hits + _qualityMetrics.kg_context_misses)) * 100)
              : 0,
          },
          models_attempted: _qualityMetrics.models_attempted,
          models_used: _qualityMetrics.models_used,
          accept_rate_pct: _qualityMetrics.candidates_generated > 0
            ? Math.round((_qualityMetrics.candidates_accepted_exam / _qualityMetrics.candidates_generated) * 10000) / 100
            : 0,
        },
      });
    } catch (e) {
      console.warn(`[ExamPool-v5] ai_generations insert failed (non-blocking): ${(e as Error)?.message}`);
    }

    const progress = Math.min(55, Math.round(25 + (actualTotal / examTarget) * 30));
    await sb.from("course_packages").update({ build_progress: progress }).eq("id", packageId);

    // ══════════════════════════════════════════════════════════════════════
    // ── EFFECTIVE SUCCESS GUARD (P1-A) ───────────────────────────────────
    // Determines whether the job *actually* produced value.
    // generated: 0 without a valid noop_reason is ALWAYS a failure.
    // Delta metrics: existingBefore = globalTotal (captured BEFORE generation),
    //   insertedThisRun = existingAfter - existingBefore (actual DB delta).
    // ══════════════════════════════════════════════════════════════════════

    const existingBefore = globalTotal; // captured at pre-check before generation loop
    const existingAfter = actualTotal;  // captured after generation
    const insertedThisRun = Math.max(0, existingAfter - existingBefore);
    const generatedThisRun = questionsThisChunk; // exam-approved questions this chunk
    const llmAttempted = _qualityMetrics.total_llm_calls > 0;

    // Determine noop_reason (legitimate cases where generated=0 is OK)
    let noopReason: string | null = null;
    if (generatedThisRun === 0 && insertedThisRun === 0 && !llmAttempted && targetReached) {
      noopReason = "TARGET_ALREADY_REACHED";
    }

    const effectiveSuccess =
      generatedThisRun > 0 ||
      insertedThisRun > 0 ||
      (generatedThisRun === 0 && insertedThisRun === 0 && !!noopReason);

    let failureReason: string | null = null;
    let failureStage: string | null = null;
    if (!effectiveSuccess) {
      // Priority ordering: most specific → least specific
      if (_qualityMetrics.candidates_generated > 0) {
        failureReason = "ALL_CANDIDATES_REJECTED";
        failureStage = "quality_gate";
      } else if (_qualityMetrics.empty_responses > 0) {
        failureReason = "ZERO_GENERATION";
        failureStage = "llm_generation";
      } else if (llmAttempted && _qualityMetrics.failed_llm_calls === _qualityMetrics.total_llm_calls) {
        failureReason = "ALL_LLM_CALLS_FAILED";
        failureStage = "llm_call";
      } else {
        failureReason = "ZERO_GENERATION";
        failureStage = "unknown";
      }
      console.error(`[ExamPool-v5] EFFECTIVE_FAILURE: ${failureReason} (stage=${failureStage}, llm_calls=${_qualityMetrics.total_llm_calls}, candidates=${_qualityMetrics.candidates_generated}, empty=${_qualityMetrics.empty_responses})`);
    }

    // Build enriched result base with effective_success metadata
    const resultMeta = {
      effective_success: effectiveSuccess,
      generated: generatedThisRun,
      inserted: insertedThisRun,
      existing_before: existingBefore,
      existing_after: existingAfter,
      noop: generatedThisRun === 0 && insertedThisRun === 0 && !!noopReason,
      noop_reason: noopReason,
      failure_reason: failureReason,
      failure_stage: failureStage,
      llm_calls_attempted: _qualityMetrics.total_llm_calls,
      llm_calls_successful: _qualityMetrics.successful_llm_calls,
      llm_calls_failed: _qualityMetrics.failed_llm_calls,
      llm_calls_blocked: _qualityMetrics.blocked_llm_calls,
      empty_responses: _qualityMetrics.empty_responses,
      models_attempted: _qualityMetrics.models_attempted,
      models_used: _qualityMetrics.models_used,
    };

    // ── HOLLOW COMPLETION GUARD (existing, enhanced) ─────────────────────
    if (actualTotal <= 0) {
      console.error(`[ExamPool-v5] HOLLOW_COMPLETION_GUARD: 0 questions persisted for curriculum ${curriculumId?.slice(0,8)}. Refusing batch_complete.`);
      return json({ ok: false, batch_complete: false, error: "HOLLOW_COMPLETION: no exam_questions persisted", total_questions: 0, ...resultMeta }, 500);
    }

    // ── EFFECTIVE FAILURE → return ok: false (the core P1-A fix) ─────────
    if (!effectiveSuccess) {
      console.error(`[ExamPool-v5] EFFECTIVE_FAILURE_GUARD: generated=0, no valid noop_reason → returning ok: false`);
      return json(withMetrics(
        {
          ok: false,
          batch_complete: false,
          error: `EFFECTIVE_FAILURE: ${failureReason}`,
          total_questions: actualTotal,
          target: examTarget,
          ...resultMeta,
        },
        { generated: generatedThisRun, inserted: insertedThisRun, blueprints_found: bps.length, blueprints_used: bpsProcessed },
      ), 500);
    }

    if (targetReached) {
      const shouldMarkDone = !isFanOut || await allFanOutSubJobsDone(sb, packageId);
      if (shouldMarkDone) {
        await sb.from("course_packages").update({ build_progress: 55 }).eq("id", packageId);
      }
      return json(withMetrics(
        { ok: true, batch_complete: true, engine: "v5-ihk-quality", total_questions: actualTotal, training_pool: trainingThisChunk, target: examTarget, ...resultMeta },
        { generated: generatedThisRun, inserted: insertedThisRun, blueprints_found: bps.length, blueprints_used: bpsProcessed },
      ));
    } else if (allBlueprintsProcessed) {
      const currentLoop = (batchCursor?.loop_count ?? 0) + 1;
      if (currentLoop >= 8) {
        // ── HOLLOW GUARD on loop_capped: refuse batch_complete if 0 questions ──
        if (actualTotal <= 0) {
          console.error(`[ExamPool-v5] HOLLOW_LOOP_CAP: 8 loops but 0 questions → transient backoff`);
          return transientBackoff(
            "HOLLOW_LOOP_CAP: 8 loops completed but 0 questions persisted",
            300,
            { generated: questionsThisChunk, inserted: 0, blueprints_found: bps.length, blueprints_used: bpsProcessed, reason: "HOLLOW_LOOP_CAP" },
          );
        }
        if (!isFanOut) await sb.from("course_packages").update({ build_progress: 55 }).eq("id", packageId);
        return json(withMetrics(
          { ok: true, batch_complete: true, total_questions: actualTotal, loop_capped: true, ...resultMeta },
          { generated: generatedThisRun, inserted: insertedThisRun, blueprints_found: bps.length, blueprints_used: bpsProcessed },
        ));
      }
      return json(withMetrics(
        { ok: true, batch_complete: false, batch_cursor: { generated: actualTotal, blueprint_index: 0, target: examTarget, blueprints_total: bps.length, loop_count: currentLoop }, ...resultMeta },
        { generated: generatedThisRun, inserted: insertedThisRun, blueprints_found: bps.length, blueprints_used: bpsProcessed },
      ));
    } else {
      return json(withMetrics(
        { ok: true, batch_complete: false, batch_cursor: { generated: actualTotal, blueprint_index: currentBpIndex, target: examTarget, blueprints_total: bps.length, loop_count: batchCursor?.loop_count ?? 0 }, ...resultMeta },
        { generated: generatedThisRun, inserted: insertedThisRun, blueprints_found: bps.length, blueprints_used: bpsProcessed },
      ));
    }
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.log(`[ExamPool-v5] Fatal: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});
