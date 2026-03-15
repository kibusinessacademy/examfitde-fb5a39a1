/**
 * ai-gateway/router.ts — Central routing decision engine.
 *
 * Determines execution path: skipped | cache_hit | template_only | batch | sync
 * Supports canary rollout via hash(packageId) % 100 < batchRolloutPct.
 */

import type { AIGenerationPolicy, DeficitResult, RoutingDecision } from "./types.ts";

export interface RoutingInput {
  policy: AIGenerationPolicy;
  deficit: DeficitResult;
  cacheHit: boolean;
  urgency: "sync" | "async";
  forceSyncMode: boolean;
  templatePossible: boolean;
  /** Package ID used for deterministic canary gating */
  packageId?: string;
}

/**
 * Simple deterministic hash for canary gating.
 * Returns 0–99 based on package ID string.
 */
function canaryBucket(packageId: string): number {
  let hash = 0;
  for (let i = 0; i < packageId.length; i++) {
    hash = ((hash << 5) - hash + packageId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100;
}

/**
 * Pure function: decide how to route a generation request.
 */
export function decideRouting(input: RoutingInput): RoutingDecision {
  // Policy disabled → skip
  if (!input.policy.enabled) return "skipped";

  // Deficit check → skip if no need
  if (input.policy.requireDeficit && !input.deficit.shouldGenerate) return "skipped";

  // Cache hit → return cached
  if (input.policy.useCache && input.cacheHit) return "cache_hit";

  // Template-first (code expansion, no LLM needed)
  if (input.policy.templateFirst && input.templatePossible) return "template_only";

  // Force sync overrides batch preference
  if (input.forceSyncMode) return "sync";

  // Batch preferred for async work — with canary gate
  if (input.policy.preferBatch && input.urgency === "async" && input.policy.allowSync !== false) {
    const rolloutPct = input.policy.batchRolloutPct ?? 100;
    if (rolloutPct >= 100) return "batch";
    if (rolloutPct <= 0) return "sync";
    // Deterministic canary: hash(packageId) decides
    if (input.packageId) {
      return canaryBucket(input.packageId) < rolloutPct ? "batch" : "sync";
    }
    // No packageId → fall back to random
    return Math.random() * 100 < rolloutPct ? "batch" : "sync";
  }

  // Batch-only jobs (allowSync = false) — canary gate still applies
  if (input.policy.preferBatch && !input.policy.allowSync) {
    const rolloutPct = input.policy.batchRolloutPct ?? 100;
    if (rolloutPct >= 100) return "batch";
    if (rolloutPct <= 0) return "sync";
    if (input.packageId) {
      return canaryBucket(input.packageId) < rolloutPct ? "batch" : "sync";
    }
    return "batch";
  }

  return "sync";
}

/**
 * Log a routing decision for observability.
 */
export function formatRoutingLog(
  jobType: string,
  decision: RoutingDecision,
  deficit: DeficitResult,
  cacheHit: boolean,
): string {
  const parts = [
    `[ai-gateway] ROUTE: ${jobType} → ${decision}`,
    `deficit=${deficit.shouldGenerate ? "YES" : "NO"}(${deficit.reason})`,
    `cache=${cacheHit ? "HIT" : "MISS"}`,
  ];
  if (deficit.missingCount != null) {
    parts.push(`missing=${deficit.missingCount}`);
  }
  return parts.join(" | ");
}
