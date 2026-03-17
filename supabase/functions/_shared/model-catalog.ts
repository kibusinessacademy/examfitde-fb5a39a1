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
  openai_nano: "gpt-5.4-nano",
  /** GPT-4.1-nano — legacy nano, still very fast. */
  openai_nano_legacy: "gpt-4.1-nano",
  /** GPT-5 nano — previous gen nano. */
  openai_nano_v5: "gpt-5-nano",

  // ── Mini Tier: Content Generation, Handbook, Auto-Fix ──────
  /** Primary workhorse — GPT-5.4 mini: best accuracy/cost for agents. */
  openai_primary: "gpt-5.4-mini",
  /** GPT-4.1-mini — legacy primary, good fallback. */
  openai_primary_legacy: "gpt-4.1-mini",
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
  /** OpenAI image generation (standard). */
  openai_images: "gpt-image-1",
  /** OpenAI image generation (premium). */
  openai_images_premium: "gpt-image-1.5",
  /** OpenAI image generation (mini/cheap). */
  openai_images_mini: "gpt-image-1-mini",
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
 *
 * Step names are canonical — used in EXAMFIT_COURSE_PROFILE, telemetry,
 * and pipeline job_type. Do NOT rename without updating all references.
 *
 * Changes from v1 (based on production review):
 * - exam_pool: fallback1 → openai_strong (distractor quality > speed)
 * - validate_content: fallback1 → openai_strong (validation failures are expensive)
 * - Google preview models NOT used as primary (drift risk)
 */
export const PIPELINE_MODEL_MAP: Record<string, RouteProfile> = {
  scaffold_learning_course: {
    primary: "openai_nano", fallback1: "openai_nano_v5", fallback2: "openai_workhorse",
    rationale: "Simple structure, minimal tokens — nano-5.4 ideal",
  },
  generate_glossary: {
    primary: "openai_nano", fallback1: "openai_nano_v5", fallback2: "openai_workhorse",
    rationale: "Term extraction, low complexity — nano-5.4 ideal",
  },
  generate_learning_content: {
    primary: "openai_primary", fallback1: "openai_balanced", fallback2: "openai_primary_legacy",
    rationale: "GPT-5.4 mini: +9pp accuracy, fewer retries, net cheaper",
  },
  validate_content: {
    primary: "openai_primary", fallback1: "openai_balanced", fallback2: "openai_primary_legacy",
    rationale: "GPT-5.4 mini: tool-use +10pp, validation failures drop significantly",
  },
  generate_exam_pool: {
    primary: "openai_primary", fallback1: "openai_balanced", fallback2: "openai_strong",
    rationale: "GPT-5.4 mini: intelligence 88% vs 81.6%, better distractors first-pass",
  },
  generate_handbook: {
    primary: "openai_primary", fallback1: "openai_primary_legacy", fallback2: "openai_workhorse",
    rationale: "Structured text gen — GPT-5.4 mini long-context +12pp",
  },
  generate_minichecks: {
    primary: "openai_nano", fallback1: "openai_nano_v5", fallback2: "openai_workhorse",
    rationale: "Simple Q&A, high volume — nano-5.4 with tool-use 56%",
  },
  elite_harden: {
    primary: "openai_premium", fallback1: "openai_strong_v2", fallback2: "openai_strong",
    rationale: "Quality-critical, <2% of calls — GPT-5.4 orchestrator",
  },
  council_propose: {
    primary: "openai_primary", fallback1: "anthropic_primary", fallback2: "openai_balanced",
    rationale: "GPT-5.4 mini as primary worker, provider diversity in fallback",
  },
  council_critique: {
    primary: "openai_primary", fallback1: "anthropic_primary", fallback2: "openai_strong",
    rationale: "GPT-5.4 mini: cross-provider validation with better reasoning",
  },
  auto_fix: {
    primary: "openai_primary", fallback1: "openai_balanced", fallback2: "openai_primary_legacy",
    rationale: "GPT-5.4 mini: better tool-use for automated fixes",
  },
  ai_tutor_learning: {
    primary: "openai_primary", fallback1: "openai_workhorse", fallback2: "openai_nano",
    rationale: "GPT-5.4 mini: better didactic quality, acceptable latency",
  },
  ai_tutor_exam: {
    primary: "openai_primary", fallback1: "openai_balanced", fallback2: "openai_strong",
    rationale: "GPT-5.4 mini: intelligence 88%, strong exam context",
  },
};

// ── Course Cost Calculator (SSOT-coupled) ────────────────────

export type PipelineStepEstimate = {
  /** Must match a key in PIPELINE_MODEL_MAP for routing-coupled costing */
  step: string;
  calls: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  /**
   * Optional override. If omitted, model is resolved from
   * PIPELINE_MODEL_MAP[step].primary — keeping costing coupled to routing.
   */
  model_alias?: ModelAlias;
};

