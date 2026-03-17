/**
 * model-pricing.ts — Single Source of Truth for LLM pricing
 *
 * ALL cost calculations in the system MUST use this file.
 * Never hardcode prices elsewhere.
 *
 * ══════════════════════════════════════════════════════════════
 * Canonical Prices (Mar 2026, from OpenAI pricing page)
 * USD → EUR conversion: ×0.92
 * ══════════════════════════════════════════════════════════════
 * Model          | Input $/1M | Output $/1M | Cached $/1M
 * --------------- ------------ ------------- ------------
 * GPT-4.1 nano   | $0.10      | $0.40       | $0.025
 * GPT-4.1 mini   | $0.40      | $1.60       | $0.10
 * GPT-4.1        | $2.00      | $8.00       | $0.50
 * GPT-4o-mini    | $0.15      | $0.60       | $0.075
 * GPT-5 nano     | $0.10      | $0.40       | $0.025
 * GPT-5 mini     | $0.25      | $2.00       | $0.025
 * GPT-5          | $2.50      | $10.00      | $0.25
 * GPT-5.2        | $3.00      | $12.00      | $0.75
 * GPT-5.4        | $2.50      | $15.00      | $0.25
 * GPT-5.4 mini   | $0.75      | $4.50       | $0.1875
 * GPT-5.4 nano   | $0.20      | $1.25       | $0.05
 * o4-mini        | $4.00      | $16.00      | $1.00
 * ══════════════════════════════════════════════════════════════
 */

// ── Pricing metadata (for audit trail & governance) ─────────

export const PRICING_META = {
  source_currency: "USD" as const,
  fx_rate_applied: 0.92,
  effective_date: "2026-03-15",
  source: "OpenAI pricing page + vendor docs",
} as const;

const USD_TO_EUR = PRICING_META.fx_rate_applied;

// ── Raw USD prices (canonical source) ───────────────────────

const RAW_USD: Record<string, { input: number; output: number; cached: number }> = {
  "gpt-4.1-nano":  { input: 0.10,  output: 0.40,  cached: 0.025 },
  "gpt-4.1-mini":  { input: 0.40,  output: 1.60,  cached: 0.10  },
  "gpt-4.1":       { input: 2.00,  output: 8.00,  cached: 0.50  },
  "gpt-4o-mini":   { input: 0.15,  output: 0.60,  cached: 0.075 },
  "gpt-5-nano":    { input: 0.10,  output: 0.40,  cached: 0.025 },
  "gpt-5-mini":    { input: 0.25,  output: 2.00,  cached: 0.025 },
  "gpt-5":         { input: 2.50,  output: 10.00, cached: 0.25  },
  "gpt-5.2":       { input: 3.00,  output: 12.00, cached: 0.75  },
  "gpt-5.4":       { input: 2.50,  output: 15.00, cached: 0.25  },
  "gpt-5.4-mini":  { input: 0.75,  output: 4.50,  cached: 0.1875 },
  "gpt-5.4-nano":  { input: 0.20,  output: 1.25,  cached: 0.05  },
  "o4-mini":       { input: 4.00,  output: 16.00, cached: 1.00  },
  // Embeddings
  "text-embedding-3-large": { input: 0.13, output: 0.00, cached: 0.00 },
  // Image Generation (text-mode token prices)
  "gpt-image-1.5": { input: 5.00, output: 10.00, cached: 1.25 },
  "gpt-image-1":   { input: 5.00, output: 0.00,  cached: 1.25 },
  "gpt-image-1-mini": { input: 2.00, output: 0.00, cached: 0.20 },
  // Anthropic
  "claude-3-5-haiku-20241022":  { input: 0.25,  output: 1.25,  cached: 0.025 },
  "claude-haiku-4-5-20251001":  { input: 0.80,  output: 4.00,  cached: 0.08  },
  "claude-sonnet-4-5-20250929": { input: 3.00,  output: 15.00, cached: 0.30  },
  "claude-sonnet-4-20250514":   { input: 3.00,  output: 15.00, cached: 0.30  },
  // Google
  "gemini-2.5-flash":     { input: 0.075, output: 0.30,  cached: 0.01875 },
  "gemini-2.5-pro":       { input: 1.25,  output: 5.00,  cached: 0.3125  },
};

