/**
 * ai-gateway/observability.ts — Unified logging for gateway operations.
 */

import type { RoutingDecision, DeficitResult, AIGenerationPolicy } from "./types.ts";

export interface GatewayMetrics {
  jobType: string;
  routingMode: RoutingDecision;
  deficitResult: DeficitResult;
  cacheHit: boolean;
  model?: string;
  elapsedMs: number;
  requestId: string;
}

/**
 * Log gateway decision for monitoring.
 */
export function logGatewayDecision(m: GatewayMetrics): void {
  const emoji = {
    skipped: "⏭️",
    cache_hit: "💾",
    template_only: "📋",
    batch: "📦",
    sync: "⚡",
  }[m.routingMode] || "❓";

  console.log(
    `${emoji} [ai-gateway] ${m.jobType} → ${m.routingMode} | ` +
    `deficit=${m.deficitResult.shouldGenerate ? "YES" : "NO"}(${m.deficitResult.reason}) | ` +
    `cache=${m.cacheHit ? "HIT" : "MISS"} | ` +
    `model=${m.model || "n/a"} | ` +
    `${m.elapsedMs}ms | ` +
    `req=${m.requestId.slice(0, 8)}`,
  );
}

/**
 * Log cost savings from gateway decisions.
 */
export function logCostSaving(
  jobType: string,
  reason: "deficit_skip" | "cache_hit" | "template_expansion",
  estimatedSavedTokens: number,
): void {
  console.log(
    `💰 [ai-gateway] SAVED: ${jobType} — ${reason} — ~${estimatedSavedTokens} tokens not spent`,
  );
}