/**
 * Standard ExamFit course profile:
 * 1 Curriculum, ~14 LF, ~80 Kompetenzen
 *
 * Step names MUST match PIPELINE_MODEL_MAP keys exactly.
 */
export const EXAMFIT_COURSE_PROFILE: PipelineStepEstimate[] = [
  { step: "scaffold_learning_course", calls: 1,   avg_input_tokens: 2000,  avg_output_tokens: 1000  },
  { step: "generate_glossary",        calls: 14,  avg_input_tokens: 3000,  avg_output_tokens: 2000  },
  { step: "generate_learning_content",calls: 400, avg_input_tokens: 5000,  avg_output_tokens: 6000  },
  { step: "validate_content",         calls: 400, avg_input_tokens: 4000,  avg_output_tokens: 1000  },
  { step: "generate_exam_pool",       calls: 160, avg_input_tokens: 8000,  avg_output_tokens: 10000 },
  { step: "generate_handbook",        calls: 14,  avg_input_tokens: 4000,  avg_output_tokens: 8000  },
  { step: "generate_minichecks",      calls: 400, avg_input_tokens: 2000,  avg_output_tokens: 2000  },
  { step: "elite_harden",             calls: 100, avg_input_tokens: 6000,  avg_output_tokens: 2000  },
  { step: "council_propose",          calls: 50,  avg_input_tokens: 4000,  avg_output_tokens: 3000  },
  { step: "council_critique",         calls: 50,  avg_input_tokens: 5000,  avg_output_tokens: 2000  },
  { step: "auto_fix",                 calls: 20,  avg_input_tokens: 4000,  avg_output_tokens: 3000  },
];

/**
 * Calculate total course cost in EUR from pipeline step estimates.
 * Resolves model from PIPELINE_MODEL_MAP[step].primary unless overridden.
 * Uses SSOT pricing from model-pricing.ts — never hardcoded values.
 */
export function calcCourseCostEur(steps: PipelineStepEstimate[] = EXAMFIT_COURSE_PROFILE): number {
  return steps.reduce((sum, s) => {
    const model = resolveStepModel(s);
    return sum + s.calls * estimateCostEur(model, s.avg_input_tokens, s.avg_output_tokens);
  }, 0);
}

/**
 * Get per-step cost breakdown for UI display.
 */
export function getStepCostBreakdown(steps: PipelineStepEstimate[] = EXAMFIT_COURSE_PROFILE) {
  return steps.map(s => {
    const model = resolveStepModel(s);
    const alias = s.model_alias ?? PIPELINE_MODEL_MAP[s.step]?.primary ?? "openai_balanced";
    const costPerCall = estimateCostEur(model, s.avg_input_tokens, s.avg_output_tokens);
    return {
      step: s.step,
      calls: s.calls,
      model,
      model_alias: alias,
      cost_per_call: costPerCall,
      total_cost: s.calls * costPerCall,
    };
  });
}

/** Resolve the concrete model for a pipeline step estimate. */
function resolveStepModel(s: PipelineStepEstimate): string {
  // Explicit override takes priority
  if (s.model_alias) return MODEL_ALIASES[s.model_alias];
  // Otherwise couple to routing
  const route = PIPELINE_MODEL_MAP[s.step];
  if (route) return MODEL_ALIASES[route.primary];
  // Fallback for unknown steps
  return MODEL_ALIASES["openai_balanced"];
}

// ── Drift-prone models (for governance/telemetry alerts) ─────

/**
 * Explicit set of known drift-prone model IDs.
 * Preview/latest models are also caught dynamically by isDriftProneModel().
 */
export const EXPLICIT_DRIFT_PRONE_MODELS = new Set<string>([
  "claude-3-5-haiku-20241022",
]);

/**
 * Check if a model string is drift-prone.
 * Catches: explicit list, "-latest" suffix, "-preview" suffix.
 * Use in telemetry to flag calls that may silently change behavior.
 */
export function isDriftProneModel(model: string): boolean {
  return EXPLICIT_DRIFT_PRONE_MODELS.has(model) ||
    model.endsWith("-latest") ||
    model.includes("-preview");
}

/**
 * Resolve a model alias to its current concrete model name.
 */
export function resolveAlias(aliasKey: ModelAlias): string {
  return MODEL_ALIASES[aliasKey];
}

// ── Provider-Model Compatibility Guard ───────────────────────

/**
 * Determine the correct batch provider for a given model.
 * Used by batch-submit to prevent provider-model mismatches.
 */
export function providerForModel(model: string): "openai" | "anthropic" {
  if (model.startsWith("claude") || model.includes("anthropic")) return "anthropic";
  return "openai";
}

/**
 * Validate that a model is compatible with the specified provider.
 * Returns null if valid, or an error string if mismatched.
 */
export function validateProviderModelCompat(
  provider: "openai" | "anthropic",
  model: string,
): string | null {
  const expected = providerForModel(model);
  if (provider !== expected) {
    return `Provider-Model mismatch: model "${model}" requires provider "${expected}" but got "${provider}"`;
  }
  return null;
}
