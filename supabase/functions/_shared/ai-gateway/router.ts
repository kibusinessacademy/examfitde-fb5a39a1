/**
 * ai-gateway/router.ts — Central routing decision engine.
 *
 * Determines execution path: skipped | cache_hit | template_only | batch | sync
 */

import type { AIGenerationPolicy, DeficitResult, RoutingDecision } from "./types.ts";

export interface RoutingInput {
  policy: AIGenerationPolicy;
  deficit: DeficitResult;
  cacheHit: boolean;
  urgency: "sync" | "async";
  forceSyncMode: boolean;
  templatePossible: boolean;
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

  // Batch preferred for async work
  if (input.policy.preferBatch && input.urgency === "async" && input.policy.allowSync !== false) {
    return "batch";
  }

  // Batch-only jobs (allowSync = false)
  if (input.policy.preferBatch && !input.policy.allowSync) {
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
