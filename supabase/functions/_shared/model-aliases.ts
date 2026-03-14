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
  /** Anthropic cheap+fast fallback. DRIFT-PRONE: "latest" alias may change behavior. */
  anthropic_cheap_fast: "claude-3-5-haiku-latest",

  /** Anthropic primary (Sonnet). Pinned snapshot — stable. */
  anthropic_primary: "claude-sonnet-4-5-20250929",

  /** OpenAI workhorse — cheap, fast, good structured output. Pinned. */
  openai_workhorse: "gpt-4o-mini",

  /** OpenAI strong reasoning fallback. Pinned. */
  openai_strong: "gpt-5.2",

  /** OpenAI balanced fallback. Pinned. */
  openai_balanced: "gpt-5-mini",

  /** Google cheap+fast. Pinned snapshot. */
  google_fast: "gemini-2.5-flash",

  /** Google strong reasoning. For cross-provider fallback on sensitive intents. Pinned. */
  google_strong: "gemini-2.5-pro",

  /** OpenAI embeddings. Pinned. */
  openai_embeddings: "text-embedding-3-large",

  /** OpenAI image generation. Pinned. */
  openai_images: "gpt-image-1",
} as const;

// ── Drift-prone aliases (for governance/telemetry alerts) ────
export const DRIFT_PRONE_ALIASES = new Set<string>([
  "claude-3-5-haiku-latest",
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
