/**
 * Model Routing – DB-first mit Hardcoded Fallback
 *
 * Liest Routing-Regeln aus `model_routing_rules` (TTL-Cache 60s).
 * Wenn DB leer oder nicht erreichbar → Fallback auf Hardcoded-Tabelle.
 *
 * GOVERNANCE: All model names resolved via MODEL_ALIASES to prevent drift.
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { MODEL_ALIASES } from "./model-aliases.ts";

export type AIProvider = "openai" | "anthropic" | "google";

export type PipelineIntent =
  | "learning_course"
  | "learning_content"
  | "exam_questions"
  | "oral_exam"
  | "handbook"
  | "minicheck"
  | "seo_content"
  | "council_review"
  | "council_proposer"
  | "council_validator"
  | "quality_audit"
  | "embeddings"
  | "images"
  | "support"
  | "summary"
  | "repair"
  | "repair_content"
  | "blooms_classify"
  | "curriculum_import";

export interface ModelChoice {
  provider: AIProvider;
  model: string;
  is_fallback?: boolean;
  max_output_tokens?: number;
  temperature?: number;
  budget_cap_eur?: number;
}

// ── Resolved model shortcuts (v18 — gpt-5.4-mini primary) ────
const GPT54_MINI_PRIMARY: ModelChoice = { provider: "openai", model: MODEL_ALIASES.openai_primary }; // v18: gpt-5.4-mini
const HAIKU45_FALLBACK: ModelChoice = { provider: "anthropic", model: MODEL_ALIASES.anthropic_primary, is_fallback: true };
const GPT5_MINI_FALLBACK: ModelChoice = { provider: "openai", model: MODEL_ALIASES.openai_balanced, is_fallback: true };
const GPT5_2_FALLBACK: ModelChoice = { provider: "openai",   model: MODEL_ALIASES.openai_strong, is_fallback: true };

// ── Tiered Fallback Strategy (v18) ───────────────────────────
// ALL intents: gpt-5.4-mini → Haiku 4.5 (cross-provider) → GPT-5-mini → GPT-5.2
// STANDARD intents: gpt-5.4-mini → Haiku 4.5
// SIMPLE intents: gpt-5.4-mini → Haiku 4.5

const ROUTING_TABLE: Record<PipelineIntent, ModelChoice[]> = {
  // ── ALL intents: gpt-5.4-mini → Haiku 4.5 (cross-provider) → GPT-5-mini → GPT-5.2 ──
  // CRITICAL: Every intent MUST have Anthropic fallback to prevent OpenAI death spirals
  learning_course:    [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK, GPT5_2_FALLBACK],
  learning_content:   [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK, GPT5_2_FALLBACK],
  exam_questions:     [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK, GPT5_2_FALLBACK],
  handbook:           [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK, GPT5_2_FALLBACK],
  council_review:     [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK, GPT5_2_FALLBACK],
  quality_audit:      [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK, GPT5_2_FALLBACK],
  repair_content:     [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK, GPT5_2_FALLBACK],
  council_validator:  [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK, GPT5_2_FALLBACK],
  oral_exam:          [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK, GPT5_2_FALLBACK],
  minicheck:          [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK, GPT5_2_FALLBACK],
  seo_content:        [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK, GPT5_2_FALLBACK],
  council_proposer:   [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK, GPT5_2_FALLBACK],
  curriculum_import:  [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK, GPT5_2_FALLBACK],
  support:            [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK],
  summary:            [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK],
  repair:             [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK],
  blooms_classify:    [GPT54_MINI_PRIMARY, HAIKU45_FALLBACK, GPT5_MINI_FALLBACK],

  // ── SPECIAL: Fixed models (provider-locked) ──
  embeddings: [{ provider: "openai", model: MODEL_ALIASES.openai_embeddings }],
  images:     [{ provider: "openai", model: MODEL_ALIASES.openai_images }],
};

// ── Budget Caps ──────────────────────────────────────────────
export const INTENT_BUDGETS: Record<PipelineIntent, number> = {
  learning_course: 2.5,
  learning_content: 5.0,
  exam_questions: 0.8,
  oral_exam: 0.5,
  handbook: 2.0,
  minicheck: 0.3,
  seo_content: 1.0,
  council_review: 0.8,
  council_proposer: 1.0,
  council_validator: 0.8,
  quality_audit: 1.5,
  embeddings: 0.1,
  images: 0.5,
  support: 0.15,
  summary: 0.2,
  repair: 0.2,
  repair_content: 1.0,
  blooms_classify: 0.15,
  curriculum_import: 1.0,
};

// ── DB-Driven Routing with TTL Cache ─────────────────────────

interface DbRule {
  intent: string;
  provider: string;
  model: string;
  priority: number;
  is_fallback: boolean;
  enabled: boolean;
  budget_cap_eur: number | null;
  max_output_tokens: number | null;
  temperature: number | null;
  ab_weight: number;
}

let _cache: { ts: number; byIntent: Record<string, Array<ModelChoice & { ab_weight: number; _priority: number }>> } | null = null;
const CACHE_TTL_MS = 60_000;

function hasServiceRole(): boolean {
  return !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") && !!Deno.env.get("SUPABASE_URL");
}

async function loadRulesFromDb(): Promise<Record<string, Array<ModelChoice & { ab_weight: number; _priority: number }>>> {
  if (!hasServiceRole()) return {};

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("model_routing_rules")
      .select("intent,provider,model,priority,is_fallback,enabled,budget_cap_eur,max_output_tokens,temperature,ab_weight")
      .eq("enabled", true)
      .order("intent", { ascending: true })
      .order("priority", { ascending: true });

    if (error || !data) {
      console.warn("[MODEL-ROUTING] DB load failed, using hardcoded:", error?.message);
      return {};
    }

    const byIntent: Record<string, Array<ModelChoice & { ab_weight: number; _priority: number }>> = {};
    for (const r of data as DbRule[]) {
      const step = {
        provider: r.provider as AIProvider,
        model: r.model,
        is_fallback: !!r.is_fallback,
        ab_weight: r.ab_weight ?? 100,
        _priority: r.priority ?? 1,
        ...(r.max_output_tokens ? { max_output_tokens: r.max_output_tokens } : {}),
        ...(typeof r.temperature === "number" ? { temperature: r.temperature } : {}),
        ...(typeof r.budget_cap_eur === "number" ? { budget_cap_eur: r.budget_cap_eur } : {}),
      };
      byIntent[r.intent] ??= [];
      byIntent[r.intent].push(step);
    }
    return byIntent;
  } catch (e) {
    console.warn("[MODEL-ROUTING] DB load exception, using hardcoded:", e);
    return {};
  }
}

/**
 * Resolve A/B weighted selection from cached raw rules.
 * Random selection happens per call, not per cache refresh.
 */
