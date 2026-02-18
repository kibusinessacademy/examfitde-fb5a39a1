/**
 * Token Estimator – estimates token counts and costs when AI providers
 * don't return usage data (e.g. Lovable AI Gateway).
 *
 * Uses a simple heuristic: ~4 chars per token (English/German mix).
 * Cost rates are per 1M tokens based on published pricing (Feb 2026).
 */

// Pricing per 1M tokens in EUR (approximate, updated Feb 2026)
const PRICING_EUR_PER_M: Record<string, { input: number; output: number }> = {
  // Lovable Gateway models
  "google/gemini-2.5-flash":      { input: 0.07,  output: 0.28 },
  "google/gemini-2.5-flash-lite": { input: 0.04,  output: 0.15 },
  "google/gemini-2.5-pro":        { input: 1.15,  output: 4.60 },
  "google/gemini-3-flash-preview":{ input: 0.07,  output: 0.28 },
  "google/gemini-3-pro-preview":  { input: 1.15,  output: 4.60 },
  "openai/gpt-5":                 { input: 2.30,  output: 9.20 },
  "openai/gpt-5-mini":            { input: 0.37,  output: 1.47 },
  "openai/gpt-5-nano":            { input: 0.09,  output: 0.37 },
  "openai/gpt-5.2":               { input: 2.76,  output: 11.0 },
  // Direct provider models
  "gpt-4.1":                      { input: 1.84,  output: 7.36 },
  "gpt-4o-mini":                  { input: 0.14,  output: 0.55 },
  "claude-sonnet-4-20250514":     { input: 2.76,  output: 13.8 },
  "deepseek-chat":                { input: 0.13,  output: 0.28 },
  "gemini-2.5-flash":             { input: 0.07,  output: 0.28 },
};

const CHARS_PER_TOKEN = 4; // heuristic for mixed EN/DE text

/**
 * Estimate token count from a string.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate input tokens from messages array.
 */
export function estimateInputTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content) + 4; // +4 for role/message overhead
  }
  return total;
}

/**
 * Estimate cost in EUR given model, input tokens, output tokens.
 */
export function estimateCostEur(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = PRICING_EUR_PER_M[model];
  if (!pricing) {
    // Fallback: assume mid-range pricing
    return (tokensIn * 0.5 + tokensOut * 2.0) / 1_000_000;
  }
  return (tokensIn * pricing.input + tokensOut * pricing.output) / 1_000_000;
}

/**
 * Fill in missing usage data from an AI response.
 * If the gateway returned 0 tokens, estimate them.
 */
export function fillUsage(
  usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | undefined,
  model: string,
  messages: Array<{ role: string; content: string }>,
  responseContent: string,
): { tokens_in: number; tokens_out: number; cost_eur: number; estimated: boolean } {
  const hasReal = usage && ((usage.input_tokens ?? 0) > 0 || (usage.output_tokens ?? 0) > 0);

  if (hasReal) {
    const tokIn = usage!.input_tokens ?? 0;
    const tokOut = usage!.output_tokens ?? 0;
    return {
      tokens_in: tokIn,
      tokens_out: tokOut,
      cost_eur: estimateCostEur(model, tokIn, tokOut),
      estimated: false,
    };
  }

  // Estimate
  const tokIn = estimateInputTokens(messages);
  const tokOut = estimateTokens(responseContent);
  return {
    tokens_in: tokIn,
    tokens_out: tokOut,
    cost_eur: estimateCostEur(model, tokIn, tokOut),
    estimated: true,
  };
}
