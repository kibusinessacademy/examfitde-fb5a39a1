/**
 * model-aliases.ts — Central Model Alias Registry
 *
 * All "latest" or "drift-prone" model identifiers are resolved HERE.
 * Never use raw alias strings (e.g. "claude-3-5-haiku-latest") in routing
 * or edge function code — always reference through this registry.
 *
 * When Anthropic/OpenAI/Google retire or update a snapshot:
 *   1. Update the alias value here
 *   2. Update pricing in token-estimator.ts if needed
 *   3. All routing tables, fallback chains, and telemetry follow automatically
 *
 * ── ExamFit Pipeline Routing Strategy (Mar 2026) ─────────────
 *
 * Tier     | Role               | Model              | €/1M In | €/1M Out | Latency
 * ---------|--------------------|--------------------|---------|----------|--------
 * nano     | Routing/QC/Simple  | gpt-4.1-nano       | €0.09   | €0.37    | 0.3-0.6s
 * mini     | Generation/Content | gpt-4.1-mini       | €0.37   | €1.47    | 0.5-1.2s
 * balanced | Exam/Council       | gpt-5-mini         | €0.23   | €1.84    | 0.8-1.5s
 * strong   | Validation         | gpt-5              | €2.30   | €9.20    | 1.5-2.5s
 * premium  | Elite QA/Audit     | gpt-5.4            | €2.30   | €13.80   | 2-4s
 * reason   | Chain-of-thought   | o4-mini            | €3.68   | €14.72   | 1.5-3s
 *
 * Pattern: nano → routing | mini → generation | balanced → exam | premium → validation
 * Ergebnis: ~€13.75/Kurs (vs. €45-65 mit Einheitsmodell) = 70-80% Ersparnis
 */

// ── Alias → Resolved Model Name ──────────────────────────────
// Mark each entry with its drift risk level.

export const MODEL_ALIASES = {
  // ── OpenAI Nano Tier (Routing, QC, Minichecks, Glossary) ───
  /** Ultra-fast, ultra-cheap. 150-250 t/s, 10k+ RPM. Best for classification & simple gen. */
  openai_nano: "gpt-4.1-nano",

  /** GPT-5 nano variant — same tier, slightly newer architecture. */
  openai_nano_v5: "gpt-5-nano",

  // ── OpenAI Mini Tier (Content Generation, Handbook, Auto-Fix) ───
  /** Primary workhorse for volume generation. 120-200 t/s, 3-10k RPM. */
  openai_primary: "gpt-4.1-mini",

  /** GPT-4o-mini — legacy but cheapest mini. Good for AI Tutor chat. */
  openai_workhorse: "gpt-4o-mini",

  // ── OpenAI Balanced Tier (Exam-Pool, Council, Blueprint Analysis) ───
  /** Best price/quality for reasoning tasks. 100-150 t/s. */
  openai_balanced: "gpt-5-mini",

  // ── OpenAI Strong Tier (Validation, QA Gates) ───
  /** High precision for exam validation. 70-110 t/s, 1-5k RPM. */
  openai_strong: "gpt-5",

  /** Top reasoning. Fallback for sensitive intents. 50-90 t/s. */
  openai_strong_v2: "gpt-5.2",

  // ── OpenAI Premium Tier (Elite Harden, Audit, Compliance) ───
  /** Maximum quality. Only for <5% of calls. 40-80 t/s, 500-2k RPM. */
  openai_premium: "gpt-5.4",

  // ── OpenAI Reasoning Tier (Chain-of-thought tasks) ───
  /** Multi-step reasoning. Very expensive — use sparingly. 60-100 t/s. */
  openai_reasoning: "o4-mini",

  // ── Anthropic ──────────────────────────────────────────────
  /** Anthropic cheap+fast (Haiku 3.5). Pinned snapshot — stable. */
  anthropic_cheap_fast: "claude-3-5-haiku-20241022",

  /** Anthropic primary workhorse (Haiku 4.5). Provider-diversity fallback. */
  anthropic_primary: "claude-haiku-4-5-20251001",

  /** Anthropic strong (Sonnet). Pinned snapshot — stable. */
  anthropic_strong: "claude-sonnet-4-5-20250929",

  // ── Embeddings & Images ────────────────────────────────────
  /** OpenAI embeddings. Pinned. */
  openai_embeddings: "text-embedding-3-large",

  /** OpenAI image generation. Pinned. */
  openai_images: "gpt-image-1",
} as const;

