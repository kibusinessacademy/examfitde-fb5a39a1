/**
 * STORE.PUBLISH.ORCHESTRATION.OS.1 — Release state machine (pure)
 */
import type { ReleaseState, ReleaseTimelineEventType } from "./contracts";

const TRANSITIONS: Record<ReleaseState, Partial<Record<ReleaseTimelineEventType, ReleaseState>>> = {
  draft: {
    created: "draft",
    review_completed: "review_ready",
    candidate_created: "candidate",
  },
  candidate: {
    review_completed: "review_ready",
    candidate_invalidated: "draft",
    approved: "approved_for_submission",
  },
  review_ready: {
    candidate_created: "candidate",
    candidate_invalidated: "draft",
    approved: "approved_for_submission",
  },
  approved_for_submission: {
    submission_started: "submitted_external",
    candidate_invalidated: "draft",
    submission_cancelled: "cancelled",
  },
  submitted_external: {
    store_feedback_received: "waiting_review",
    submission_cancelled: "cancelled",
  },
  waiting_review: {
    store_feedback_received: "waiting_review",
    rejected: "rejected",
    archived: "retired",
  },
  approved_store: {
    archived: "retired",
  },
  rejected: {
    candidate_invalidated: "draft",
    archived: "retired",
  },
  cancelled: {
    archived: "retired",
  },
  retired: {},
  released: {},
};

export function nextReleaseState(
  current: ReleaseState,
  event: ReleaseTimelineEventType,
): ReleaseState | null {
  return TRANSITIONS[current]?.[event] ?? null;
}

export function canTransition(current: ReleaseState, event: ReleaseTimelineEventType): boolean {
  return nextReleaseState(current, event) !== null;
}
