/**
 * STORE.OPS.PREDICTION.OS.1 — Audit payload builder.
 *
 * Builds a compact, immutable payload for security_events. No I/O.
 */
import type { PredictionProjection } from "./contracts.ts";

export function buildPredictionAudit(p: PredictionProjection): Record<string, unknown> {
  return {
    feature: "store_ops_prediction_os_1",
    run_id: p.run_id,
    operation_key: p.operation_key,
    evaluated_at_reference: p.evaluated_at_reference,
    risk_total: p.risk.total,
    risk_level: p.risk.level,
    confidence: p.confidence.score,
    success_probability: p.outcome.success_probability,
    expected_failures: p.outcome.expected_failures,
    expected_blocked: p.outcome.expected_blocked,
    expected_duration_seconds: p.duration.expected_total_seconds,
    queue_load_factor: p.queue_load.load_factor,
    manual_interventions_expected: p.manual_intervention.expected_count,
    warnings: p.warnings,
  };
}
