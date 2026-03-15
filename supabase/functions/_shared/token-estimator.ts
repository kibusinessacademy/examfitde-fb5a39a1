/**
 * Token Estimator – estimates token counts and costs when AI providers
 * don't return usage data (e.g. Lovable AI Gateway).
 *
 * Uses a simple heuristic: ~4 chars per token (English/German mix).
 * Cost rates are per 1M tokens based on published pricing (Mar 2026).
 *
 * ══════════════════════════════════════════════════════════════════
 * OpenAI Pricing Update (Mar 2026, from official pricing page)
 * ══════════════════════════════════════════════════════════════════
 * Model          | Input $/1M | Output $/1M | Cached $/1M | Latency  | Tok/s
 * -------------- | ---------- | ----------- | ----------- | -------- | -----
 * GPT-4.1 nano   | $0.10      | $0.40       | $0.025      | 0.3-0.6s | 150-250
 * GPT-4.1 mini   | $0.40      | $1.60       | $0.10       | 0.5-1.2s | 120-200
 * GPT-4o-mini    | $0.15      | $0.60       | $0.075      | 0.5-1.0s | 130-200
 * GPT-5 nano     | $0.10      | $0.40       | $0.025      | 0.3-0.6s | 150-250
 * GPT-5 mini     | $0.25      | $2.00       | $0.025      | 0.8-1.5s | 100-150
 * GPT-4.1        | $2.00      | $8.00       | $0.50       | 1-2s     | 80-130
 * GPT-5          | $2.50      | $10.00      | $0.25       | 1.5-2.5s | 70-110
 * o4-mini        | $4.00      | $16.00      | $1.00       | 1.5-3s   | 60-100
 * GPT-5.2        | $3.00      | $12.00      | $0.75       | 2-3s     | 50-90
 * GPT-5.4        | $2.50      | $15.00      | $0.25       | 2-4s     | 40-80
 *
 * Rate Limits (Tier 3-4 typical):
 *   nano: 10-20k RPM, 2-4M TPM
 *   mini: 3-10k RPM, 1-2M TPM
 *   standard: 1-5k RPM, 500k-1M TPM
 *   reasoning: 500-2k RPM, 200-500k TPM
 *
 * Conversion: USD → EUR ≈ ×0.92
 * ══════════════════════════════════════════════════════════════════
 */

// ── Pricing per 1M tokens in EUR (updated Mar 2026) ─────────────

const PRICING_EUR_PER_M: Record<string, { input: number; output: number }> = {
  // ── Lovable Gateway models (prefixed) ──────────────────────
  "google/gemini-2.5-flash":       { input: 0.07,  output: 0.28 },
  "google/gemini-2.5-flash-lite":  { input: 0.04,  output: 0.15 },
  "google/gemini-2.5-pro":         { input: 1.15,  output: 4.60 },
  "google/gemini-3-flash-preview": { input: 0.07,  output: 0.28 },
  "google/gemini-3-pro-preview":   { input: 1.15,  output: 4.60 },
  "google/gemini-3.1-pro-preview": { input: 1.15,  output: 4.60 },
  "google/gemini-3.1-flash-image-preview": { input: 0.07, output: 0.28 },
  "openai/gpt-5.4":               { input: 2.30,  output: 13.80 },
  "openai/gpt-5.2":               { input: 2.76,  output: 11.04 },
  "openai/gpt-5":                  { input: 2.30,  output: 9.20 },
  "openai/gpt-5-mini":             { input: 0.23,  output: 1.84 },
  "openai/gpt-5-nano":             { input: 0.09,  output: 0.37 },
  // ── Direct provider models — OpenAI (Mar 2026) ────────────
  "gpt-5.4":                       { input: 2.30,  output: 13.80 },
  "gpt-5.2":                       { input: 2.76,  output: 11.04 },
  "gpt-5":                         { input: 2.30,  output: 9.20 },
  "gpt-5-mini":                    { input: 0.23,  output: 1.84 },
  "gpt-5-nano":                    { input: 0.09,  output: 0.37 },
  "gpt-4.1":                       { input: 1.84,  output: 7.36 },
  "gpt-4.1-mini":                  { input: 0.37,  output: 1.47 },
  "gpt-4.1-nano":                  { input: 0.09,  output: 0.37 },
  "gpt-4o-mini":                   { input: 0.14,  output: 0.55 },
  "o4-mini":                       { input: 3.68,  output: 14.72 },
  "text-embedding-3-large":        { input: 0.12,  output: 0.00 },
  // ── Direct provider models — Anthropic ─────────────────────
  "claude-3-5-haiku-20241022":     { input: 0.25,  output: 1.25 },
  "claude-haiku-4-5-20251001":     { input: 0.80,  output: 4.00 },
  "claude-sonnet-4-5-20250929":    { input: 2.76,  output: 13.8 },
  "claude-sonnet-4-20250514":      { input: 2.76,  output: 13.8 },
  // ── Direct provider models — Google ────────────────────────
  "gemini-2.5-flash":              { input: 0.07,  output: 0.28 },
  "gemini-2.5-pro":                { input: 1.15,  output: 4.60 },
};

