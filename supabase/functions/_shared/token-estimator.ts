/**
 * Token Estimator – estimates token counts and costs when AI providers
 * don't return usage data (e.g. Lovable AI Gateway).
 *
 * Uses a simple heuristic: ~4 chars per token (English/German mix).
 * Cost rates are per 1M tokens based on published pricing (Mar 2026).
 *
 * ── OpenAI Pricing Update (Mar 2026, from official pricing page) ──
 * GPT-5.4:      Input $2.50  / Output $15.00  (Cached $0.25)
 * GPT-5 mini:   Input $0.25  / Output $2.00   (Cached $0.025)
 * GPT-5.2:      Input $3.00  / Output $12.00   (prev. estimate)
 * GPT-5:        Input $2.50  / Output $10.00
 * GPT-5-nano:   Input $0.10  / Output $0.40
 * GPT-4.1:      Input $2.00  / Output $8.00
 * GPT-4.1 mini: Input $0.40  / Output $1.60
 * GPT-4.1 nano: Input $0.10  / Output $0.40
 * GPT-4o-mini:  Input $0.15  / Output $0.60
 * o4-mini:      Input $4.00  / Output $16.00   (reasoning model)
 *
 * Conversion: USD → EUR ≈ ×0.92
 */

// Pricing per 1M tokens in EUR (updated Mar 2026)
const PRICING_EUR_PER_M: Record<string, { input: number; output: number }> = {
  // ── Lovable Gateway models (prefixed) ──────────────────────
  "google/gemini-2.5-flash":      { input: 0.07,  output: 0.28 },
  "google/gemini-2.5-flash-lite": { input: 0.04,  output: 0.15 },
  "google/gemini-2.5-pro":        { input: 1.15,  output: 4.60 },
  "google/gemini-3-flash-preview":{ input: 0.07,  output: 0.28 },
  "google/gemini-3-pro-preview":  { input: 1.15,  output: 4.60 },
  "google/gemini-3.1-pro-preview":{ input: 1.15,  output: 4.60 },
  "google/gemini-3.1-flash-image-preview": { input: 0.07, output: 0.28 },
  "openai/gpt-5.4":               { input: 2.30,  output: 13.80 },
  "openai/gpt-5.2":               { input: 2.76,  output: 11.04 },
  "openai/gpt-5":                 { input: 2.30,  output: 9.20 },
  "openai/gpt-5-mini":            { input: 0.23,  output: 1.84 },
  "openai/gpt-5-nano":            { input: 0.09,  output: 0.37 },
  // ── Direct provider models — OpenAI (Mar 2026 pricing) ────
  "gpt-5.4":                      { input: 2.30,  output: 13.80 },
  "gpt-5.2":                      { input: 2.76,  output: 11.04 },
  "gpt-5":                        { input: 2.30,  output: 9.20 },
  "gpt-5-mini":                   { input: 0.23,  output: 1.84 },
  "gpt-5-nano":                   { input: 0.09,  output: 0.37 },
  "gpt-4.1":                      { input: 1.84,  output: 7.36 },
  "gpt-4.1-mini":                 { input: 0.37,  output: 1.47 },
  "gpt-4.1-nano":                 { input: 0.09,  output: 0.37 },
  "gpt-4o-mini":                  { input: 0.14,  output: 0.55 },
  "o4-mini":                      { input: 3.68,  output: 14.72 },
  "text-embedding-3-large":       { input: 0.12,  output: 0.00 },
  // ── Direct provider models — Anthropic ─────────────────────
  "claude-3-5-haiku-20241022":    { input: 0.25,  output: 1.25 },
  "claude-haiku-4-5-20251001":    { input: 0.80,  output: 4.00 },
  "claude-sonnet-4-5-20250929":   { input: 2.76,  output: 13.8 },
  "claude-sonnet-4-20250514":     { input: 2.76,  output: 13.8 },
  // ── Direct provider models — Google ────────────────────────
  "gemini-2.5-flash":             { input: 0.07,  output: 0.28 },
  "gemini-2.5-pro":               { input: 1.15,  output: 4.60 },
};

/**
 * ── Model Recommendations per Use Case (Mar 2026) ──
 *
 * | Use Case                    | Empfehlung (Primary)    | Fallback           | Begründung                                      |
 * |-----------------------------|-------------------------|--------------------|--------------------------------------------------|
 * | Volumen-Pipeline (Content)  | gpt-4o-mini (€0.14/M)  | gpt-5-nano         | Günstigstes Modell, >90% Qualität für Struktur   |
 * | Exam-Pool Generation        | gpt-5-mini (€0.23/M)   | gpt-4.1-mini       | Bessere Reasoning für Distraktoren, noch günstig  |
 * | Exam Validation / QA Gates  | gpt-5 (€2.30/M)        | gpt-5.2            | Hohe Präzision nötig bei Prüfungsinhalten         |
 * | AI Tutor (Learning)         | gpt-4o-mini             | gpt-5-mini         | Schnell + günstig für interaktive Chats           |
 * | AI Tutor (Exam-Modus)       | gpt-5-mini              | gpt-5              | Bessere Genauigkeit bei Prüfungshilfe             |
 * | Council (Propose/Critique)  | gpt-5-mini              | claude-haiku-4-5   | Gutes Reasoning, Provider-Diversität im Fallback  |
 * | Glossary / Handbook         | gpt-4o-mini             | gpt-5-nano         | Einfache Textgenerierung, Volumen-optimiert       |
 * | Embeddings                  | text-embedding-3-large  | –                  | Einziges Embedding-Modell                         |
 * | Sensitive Intents (Audit)   | gpt-5.2 (€2.76/M)      | gpt-5.4            | Maximale Qualität, nur wenige Calls               |
 * | Auto-Fix / Self-Heal        | gpt-5-mini              | gpt-4o-mini        | Moderate Reasoning, kosteneffizient               |
 *
 * Einspar-Potenzial vs. aktuelle Konfiguration:
 * - Migration gpt-4o-mini → gpt-5-nano für einfache Jobs: -35% Kosten
 * - GPT-5 → GPT-5-mini für Council: -90% Kosten bei ~5% Qualitätsverlust
 * - GPT-5.4 nur für Audit/Compliance: <5% aller Calls, höchste Qualität
 */

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
