/**
 * STORE.LIFECYCLE.OS.1 — Store feedback classifier (pure)
 */
import type {
  LifecycleEventType,
  LifecycleState,
  StoreFeedbackInput,
  StoreFeedbackType,
} from "./contracts.ts";

export interface FeedbackEffect {
  next_event: LifecycleEventType;
  next_state: LifecycleState | null;
  requires_new_binary: boolean;
  requires_metadata_fix: boolean;
  is_approval: boolean;
  is_rejection: boolean;
}

const APPROVED: ReadonlySet<StoreFeedbackType> = new Set([
  "apple_approved",
  "google_approved",
]);

const METADATA_REJECT: ReadonlySet<StoreFeedbackType> = new Set([
  "apple_metadata_rejected",
  "google_metadata_rejected",
]);

const BINARY_REJECT: ReadonlySet<StoreFeedbackType> = new Set([
  "apple_binary_rejected",
]);

const POLICY_REJECT: ReadonlySet<StoreFeedbackType> = new Set([
  "google_policy_rejected",
]);

const IN_REVIEW: ReadonlySet<StoreFeedbackType> = new Set([
  "apple_in_review",
  "apple_waiting_for_review",
  "google_in_review",
]);

const ACTION_REQUIRED: ReadonlySet<StoreFeedbackType> = new Set([
  "google_action_required",
]);

export function classifyFeedback(input: StoreFeedbackInput): FeedbackEffect {
  const t = input.store_feedback_type;
  if (APPROVED.has(t)) {
    return {
      next_event: "approved",
      next_state: "approved",
      requires_new_binary: false,
      requires_metadata_fix: false,
      is_approval: true,
      is_rejection: false,
    };
  }
  if (BINARY_REJECT.has(t)) {
    return {
      next_event: "rejected",
      next_state: "rejected",
      requires_new_binary: true,
      requires_metadata_fix: false,
      is_approval: false,
      is_rejection: true,
    };
  }
  if (POLICY_REJECT.has(t)) {
    return {
      next_event: "rejected",
      next_state: "rejected",
      requires_new_binary: false,
      requires_metadata_fix: true,
      is_approval: false,
      is_rejection: true,
    };
  }
  if (METADATA_REJECT.has(t)) {
    return {
      next_event: "metadata_fix_required",
      next_state: "metadata_required",
      requires_new_binary: false,
      requires_metadata_fix: true,
      is_approval: false,
      is_rejection: false,
    };
  }
  if (ACTION_REQUIRED.has(t)) {
    return {
      next_event: "metadata_fix_required",
      next_state: "metadata_required",
      requires_new_binary: false,
      requires_metadata_fix: true,
      is_approval: false,
      is_rejection: false,
    };
  }
  if (IN_REVIEW.has(t)) {
    return {
      next_event: "marked_in_review",
      next_state: "in_review",
      requires_new_binary: false,
      requires_metadata_fix: false,
      is_approval: false,
      is_rejection: false,
    };
  }
  // manual_note | unknown
  return {
    next_event: "feedback_recorded",
    next_state: null,
    requires_new_binary: false,
    requires_metadata_fix: false,
    is_approval: false,
    is_rejection: false,
  };
}