// ── Derived EUR pricing (auto-computed, includes prefixed variants) ──

export type ModelPricing = { input: number; output: number; cached: number };

function toEur(usd: { input: number; output: number; cached: number }): ModelPricing {
  return {
    input:  Math.round(usd.input  * USD_TO_EUR * 1000) / 1000,
    output: Math.round(usd.output * USD_TO_EUR * 1000) / 1000,
    cached: Math.round(usd.cached * USD_TO_EUR * 1000) / 1000,
  };
}

export const PRICING_EUR_PER_M: Record<string, ModelPricing> = {};

// Populate both raw and prefixed model names
for (const [model, usd] of Object.entries(RAW_USD)) {
  const eur = toEur(usd);
  PRICING_EUR_PER_M[model] = eur;

  // Add "openai/" prefix for Lovable Gateway models
  if (model.startsWith("gpt-") || model.startsWith("o4-") || model.startsWith("text-") || model.startsWith("gpt-image")) {
    PRICING_EUR_PER_M[`openai/${model}`] = eur;
  }
  if (model.startsWith("gemini-")) {
    PRICING_EUR_PER_M[`google/${model}`] = eur;
  }
}

// Additional Lovable Gateway Google models — match family pricing
const GOOGLE_PREVIEW_ALIASES = [
  "google/gemini-3-flash-preview",
  "google/gemini-3-pro-preview",
  "google/gemini-3-pro-image-preview",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3.1-flash-image-preview",
];
for (const alias of GOOGLE_PREVIEW_ALIASES) {
  if (PRICING_EUR_PER_M[alias]) continue;
  // Match by family: flash → flash pricing, pro → pro pricing
  if (alias.includes("flash")) {
    PRICING_EUR_PER_M[alias] = PRICING_EUR_PER_M["gemini-2.5-flash"];
  } else if (alias.includes("pro")) {
    PRICING_EUR_PER_M[alias] = PRICING_EUR_PER_M["gemini-2.5-pro"];
  }
}

// ── Image Generation Cost (per-image, not per-token) ────────

/**
 * Per-image costs from OpenAI pricing page (Mar 2026).
 * Image output is billed per generated image, not per token.
 * quality: low ~$0.01, medium ~$0.04, high ~$0.17 (square)
 */
export const IMAGE_COST_USD: Record<string, Record<string, number>> = {
  "gpt-image-1": { low: 0.01, medium: 0.04, high: 0.17 },
  "gpt-image-1-mini": { low: 0.005, medium: 0.02, high: 0.08 },
  "gpt-image-1.5": { low: 0.01, medium: 0.04, high: 0.17 },
};

export function estimateImageCostEur(
  model: string,
  quality: "low" | "medium" | "high" = "medium",
  count = 1,
): number {
  const costs = IMAGE_COST_USD[model];
  if (!costs) return count * 0.04 * PRICING_META.fx_rate_applied; // fallback
  return count * costs[quality] * PRICING_META.fx_rate_applied;
}

// ── Tool Usage Costs (Web Search, File Search) ──────────────

/**
 * Tool invocation costs from OpenAI pricing page (Mar 2026).
 * These are ADDITIONAL costs on top of token costs.
 */
export const TOOL_COST_USD = {
  /** Web search: $10 / 1k calls + search content tokens at model input rate */
  web_search: { per_1k_calls: 10.00 },
  /** Web search preview (reasoning models): $10 / 1k calls */
  web_search_preview_reasoning: { per_1k_calls: 10.00 },
  /** Web search preview (non-reasoning): $25 / 1k calls, search tokens free */
  web_search_preview_non_reasoning: { per_1k_calls: 25.00 },
  /** File search: $2.50 / 1k calls */
  file_search: { per_1k_calls: 2.50 },
  /** File search storage: $0.10 / GB / day (first 1 GB free) */
  file_search_storage_per_gb_day: 0.10,
} as const;

/**
 * Estimate tool invocation cost in EUR.
 */
