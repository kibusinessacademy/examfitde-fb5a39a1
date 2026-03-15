/**
 * model-catalog.ts — Central Model Alias & Routing Registry
 *
 * All model identifiers used in routing, edge functions, and telemetry
 * MUST be resolved through this file.
 *
 * When Anthropic/OpenAI/Google retire or update a snapshot:
 *   1. Update the alias value here
 *   2. Update RAW_USD in model-pricing.ts if needed
 *   3. All routing tables, fallback chains, and telemetry follow automatically
 */

import { PRICING_EUR_PER_M, estimateCostEur } from "./model-pricing.ts";

// ── Alias → Resolved Model Name ──────────────────────────────

export const MODEL_ALIASES = {
  // ── Nano Tier: Routing, QC, Minichecks, Glossary ───────────
  /** Ultra-fast, ultra-cheap. Best for classification & simple gen. */
  openai_nano: "gpt-4.1-nano",
  /** GPT-5 nano — same price tier, newer architecture. */
  openai_nano_v5: "gpt-5-nano",

  // ── Mini Tier: Content Generation, Handbook, Auto-Fix ──────
  /** Primary workhorse for volume generation. */
  openai_primary: "gpt-4.1-mini",
  /** GPT-4o-mini — legacy cheapest mini. Good for interactive chat. */
  openai_workhorse: "gpt-4o-mini",

  // ── Balanced Tier: Exam-Pool, Council, Validation ──────────
  /** Best price/quality for reasoning tasks. */
  openai_balanced: "gpt-5-mini",

  // ── Strong Tier: QA Gates, Exam Validation ─────────────────
  /** High precision for validation. */
  openai_strong: "gpt-5",
  /** Top reasoning. Fallback for sensitive intents. */
  openai_strong_v2: "gpt-5.2",

  // ── Premium Tier: Elite Harden, Audit, Compliance ──────────
  /** Maximum quality. Only for <5% of calls. */
  openai_premium: "gpt-5.4",

  // ── Reasoning Tier ─────────────────────────────────────────
  /** Multi-step chain-of-thought. Very expensive — use sparingly. */
  openai_reasoning: "o4-mini",

  // ── Anthropic ──────────────────────────────────────────────
  /** Anthropic cheap+fast (Haiku 3.5). Pinned snapshot. */
  anthropic_cheap_fast: "claude-3-5-haiku-20241022",
  /** Anthropic workhorse (Haiku 4.5). Provider-diversity fallback. */
  anthropic_primary: "claude-haiku-4-5-20251001",
  /** Anthropic strong (Sonnet). Pinned snapshot. */
  anthropic_strong: "claude-sonnet-4-5-20250929",

  // ── Embeddings & Images ────────────────────────────────────
  /** OpenAI embeddings. Pinned. */
  openai_embeddings: "text-embedding-3-large",
  /** OpenAI image generation. Pinned. */
  openai_images: "gpt-image-1",
} as const;

// ── Type helpers ─────────────────────────────────────────────

export type ModelAlias = keyof typeof MODEL_ALIASES;
export type ConcreteModel = (typeof MODEL_ALIASES)[ModelAlias];

// ── Pipeline Routing ─────────────────────────────────────────

export type RouteProfile = {
  primary: ModelAlias;
  fallback1: ModelAlias;
  fallback2?: ModelAlias;
  rationale: string;
};

/**
 * Pipeline Step → Model Routing.
 * Use in model_routing_rules DB table for SSOT configuration.
 *
 * Changes from v1 (based on production review):
 * - exam_pool: fallback1 → openai_strong (distractor quality > speed)
 * - validate_content: fallback1 → openai_strong (validation failures are expensive)
 * - Google preview models NOT used as primary (drift risk)
 */
export const PIPELINE_MODEL_MAP: Record<string, RouteProfile> = {
  scaffold_learning_course: {
    primary: "openai_nano", fallback1: "openai_nano_v5", fallback2: "openai_workhorse",
    rationale: "Simple structure, minimal tokens",
  },
  generate_glossary: {
    primary: "openai_nano", fallback1: "openai_nano_v5", fallback2: "openai_workhorse",
    rationale: "Term extraction, low complexity",
  },
  generate_learning_content: {
    primary: "openai_primary", fallback1: "openai_balanced", fallback2: "openai_workhorse",
    rationale: "Volume content gen, balanced quality",
  },
  validate_content: {
    primary: "openai_balanced", fallback1: "openai_strong", fallback2: "openai_primary",
    rationale: "Validation failures cost more than slightly slower calls",
  },
  generate_exam_pool: {
    primary: "openai_balanced", fallback1: "openai_strong", fallback2: "openai_primary",
    rationale: "Distractor quality + exam realism > pure speed",
  },
  generate_handbook: {
    primary: "openai_primary", fallback1: "openai_workhorse", fallback2: "openai_nano_v5",
    rationale: "Structured text generation",
  },
  generate_minichecks: {
    primary: "openai_nano", fallback1: "openai_nano_v5", fallback2: "openai_workhorse",
    rationale: "Simple Q&A, high volume",
  },
  elite_harden: {
    primary: "openai_premium", fallback1: "openai_strong_v2", fallback2: "openai_strong",
    rationale: "Quality-critical, <2% of calls",
  },
  council_propose: {
    primary: "openai_balanced", fallback1: "anthropic_primary", fallback2: "openai_primary",
    rationale: "Provider diversity in fallback chain",
  },
  council_critique: {
    primary: "openai_balanced", fallback1: "anthropic_primary", fallback2: "openai_strong",
    rationale: "Cross-provider validation",
  },
  auto_fix: {
    primary: "openai_primary", fallback1: "openai_balanced", fallback2: "openai_workhorse",
    rationale: "Moderate reasoning, cost-efficient",
  },
  ai_tutor_learning: {
    primary: "openai_workhorse", fallback1: "openai_nano", fallback2: "openai_nano_v5",
    rationale: "Fast interactive chat, low cost",
  },
  ai_tutor_exam: {
    primary: "openai_balanced", fallback1: "openai_strong", fallback2: "openai_primary",
    rationale: "Accuracy for exam context",
  },
};