function resolveAbChain(rules: Array<ModelChoice & { ab_weight: number; _priority: number }>): ModelChoice[] {
  const byPriority = new Map<number, Array<ModelChoice & { ab_weight: number }>>();
  for (const r of rules) {
    if (!byPriority.has(r._priority)) byPriority.set(r._priority, []);
    byPriority.get(r._priority)!.push(r);
  }

  const chain: ModelChoice[] = [];
  for (const [, candidates] of [...byPriority.entries()].sort((a, b) => a[0] - b[0])) {
    if (candidates.length === 1) {
      chain.push(candidates[0]);
    } else {
      // Weighted random selection among same-priority candidates
      const totalWeight = candidates.reduce((s, c) => s + c.ab_weight, 0);
      const roll = Math.random() * totalWeight;
      let cumulative = 0;
      let picked = candidates[0];
      for (const c of candidates) {
        cumulative += c.ab_weight;
        if (roll < cumulative) { picked = c; break; }
      }
      chain.push(picked);
      for (const c of candidates) {
        if (c !== picked) chain.push({ ...c, is_fallback: true });
      }
      console.log(`[MODEL-ROUTING] A/B: picked ${picked.provider}/${picked.model} (weight=${picked.ab_weight}/${totalWeight})`);
    }
  }
  return chain;
}