export function estimateToolCostEur(
  tool: keyof typeof TOOL_COST_USD,
  calls: number,
): number {
  const entry = TOOL_COST_USD[tool];
  if (!entry || typeof entry !== "object" || !("per_1k_calls" in entry)) return 0;
  return (calls / 1000) * entry.per_1k_calls * PRICING_META.fx_rate_applied;
}

// ── Estimation helpers ──────────────────────────────────────

/**
 * Chars-per-token heuristic.
 * German technical content averages ~3.5 chars/token.
 * English averages ~4. We use 3.7 for mixed DE/EN content.
 */
const CHARS_PER_TOKEN = 3.7;

/** Estimate token count from a string. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Estimate input tokens from a messages array. */
export function estimateInputTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content) + 4; // +4 for role/message framing overhead
  }
  return total;
}

/**
 * Estimate cost in EUR given model, input tokens, output tokens.
 * Optionally accounts for cached input tokens (prompt caching).
 */
export function estimateCostEur(
  model: string,
  tokensIn: number,
  tokensOut: number,
  cachedIn = 0,
): number {
  const pricing = PRICING_EUR_PER_M[model];
  if (!pricing) {
    // Unknown model fallback: use GPT-5-mini pricing as mid-range estimate
    const fb = PRICING_EUR_PER_M["gpt-5-mini"];
    const billableIn = Math.max(0, tokensIn - cachedIn);
    return (
      billableIn * fb.input +
      cachedIn * fb.cached +
      tokensOut * fb.output
    ) / 1_000_000;
  }
  const billableIn = Math.max(0, tokensIn - cachedIn);
  return (
    billableIn * pricing.input +
    cachedIn * pricing.cached +
    tokensOut * pricing.output
  ) / 1_000_000;
}

// ── fillUsage: Robust usage backfill ────────────────────────

export type UsageLike = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cached_input_tokens?: number;
};

export type FilledUsage = {
  tokens_in: number;
  tokens_out: number;
  total_tokens: number;
  cached_tokens_in: number;
  cost_eur: number;
  estimated: boolean;
};

/**
 * Fill in missing usage data from an AI response.
 * Handles three scenarios:
 * 1. Provider returns explicit input/output tokens → use them
 * 2. Provider returns only total_tokens → split heuristically (70/30)
 * 3. No usage at all → estimate from message content
 */
export function fillUsage(
  usage: UsageLike | undefined,
  model: string,
  messages: Array<{ role: string; content: string }>,
  responseContent: string,
): FilledUsage {
  const cached = usage?.cached_input_tokens ?? 0;

  // Case 1: Explicit input/output
  const hasExplicitInOut =
    (usage?.input_tokens ?? 0) > 0 || (usage?.output_tokens ?? 0) > 0;

  if (hasExplicitInOut) {
    const tokIn = usage!.input_tokens ?? 0;
    const tokOut = usage!.output_tokens ?? 0;
    return {
      tokens_in: tokIn,
      tokens_out: tokOut,
      total_tokens: usage?.total_tokens ?? (tokIn + tokOut),
      cached_tokens_in: cached,
      cost_eur: estimateCostEur(model, tokIn, tokOut, cached),
      estimated: false,
    };
  }

  // Case 2: Only total_tokens available (some providers)
  if ((usage?.total_tokens ?? 0) > 0) {
    const total = usage!.total_tokens!;
    // Heuristic split: ~70% input, ~30% output for typical chat
    const tokIn = Math.round(total * 0.7);
    const tokOut = total - tokIn;
    // Carry through cached if available and plausible
    const effectiveCached = cached > 0 && cached <= tokIn ? cached : 0;
    return {
      tokens_in: tokIn,
      tokens_out: tokOut,
      total_tokens: total,
      cached_tokens_in: effectiveCached,
      cost_eur: estimateCostEur(model, tokIn, tokOut, effectiveCached),
      estimated: true, // split is estimated even though total is real
    };
  }

  // Case 3: No usage at all → full estimation
  const estIn = estimateInputTokens(messages);
  const estOut = estimateTokens(responseContent);
  return {
    tokens_in: estIn,
    tokens_out: estOut,
    total_tokens: estIn + estOut,
    cached_tokens_in: 0,
    cost_eur: estimateCostEur(model, estIn, estOut),
    estimated: true,
  };
}
