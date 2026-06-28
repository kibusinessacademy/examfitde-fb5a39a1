import type { RecoveryAction } from "./contracts.ts";

export type RecoveryAuditEvent =
  | "pipeline_recovery_planned"
  | "pipeline_recovery_started"
  | "pipeline_recovery_completed"
  | "pipeline_recovery_skipped"
  | "pipeline_recovery_blocked"
  | "pipeline_recovery_manual_review";

export interface RecoveryAuditPayload {
  event: RecoveryAuditEvent;
  plan_id: string | null;
  action: Pick<RecoveryAction, "action_id" | "action_type" | "cause" | "package_id" | "reason"> & {
    metadata?: Record<string, unknown>;
  };
  actor_uid: string | null;
  reason: string;
  ts: string;
}

export function buildAuditEvent(
  event: RecoveryAuditEvent,
  action: RecoveryAction,
  opts: { plan_id: string | null; actor_uid: string | null; reason: string; ts?: string },
): RecoveryAuditPayload {
  return {
    event,
    plan_id: opts.plan_id,
    action: {
      action_id: action.action_id,
      action_type: action.action_type,
      cause: action.cause,
      package_id: action.package_id,
      reason: action.reason,
      metadata: action.metadata,
    },
    actor_uid: opts.actor_uid,
    reason: opts.reason,
    ts: opts.ts ?? new Date().toISOString(),
  };
}