// ── Pipeline Step → Recommended Alias Mapping ────────────────
// Use in model_routing_rules DB table for SSOT configuration.
export const PIPELINE_MODEL_MAP: Record<string, {
  primary: keyof typeof MODEL_ALIASES;
  fallback1: keyof typeof MODEL_ALIASES;
  fallback2?: keyof typeof MODEL_ALIASES;
  rationale: string;
}> = {
  scaffold_learning_course:     { primary: "openai_nano",      fallback1: "openai_nano_v5",   fallback2: "openai_workhorse", rationale: "Simple structure, minimal tokens" },
  generate_glossary:            { primary: "openai_nano",      fallback1: "openai_nano_v5",   fallback2: "openai_workhorse", rationale: "Term extraction, low complexity" },
  generate_learning_content:    { primary: "openai_primary",   fallback1: "openai_balanced",  fallback2: "openai_workhorse", rationale: "Volume content gen, balanced quality" },
  validate_content:             { primary: "openai_balanced",  fallback1: "openai_primary",   fallback2: "openai_strong",    rationale: "Needs reasoning for quality checks" },
  generate_exam_pool:           { primary: "openai_balanced",  fallback1: "openai_primary",   fallback2: "openai_strong",    rationale: "Distractor quality needs reasoning" },
  generate_handbook:            { primary: "openai_primary",   fallback1: "openai_workhorse", fallback2: "openai_nano_v5",   rationale: "Structured text generation" },
  generate_minichecks:          { primary: "openai_nano",      fallback1: "openai_nano_v5",   fallback2: "openai_workhorse", rationale: "Simple Q&A, high volume" },
  elite_harden:                 { primary: "openai_premium",   fallback1: "openai_strong_v2", fallback2: "openai_strong",    rationale: "Quality-critical, <2% of calls" },
  council_propose:              { primary: "openai_balanced",  fallback1: "anthropic_primary", fallback2: "openai_primary",  rationale: "Provider diversity in fallback" },
  council_critique:             { primary: "openai_balanced",  fallback1: "anthropic_primary", fallback2: "openai_strong",   rationale: "Cross-provider validation" },
  auto_fix:                     { primary: "openai_primary",   fallback1: "openai_balanced",  fallback2: "openai_workhorse", rationale: "Moderate reasoning, cost-efficient" },
  ai_tutor_learning:            { primary: "openai_workhorse", fallback1: "openai_nano",      fallback2: "openai_nano_v5",   rationale: "Fast interactive chat" },
  ai_tutor_exam:                { primary: "openai_balanced",  fallback1: "openai_strong",    fallback2: "openai_primary",   rationale: "Accuracy for exam context" },
};

// ── Drift-prone aliases (for governance/telemetry alerts) ────
export const DRIFT_PRONE_ALIASES = new Set<string>([
  "claude-3-5-haiku-20241022",
  // Add any future "latest" or "preview" aliases here
]);

/**
 * Check if a model string is a drift-prone alias.
 * Use in telemetry to flag calls that may silently change behavior.
 */
export function isDriftProneModel(model: string): boolean {
  return DRIFT_PRONE_ALIASES.has(model) || model.endsWith("-latest") || model.includes("-preview");
}

/**
 * Resolve a model alias to its current concrete model name.
 * If the input is already a concrete model, returns it unchanged.
 */
export function resolveAlias(aliasKey: keyof typeof MODEL_ALIASES): string {
  return MODEL_ALIASES[aliasKey];
}
