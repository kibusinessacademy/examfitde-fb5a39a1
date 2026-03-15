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
 */

// ── Alias → Resolved Model Name ──────────────────────────────
// Mark each entry with its drift risk level.

export const MODEL_ALIASES = {
  /** Anthropic cheap+fast (Haiku 3.5). Pinned snapshot — stable. */
  anthropic_cheap_fast: "claude-3-5-haiku-20241022",

  /** Anthropic primary workhorse (Haiku 4.5). Pinned snapshot — stable. */
  anthropic_primary: "claude-haiku-4-5-20251001",

  /** OpenAI cheap+fast primary workhorse. Pinned. Best $/perf for volume. */
  openai_primary: "gpt-4o-mini",

  /** Anthropic strong (Sonnet). Pinned snapshot — stable. */
  anthropic_strong: "claude-sonnet-4-5-20250929",

  /** OpenAI workhorse — cheap, fast, good structured output. Pinned. */
  openai_workhorse: "gpt-4o-mini",

  /** OpenAI strong reasoning fallback. GPT-5.2 best quality. */
  openai_strong: "gpt-5.2",

  /** OpenAI balanced — GPT-5 mini is the new sweet spot (€0.23/€1.84 per M). */
  openai_balanced: "gpt-5-mini",

  /** OpenAI premium tier — GPT-5.4 for audit/compliance only (€2.30/€13.80 per M). */
  openai_premium: "gpt-5.4",

  /** OpenAI ultra-cheap — GPT-5 nano for simple volume tasks (€0.09/€0.37 per M). */
  openai_nano: "gpt-5-nano",

  /** OpenAI embeddings. Pinned. */
  openai_embeddings: "text-embedding-3-large",

  /** OpenAI image generation. Pinned. */
  openai_images: "gpt-image-1",
} as const;

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