async function getDbRouting(intent: string): Promise<ModelChoice[] | null> {
  const now = Date.now();
  if (!_cache || now - _cache.ts >= CACHE_TTL_MS) {
    const byIntent = await loadRulesFromDb();
    _cache = { ts: now, byIntent };
  }
  const raw = _cache.byIntent[intent];
  if (!raw || raw.length === 0) return null;
  return resolveAbChain(raw);
}

/** Invalidate the cache (e.g. after admin changes routing rules) */
export function invalidateRoutingCache(): void {
  _cache = null;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Get the primary model for a given intent.
 * DB-first, hardcoded fallback.
 */
export async function getModelAsync(intent: PipelineIntent): Promise<ModelChoice> {
  const dbPlan = await getDbRouting(intent);
  if (dbPlan && dbPlan.length > 0) return dbPlan[0];
  return ROUTING_TABLE[intent][0];
}

/**
 * Get primary + all fallback models for a given intent.
 * DB-first, hardcoded fallback.
 */
export async function getModelChainAsync(intent: PipelineIntent): Promise<ModelChoice[]> {
  const dbPlan = await getDbRouting(intent);
  if (dbPlan && dbPlan.length > 0) return dbPlan;
  return ROUTING_TABLE[intent];
}

/**
 * Synchronous access (uses hardcoded only). For backwards compatibility.
 */
export function getModel(intent: PipelineIntent): ModelChoice {
  return ROUTING_TABLE[intent][0];
}

export function getModelChain(intent: PipelineIntent): ModelChoice[] {
  return ROUTING_TABLE[intent];
}

export function getBudget(intent: PipelineIntent): number {
  return INTENT_BUDGETS[intent];
}

// ── Deploy Revision Tracking ─────────────────────────────────

/** Returns the deploy revision (git SHA) from env, or empty string. */
export function getDeployRev(): string {
  return Deno.env.get("DEPLOY_REV") || Deno.env.get("GITHUB_SHA") || "";
}

/**
 * Build metadata object for llm_cost_events.meta with chain traceability.
 * Call this when logging AI calls to ensure deploy-smoke-check can verify.
 */
export function buildChainMeta(
  chain: ModelChoice[],
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(extra ?? {}),
    chain_size: chain.length,
    chain_models: chain.map((c) => c.model),
    deploy_rev: getDeployRev(),
  };
}

// ── Adaptive Quality Escalation ──────────────────────────────

export type ContentDifficulty = "easy" | "medium" | "hard" | "very_hard";
export type QuestionType = "single_choice" | "multiple_choice" | "calculation" | "case_study" | "oral" | "other";

const DIFFICULTY_THRESHOLDS: Record<ContentDifficulty, number> = {
  easy: 60, medium: 70, hard: 75, very_hard: 80,
};

const TYPE_MODIFIERS: Record<QuestionType, number> = {
  single_choice: 0, multiple_choice: 2, calculation: 3, case_study: 5, oral: 5, other: 0,
};

export function getAdaptiveThreshold(
  difficulty: ContentDifficulty = "medium",
  questionType: QuestionType = "single_choice"
): number {
  return DIFFICULTY_THRESHOLDS[difficulty] + TYPE_MODIFIERS[questionType];
}

export function getEscalationModel(
  intent: PipelineIntent,
  validationScore: number,
  opts?: { difficulty?: ContentDifficulty; questionType?: QuestionType; threshold?: number }
): ModelChoice | null {
  const threshold = opts?.threshold ??
    getAdaptiveThreshold(opts?.difficulty ?? "medium", opts?.questionType ?? "single_choice");

  if (validationScore >= threshold) return null;

  const escalationMap: Partial<Record<PipelineIntent, ModelChoice>> = {
    exam_questions: { provider: "openai", model: MODEL_ALIASES.openai_strong },
    oral_exam:      { provider: "openai", model: MODEL_ALIASES.openai_workhorse },
    minicheck:      { provider: "openai", model: MODEL_ALIASES.openai_balanced },
    support:        { provider: "openai", model: MODEL_ALIASES.openai_balanced },
    summary:        { provider: "openai", model: MODEL_ALIASES.openai_balanced },
    repair:         { provider: "openai", model: MODEL_ALIASES.openai_balanced },
    blooms_classify:{ provider: "openai", model: MODEL_ALIASES.openai_balanced },
  };

  return escalationMap[intent] || null;
}