// ── Course Cost Calculator (SSOT-coupled) ────────────────────

export type PipelineStepEstimate = {
  step: string;
  calls: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  model_alias: ModelAlias;
};

/**
 * Standard ExamFit course profile:
 * 1 Curriculum, ~14 LF, ~80 Kompetenzen
 */
export const EXAMFIT_COURSE_PROFILE: PipelineStepEstimate[] = [
  { step: "scaffold",          calls: 1,   avg_input_tokens: 2000,  avg_output_tokens: 1000,  model_alias: "openai_nano" },
  { step: "glossary",          calls: 14,  avg_input_tokens: 3000,  avg_output_tokens: 2000,  model_alias: "openai_nano" },
  { step: "learning_content",  calls: 400, avg_input_tokens: 5000,  avg_output_tokens: 6000,  model_alias: "openai_primary" },
  { step: "validate_content",  calls: 400, avg_input_tokens: 4000,  avg_output_tokens: 1000,  model_alias: "openai_balanced" },
  { step: "exam_pool",         calls: 160, avg_input_tokens: 8000,  avg_output_tokens: 10000, model_alias: "openai_balanced" },
  { step: "handbook",          calls: 14,  avg_input_tokens: 4000,  avg_output_tokens: 8000,  model_alias: "openai_primary" },
  { step: "minichecks",        calls: 400, avg_input_tokens: 2000,  avg_output_tokens: 2000,  model_alias: "openai_nano" },
  { step: "elite_harden",      calls: 100, avg_input_tokens: 6000,  avg_output_tokens: 2000,  model_alias: "openai_premium" },
  { step: "council_propose",   calls: 50,  avg_input_tokens: 4000,  avg_output_tokens: 3000,  model_alias: "openai_balanced" },
  { step: "council_critique",  calls: 50,  avg_input_tokens: 5000,  avg_output_tokens: 2000,  model_alias: "openai_balanced" },
  { step: "auto_fix",          calls: 20,  avg_input_tokens: 4000,  avg_output_tokens: 3000,  model_alias: "openai_primary" },
];

/**
 * Calculate total course cost in EUR from pipeline step estimates.
 * Uses SSOT pricing from model-pricing.ts — never hardcoded values.
 */
export function calcCourseCostEur(steps: PipelineStepEstimate[] = EXAMFIT_COURSE_PROFILE): number {
  return steps.reduce((sum, s) => {
    const model = resolveAlias(s.model_alias);
    return sum + s.calls * estimateCostEur(model, s.avg_input_tokens, s.avg_output_tokens);
  }, 0);
}

/**
 * Get per-step cost breakdown for UI display.
 */
export function getStepCostBreakdown(steps: PipelineStepEstimate[] = EXAMFIT_COURSE_PROFILE) {
  return steps.map(s => {
    const model = resolveAlias(s.model_alias);
    const costPerCall = estimateCostEur(model, s.avg_input_tokens, s.avg_output_tokens);
    return {
      step: s.step,
      calls: s.calls,
      model,
      model_alias: s.model_alias,
      cost_per_call: costPerCall,
      total_cost: s.calls * costPerCall,
    };
  });
}

// ── Drift-prone aliases (for governance/telemetry alerts) ────

export const DRIFT_PRONE_ALIASES = new Set<string>([
  "claude-3-5-haiku-20241022",
  // All Google preview models are drift-prone by definition
]);

/**
 * Check if a model string is a drift-prone alias.
 * Use in telemetry to flag calls that may silently change behavior.
 */
export function isDriftProneModel(model: string): boolean {
  return DRIFT_PRONE_ALIASES.has(model) ||
    model.endsWith("-latest") ||
    model.includes("-preview");
}

/**
 * Resolve a model alias to its current concrete model name.
 */
export function resolveAlias(aliasKey: ModelAlias): string {
  return MODEL_ALIASES[aliasKey];
}
