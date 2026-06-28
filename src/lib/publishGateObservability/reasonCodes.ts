/**
 * PUBLISH.PIPELINE.GATE.OBSERVABILITY.OS.1 — Reason-Code Contract (read-only)
 *
 * Mirrors the classifier in
 *   public.admin_classify_publish_silent_drop(uuid, uuid, int)
 * so the UI and tests can reason about silent BEFORE INSERT drops without
 * touching publish gates.
 */

export const SILENT_DROP_REASON_CODES = [
  "COUNCIL_DEFERRED",
  "PRICING_HARD_GATE_PRECONDITION",
  "BRONZE_LOCKED_REQUIRES_REVIEW",
  "PRODUCER_SOURCE_MISSING",
  "ORPHAN_HEAL_REQUIRES_BUILDING",
  "DAG_PREREQUISITES_MISSING",
  "DAG_GUARD_LOOP_DETECTED",
  "BLOCKED_PUBLISH_NO_PRODUCT",
  "PACKAGE_NOT_FOUND",
  "PUBLISH_GATE_BLOCKED",
  "UNKNOWN_SILENT_DROP",
] as const;

export type SilentDropReasonCode = (typeof SILENT_DROP_REASON_CODES)[number];

export const AUDIT_ACTION_TO_REASON: Readonly<Record<string, SilentDropReasonCode>> = {
  auto_publish_blocked_council_deferred: "COUNCIL_DEFERRED",
  publish_enqueue_blocked_no_pricing: "PRICING_HARD_GATE_PRECONDITION",
  bronze_locked_enqueue_blocked: "BRONZE_LOCKED_REQUIRES_REVIEW",
  producer_source_missing_blocked: "PRODUCER_SOURCE_MISSING",
  orphan_heal_phantom_blocked: "ORPHAN_HEAL_REQUIRES_BUILDING",
  dag_guard_block: "DAG_PREREQUISITES_MISSING",
  dag_guard_loop_detected: "DAG_GUARD_LOOP_DETECTED",
};

export function classifyAuditAction(actionType: string | null | undefined): SilentDropReasonCode {
  if (!actionType) return "PUBLISH_GATE_BLOCKED";
  return AUDIT_ACTION_TO_REASON[actionType] ?? "PUBLISH_GATE_BLOCKED";
}

export interface DispatcherSilentDropMetrics {
  dispatcher_enqueued: number;
  dispatcher_failed: number;
  dispatcher_silent_drops: number;
  dispatcher_silent_drop_reasons: Partial<Record<SilentDropReasonCode, number>>;
}

/** Build an idempotency key matching the dispatcher's INSERT path. */
export function buildDispatcherIdempotencyKey(packageId: string, queueId: string): string {
  return `sellable_dispatcher_os1:${packageId}:${queueId}`;
}
