/**
 * token-estimator.ts — Backward-compatible re-export
 *
 * All pricing logic has moved to model-pricing.ts (SSOT).
 * This file re-exports everything so existing imports continue to work.
 */

export {
  PRICING_EUR_PER_M,
  estimateTokens,
  estimateInputTokens,
  estimateCostEur,
  fillUsage,
  IMAGE_COST_USD,
  estimateImageCostEur,
  TOOL_COST_USD,
  estimateToolCostEur,
} from "./model-pricing.ts";

export type { ModelPricing, UsageLike, FilledUsage } from "./model-pricing.ts";