// ── Performance characteristics per model ───────────────────────

export const MODEL_PERF: Record<string, {
  latency_s: [number, number]; // [min, max] Time-to-First-Token
  throughput_tps: [number, number]; // [min, max] Tokens per second
  rpm_typical: [number, number]; // [min, max] Requests per minute (Tier 3-4)
  tpm_typical: number; // Tokens per minute (Tier 3-4 midpoint)
  tier: "nano" | "mini" | "standard" | "reasoning" | "premium";
}> = {
  "gpt-4.1-nano":  { latency_s: [0.3, 0.6],  throughput_tps: [150, 250], rpm_typical: [10000, 20000], tpm_typical: 4_000_000, tier: "nano" },
  "gpt-5-nano":    { latency_s: [0.3, 0.6],  throughput_tps: [150, 250], rpm_typical: [10000, 20000], tpm_typical: 4_000_000, tier: "nano" },
  "gpt-4.1-mini":  { latency_s: [0.5, 1.2],  throughput_tps: [120, 200], rpm_typical: [3000, 10000],  tpm_typical: 2_000_000, tier: "mini" },
  "gpt-4o-mini":   { latency_s: [0.5, 1.0],  throughput_tps: [130, 200], rpm_typical: [3000, 10000],  tpm_typical: 2_000_000, tier: "mini" },
  "gpt-5-mini":    { latency_s: [0.8, 1.5],  throughput_tps: [100, 150], rpm_typical: [3000, 10000],  tpm_typical: 1_500_000, tier: "mini" },
  "gpt-4.1":       { latency_s: [1.0, 2.0],  throughput_tps: [80, 130],  rpm_typical: [1000, 5000],   tpm_typical: 1_000_000, tier: "standard" },
  "gpt-5":         { latency_s: [1.5, 2.5],  throughput_tps: [70, 110],  rpm_typical: [1000, 5000],   tpm_typical: 800_000,   tier: "standard" },
  "gpt-5.2":       { latency_s: [2.0, 3.0],  throughput_tps: [50, 90],   rpm_typical: [1000, 3000],   tpm_typical: 500_000,   tier: "standard" },
  "gpt-5.4":       { latency_s: [2.0, 4.0],  throughput_tps: [40, 80],   rpm_typical: [500, 2000],    tpm_typical: 400_000,   tier: "premium" },
  "o4-mini":       { latency_s: [1.5, 3.0],  throughput_tps: [60, 100],  rpm_typical: [500, 2000],    tpm_typical: 300_000,   tier: "reasoning" },
  // Anthropic
  "claude-haiku-4-5-20251001": { latency_s: [0.5, 1.2], throughput_tps: [100, 180], rpm_typical: [2000, 8000], tpm_typical: 1_500_000, tier: "mini" },
  // Google
  "gemini-2.5-flash":          { latency_s: [0.3, 0.8], throughput_tps: [120, 200], rpm_typical: [5000, 15000], tpm_typical: 4_000_000, tier: "mini" },
};

