/**
 * STORE.LIFECYCLE.OS.1 — Audit payload builders (pure)
 */
import type {
  LifecycleEvent,
  LifecycleEventType,
  StoreFeedbackInput,
} from "./contracts.ts";

export type LifecycleAuditEventName =
  | "lifecycle_event_recorded"
  | "store_feedback_recorded"
  | "rollback_candidate_proposed"
  | "lifecycle_blocked"
  | "lifecycle_unblocked";

export interface LifecycleAuditPayload {
  event: LifecycleAuditEventName;
  candidate_id: string;
  manifest_id: string;
  platform: string;
  event_type: LifecycleEventType | null;
  feedback_type: string | null;
  reason: string | null;
  generated_at: string;
}

export function buildLifecycleAuditPayload(
  event: LifecycleAuditEventName,
  ev: LifecycleEvent | null,
  feedback: StoreFeedbackInput | null,
  generated_at: string,
  reason: string | null = null,
): LifecycleAuditPayload {
  return {
    event,
    candidate_id: ev?.candidate_id ?? feedback?.candidate_id ?? "",
    manifest_id: ev?.manifest_id ?? feedback?.manifest_id ?? "",
    platform: ev?.platform ?? feedback?.platform ?? "any",
    event_type: ev?.event_type ?? null,
    feedback_type: feedback?.store_feedback_type ?? null,
    reason,
    generated_at,
  };
}
