/**
 * STORE.OPS.KPI.OS.1 — Audit payload builders (pure).
 */
import type { StoreOpsKpiProjection } from "./contracts.ts";

export type KpiAuditEventName = "store_ops_kpi_evaluated" | "store_ops_kpi_persisted";

export interface KpiAuditPayload {
  event: KpiAuditEventName;
  health_score: number;
  total_manifests: number;
  bottleneck_count: number;
  warning_count: number;
  generated_at_reference: string;
}

export function buildKpiAuditPayload(
  event: KpiAuditEventName,
  projection: StoreOpsKpiProjection,
): KpiAuditPayload {
  return {
    event,
    health_score: projection.health_score,
    total_manifests: projection.summary.total_manifests,
    bottleneck_count: projection.bottlenecks.length,
    warning_count: projection.warnings.length,
    generated_at_reference: projection.generated_at_reference,
  };
}