// ══════════════════════════════════════════════════════════════════
// ExamFit Pipeline — Optimale Model-Routing-Matrix (Mar 2026)
// ══════════════════════════════════════════════════════════════════
//
// Pipeline-Step                  | Primary          | Fallback 1          | Fallback 2       | Anteil | Ø Tokens
// -------------------------------|------------------|---------------------|------------------|--------|----------
// scaffold_learning_course       | gpt-4.1-nano     | gpt-5-nano          | gpt-4o-mini      | ~2%    | 1.5k
// generate_glossary              | gpt-4.1-nano     | gpt-5-nano          | gpt-4o-mini      | ~3%    | 2k
// generate_learning_content      | gpt-4.1-mini     | gpt-5-mini          | gpt-4o-mini      | ~25%   | 8k
// validate_content               | gpt-5-mini       | gpt-4.1-mini        | gpt-5            | ~5%    | 3k
// generate_exam_pool             | gpt-5-mini       | gpt-4.1-mini        | gpt-5            | ~30%   | 12k
// generate_handbook              | gpt-4.1-mini     | gpt-4o-mini         | gpt-5-nano       | ~10%   | 6k
// generate_minichecks            | gpt-4.1-nano     | gpt-5-nano          | gpt-4o-mini      | ~8%    | 3k
// elite_harden (QA Gate)         | gpt-5.4          | gpt-5.2             | gpt-5            | ~2%    | 5k
// council_propose                | gpt-5-mini       | claude-haiku-4-5    | gpt-4.1-mini     | ~5%    | 4k
// council_critique               | gpt-5-mini       | claude-haiku-4-5    | gpt-5            | ~5%    | 4k
// auto_fix / self_heal           | gpt-4.1-mini     | gpt-5-mini          | gpt-4o-mini      | ~3%    | 4k
// ai_tutor (learning)            | gpt-4o-mini      | gpt-4.1-nano        | gpt-5-nano       | ~1%    | 2k
// ai_tutor (exam)                | gpt-5-mini       | gpt-5               | gpt-4.1-mini     | ~1%    | 3k
//
// ── Kalkulation: Kosten pro Kurs (1 Curriculum, ~14 LF, ~80 Kompetenzen) ──
//
// Annahmen:
//   - 80 Kompetenzen × 5 Lektionen = 400 Lektions-Generierungen
//   - 80 Kompetenzen × 20 Prüfungsfragen = 1.600 Exam-Generierungen
//   - 14 LF × 1 Handbook-Kapitel = 14 Handbook-Generierungen
//   - 400 Minichecks, 1 Scaffold, 14 Glossar-Einträge
//   - Council: ~50 Propose+Critique-Zyklen
//   - Elite Harden: ~100 QA-Checks
//
// Step                    | Calls | Ø In   | Ø Out  | Modell       | Kosten/Call | Gesamt
// ------------------------|-------|--------|--------|--------------|-------------|--------
// scaffold                | 1     | 2k     | 1k     | gpt-4.1-nano | €0.0003     | €0.00
// glossary                | 14    | 3k     | 2k     | gpt-4.1-nano | €0.0004     | €0.01
// learning_content        | 400   | 5k     | 6k     | gpt-4.1-mini | €0.0107     | €4.28
// validate_content        | 400   | 4k     | 1k     | gpt-5-mini   | €0.0028     | €1.10
// exam_pool               | 160   | 8k     | 10k    | gpt-5-mini   | €0.0202     | €3.24
// handbook                | 14    | 4k     | 8k     | gpt-4.1-mini | €0.0133     | €0.19
// minichecks              | 400   | 2k     | 2k     | gpt-4.1-nano | €0.0003     | €0.11
// elite_harden            | 100   | 6k     | 2k     | gpt-5.4      | €0.0414     | €4.14
// council_propose         | 50    | 4k     | 3k     | gpt-5-mini   | €0.0065     | €0.32
// council_critique        | 50    | 5k     | 2k     | gpt-5-mini   | €0.0048     | €0.24
// auto_fix                | 20    | 4k     | 3k     | gpt-4.1-mini | €0.0059     | €0.12
//                                                                   GESAMT:      ≈ €13.75
//
// Vergleich mit altem Routing (alles gpt-4o-mini/gpt-5):          ≈ €45-65/Kurs
// ─── Einsparung: ~70-80% ───
//
// Latenz-Profil:
//   - 90% der Calls: <1.5s TTFT (nano+mini Modelle)
//   - Rate-Limit-Safe: nano=10k+ RPM, mini=3k+ RPM → kein Bottleneck
//   - Elite-Harden (2% der Calls): 2-4s akzeptabel (Qualitätskritisch)
//
// ══════════════════════════════════════════════════════════════════

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
