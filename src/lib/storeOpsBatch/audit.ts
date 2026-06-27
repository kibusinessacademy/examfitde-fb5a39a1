/**
 * STORE.OPS.BATCH.OS.1 — Audit payload builders (pure).
 */
import type { BatchPlan, BatchProjection } from "./contracts.ts";

export type BatchAuditEventName =
  | "store_ops_batch_planned"
  | "store_ops_batch_started"
  | "store_ops_batch_item_completed"
  | "store_ops_batch_completed"
  | "store_ops_batch_cancelled";

export interface BatchAuditPayload {
  event: BatchAuditEventName;
  batch_id: string;
  total: number;
  succeeded: number;
  failed: number;
  blocked: number;
  skipped: number;
  generated_at_reference: string;
}

export function buildBatchPlanAudit(plan: BatchPlan): BatchAuditPayload {
  const blocked = plan.items.filter((i) => i.status === "blocked").length;
  return {
    event: "store_ops_batch_planned",
    batch_id: plan.batch_id,
    total: plan.items.length,
    succeeded: 0,
    failed: 0,
    blocked,
    skipped: 0,
    generated_at_reference: plan.planned_at_reference,
  };
}

export function buildBatchProjectionAudit(
  event: BatchAuditEventName,
  projection: BatchProjection,
): BatchAuditPayload {
  return {
    event,
    batch_id: projection.batch_id,
    total: projection.total,
    succeeded: projection.succeeded,
    failed: projection.failed,
    blocked: projection.blocked,
    skipped: projection.skipped,
    generated_at_reference: projection.generated_at_reference,
  };
}
