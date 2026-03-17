/**
 * model-observability.ts — Performance Estimates for UI & Analytics
 *
 * ⚠️  IMPORTANT: These values are ESTIMATES, not governance SSOTs.
 * Do NOT use for routing decisions, health gates, or scheduling.
 * Use only for:
 *   - Admin UI display
 *   - Cost/performance planning dashboards
 *   - Burn-rate forecasting
 *
 * Sources:
 *   - "measured": Observed in production telemetry
 *   - "vendor-doc": From provider documentation
 *   - "estimated": Extrapolated from benchmarks or similar models
 */

export type PerfConfidence = "low" | "medium" | "high";
export type PerfSource = "measured" | "vendor-doc" | "estimated";
export type ModelTier = "nano" | "mini" | "standard" | "premium" | "reasoning";

export type ModelPerfEstimate = {
  /** Time-to-first-token P50 range in seconds */
  ttft_s_p50: [number, number];
  /** Output tokens per second (observed range) */
  output_tps_observed: [number, number];
  /** Requests per minute (typical for Tier 3-4 accounts) */
  rpm_observed: [number, number];
  /** Tokens per minute (Tier 3-4 midpoint) */
  tpm_observed: number;
  /** Speed/cost tier classification */
  tier: ModelTier;
  /** How much to trust these numbers */
  confidence: PerfConfidence;
  /** Where the data comes from */
  source: PerfSource;
};

/**
 * Performance estimates per model.
 * Updated: Mar 2026 based on OpenAI benchmarks + production observations.
 *
 * ⚠️ These are observational estimates, NOT contractual guarantees.
 * Actual performance varies by: region, load, prompt length, tier, time of day.
 */
export const MODEL_PERF_ESTIMATES: Record<string, ModelPerfEstimate> = {
  // ── OpenAI Nano Tier ───────────────────────────────────────
  "gpt-4.1-nano": {
    ttft_s_p50: [0.3, 0.6],
    output_tps_observed: [150, 250],
    rpm_observed: [10000, 20000],
    tpm_observed: 4_000_000,
    tier: "nano",
    confidence: "high",
    source: "vendor-doc",
  },
  "gpt-5-nano": {
    ttft_s_p50: [0.3, 0.6],
    output_tps_observed: [150, 250],
    rpm_observed: [10000, 20000],
    tpm_observed: 4_000_000,
    tier: "nano",
    confidence: "medium",
    source: "estimated",
  },

  // ── OpenAI Mini Tier ───────────────────────────────────────
  "gpt-4.1-mini": {
    ttft_s_p50: [0.5, 1.2],
    output_tps_observed: [120, 200],
    rpm_observed: [3000, 10000],
    tpm_observed: 2_000_000,
    tier: "mini",
    confidence: "high",
    source: "vendor-doc",
  },
  "gpt-4o-mini": {
    ttft_s_p50: [0.5, 1.0],
    output_tps_observed: [130, 200],
    rpm_observed: [3000, 10000],
    tpm_observed: 2_000_000,
    tier: "mini",
    confidence: "high",
    source: "measured",
  },
  "gpt-5-mini": {
    ttft_s_p50: [0.8, 1.5],
    output_tps_observed: [100, 150],
    rpm_observed: [3000, 10000],
    tpm_observed: 1_500_000,
    tier: "mini",
    confidence: "medium",
    source: "vendor-doc",
  },

  // ── OpenAI Standard Tier ───────────────────────────────────
  "gpt-4.1": {
    ttft_s_p50: [1.0, 2.0],
    output_tps_observed: [80, 130],
    rpm_observed: [1000, 5000],
    tpm_observed: 1_000_000,
    tier: "standard",
    confidence: "high",
    source: "vendor-doc",
  },
  "gpt-5": {
    ttft_s_p50: [1.5, 2.5],
    output_tps_observed: [70, 110],
    rpm_observed: [1000, 5000],
    tpm_observed: 800_000,
    tier: "standard",
    confidence: "medium",
    source: "estimated",
  },
  "gpt-5.2": {
    ttft_s_p50: [2.0, 3.0],
    output_tps_observed: [50, 90],
    rpm_observed: [1000, 3000],
    tpm_observed: 500_000,
    tier: "standard",
    confidence: "medium",
    source: "estimated",
  },

  // ── OpenAI Premium Tier ────────────────────────────────────
  "gpt-5.4": {
    ttft_s_p50: [2.0, 4.0],
    output_tps_observed: [40, 80],
    rpm_observed: [500, 2000],
    tpm_observed: 400_000,
    tier: "premium",
    confidence: "medium",
    source: "vendor-doc",
  },

  // ── GPT-5.4 Mini Tier (Mar 2026) ──────────────────────────
  "gpt-5.4-mini": {
    ttft_s_p50: [0.5, 1.2],
    output_tps_observed: [110, 180],
    rpm_observed: [3000, 10000],
    tpm_observed: 2_000_000,
    tier: "mini",
    confidence: "medium",
    source: "vendor-doc",
  },

  // ── GPT-5.4 Nano Tier (Mar 2026) ─────────────────────────
  "gpt-5.4-nano": {
    ttft_s_p50: [0.2, 0.5],
    output_tps_observed: [160, 260],
    rpm_observed: [10000, 20000],
    tpm_observed: 4_000_000,
    tier: "nano",
    confidence: "medium",
    source: "vendor-doc",
  },

  // ── Reasoning Tier ─────────────────────────────────────────
  "o4-mini": {
    ttft_s_p50: [1.5, 3.0],
    output_tps_observed: [60, 100],
    rpm_observed: [500, 2000],
    tpm_observed: 300_000,
    tier: "reasoning",
    confidence: "low",
    source: "estimated",
  },

  // ── Anthropic (Tier 4 — verified from Claude Console 2026-03-15) ──
  "claude-haiku-4-5-20251001": {
    ttft_s_p50: [0.5, 1.2],
    output_tps_observed: [100, 180],
    rpm_observed: [4000, 4000],     // Tier 4 actual: 4,000 RPM (was 2000-8000 estimated)
    tpm_observed: 4_000_000,        // Tier 4 actual: 4M input tokens/min
    tier: "mini",
    confidence: "high",
    source: "measured",             // Verified from Anthropic Console Limits page
  },
  "claude-sonnet-4-5-20250929": {
    ttft_s_p50: [1.0, 2.0],
    output_tps_observed: [60, 120],
    rpm_observed: [4000, 4000],     // Tier 4 actual: 4,000 RPM
    tpm_observed: 2_000_000,        // Tier 4 actual: 2M input tokens/min (incl. cache reads)
    tier: "standard",
    confidence: "high",
    source: "measured",             // Verified from Anthropic Console Limits page
  },

  // ── Google ─────────────────────────────────────────────────
  "gemini-2.5-flash": {
    ttft_s_p50: [0.3, 0.8],
    output_tps_observed: [120, 200],
    rpm_observed: [5000, 15000],
    tpm_observed: 4_000_000,
    tier: "mini",
    confidence: "medium",
    source: "vendor-doc",
  },
};
