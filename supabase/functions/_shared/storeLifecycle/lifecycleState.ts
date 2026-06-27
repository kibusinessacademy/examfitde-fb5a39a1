/**
 * STORE.LIFECYCLE.OS.1 — Lifecycle state machine (pure)
 */
import type { LifecycleEventType, LifecycleState } from "./contracts.ts";

const T: Record<LifecycleState, Partial<Record<LifecycleEventType, LifecycleState>>> = {
  not_submitted: {
    candidate_marked_submitted: "submitted_manual",
    blocked: "blocked",
    retired: "retired",
  },
  submitted_manual: {
    marked_in_review: "in_review",
    feedback_recorded: "in_review",
    metadata_fix_required: "metadata_required",
    rejected: "rejected",
    approved: "approved",
    blocked: "blocked",
  },
  in_review: {
    feedback_recorded: "in_review",
    metadata_fix_required: "metadata_required",
    rejected: "rejected",
    approved: "approved",
    blocked: "blocked",
  },
  metadata_required: {
    candidate_marked_submitted: "submitted_manual",
    feedback_recorded: "metadata_required",
    rejected: "rejected",
    approved: "approved",
    blocked: "blocked",
  },
  rejected: {
    candidate_marked_submitted: "submitted_manual",
    superseded_by: "superseded",
    retired: "retired",
    blocked: "blocked",
  },
  approved: {
    marked_ready_for_release: "ready_for_release",
    marked_released_external: "released_external",
    blocked: "blocked",
  },
  ready_for_release: {
    marked_released_external: "released_external",
    blocked: "blocked",
  },
  released_external: {
    superseded_by: "superseded",
    rollback_candidate_marked: "rollback_candidate",
    retired: "retired",
  },
  superseded: {
    rollback_candidate_marked: "rollback_candidate",
    retired: "retired",
  },
  rollback_candidate: {
    marked_released_external: "released_external",
    retired: "retired",
  },
  retired: {},
  blocked: {
    unblocked: "submitted_manual",
    retired: "retired",
  },
};

export function nextLifecycleState(
  current: LifecycleState,
  event: LifecycleEventType,
): LifecycleState | null {
  return T[current]?.[event] ?? null;
}

export function canLifecycleTransition(
  current: LifecycleState,
  event: LifecycleEventType,
): boolean {
  return nextLifecycleState(current, event) !== null;
}

export const TERMINAL_STATES: ReadonlySet<LifecycleState> = new Set(["retired"]);
