/**
 * STORE.OPS.INTELLIGENCE.OS.1 — Audit payloads (pure).
 */
import type { IntelligenceProjection } from "./contracts.ts";

export function buildIntelligenceAudit(p: IntelligenceProjection): Record<string, unknown> {
  return {
    feature: "STORE.OPS.INTELLIGENCE.OS.1",
    run_id: p.run_id,
    evaluated_at_reference: p.evaluated_at_reference,
    risk: p.risk,
    confidence: p.confidence,
    top_blocker_count: p.top_blockers.length,
    top_failure_count: p.top_failures.length,
    cluster_count: p.blocker_clusters.length,
    recommendation_codes: p.recommendations.map((r) => r.code),
    warnings: p.warnings,
  };
}
