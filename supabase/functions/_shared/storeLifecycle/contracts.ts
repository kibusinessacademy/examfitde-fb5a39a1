/**
 * STORE.LIFECYCLE.OS.1 — Pure contracts
 *
 * Hard rules:
 *  - No DB. No HTTP. No clock. No RNG. No fetch.
 *  - This layer NEVER publishes, NEVER submits, NEVER calls Store APIs.
 *  - It only models the human-driven lifecycle of a release candidate
 *    after manual upload to App Store Connect / Play Console.
 */

export type LifecycleState =
  | "not_submitted"
  | "submitted_manual"
  | "in_review"
  | "metadata_required"
  | "rejected"
  | "approved"
  | "ready_for_release"
  | "released_external"
  | "superseded"
  | "rollback_candidate"
  | "retired"
  | "blocked";

export type StorePlatform = "apple" | "google";

export type StoreFeedbackType =
  | "apple_metadata_rejected"
  | "apple_binary_rejected"
  | "apple_approved"
  | "apple_waiting_for_review"
  | "apple_in_review"
  | "google_metadata_rejected"
  | "google_policy_rejected"
  | "google_approved"
  | "google_in_review"
  | "google_action_required"
  | "manual_note"
  | "unknown";

export type StoreFeedbackStatus =
  | "informational"
  | "action_required"
  | "blocking"
  | "resolved"
  | "approved"
  | "rejected";

export interface StoreFeedbackInput {
  candidate_id: string;
  manifest_id: string;
  platform: StorePlatform;
  store_feedback_type: StoreFeedbackType;
  store_feedback_status: StoreFeedbackStatus;
  external_reference: string | null;
  reason_code: string | null;
  human_summary: string;
  required_action: string | null;
  received_at_reference: string;
  evidence_url: string | null;
  reviewer: string | null;
  payload_hash: string | null;
}

export type LifecycleEventType =
  | "candidate_marked_submitted"
  | "feedback_recorded"
  | "marked_in_review"
  | "metadata_fix_required"
  | "rejected"
  | "approved"
  | "marked_ready_for_release"
  | "marked_released_external"
  | "superseded_by"
  | "rollback_candidate_marked"
  | "retired"
  | "blocked"
  | "unblocked";

export interface LifecycleEvent {
  candidate_id: string;
  manifest_id: string;
  platform: StorePlatform | "any";
  event_type: LifecycleEventType;
  from_state: LifecycleState;
  to_state: LifecycleState;
  occurred_at_reference: string;
  actor_id: string | null;
  feedback_ref: string | null;
  note: string | null;
}

export interface CandidateSnapshot {
  candidate_id: string;
  manifest_id: string;
  product_id: string | null;
  curriculum_id: string | null;
  course_id: string | null;
  version: string;
  build_number: string | null;
  manifest_hash: string | null;
  listing_hash: string | null;
  package_hash: string | null;
  build_hash: string | null;
  approved_externally: boolean;
  released_externally: boolean;
  retired: boolean;
  created_at_reference: string;
}

export type LifecycleNextAction =
  | "mark_submitted_manual"
  | "record_store_feedback"
  | "fix_metadata_and_resubmit"
  | "build_new_binary_and_resubmit"
  | "mark_approved"
  | "mark_ready_for_release"
  | "mark_released_external"
  | "open_rollback_candidate"
  | "retire_candidate"
  | "unblock_candidate"
  | "await_external_review";

export type LifecycleBlockingReason =
  | "NO_CANDIDATE"
  | "HASH_DRIFT_SINCE_SUBMISSION"
  | "BINARY_REJECTED"
  | "METADATA_REJECTED"
  | "POLICY_REJECTED"
  | "ACTION_REQUIRED_BY_STORE"
  | "RETIRED"
  | "EXPLICITLY_BLOCKED";

export type LifecycleWarning =
  | "WAITING_FOR_REVIEW"
  | "IN_REVIEW"
  | "MULTIPLE_OPEN_REJECTIONS"
  | "NO_ROLLBACK_AVAILABLE"
  | "HASH_DRIFT_DETECTED"
  | "MANUAL_NOTE_ATTACHED";

export type LifecycleRiskLevel = "low" | "moderate" | "elevated" | "high";

export interface PlatformProjection {
  platform: StorePlatform;
  state: LifecycleState;
  last_feedback_type: StoreFeedbackType | null;
  last_feedback_status: StoreFeedbackStatus | null;
  last_received_at_reference: string | null;
}

export interface LifecycleProjection {
  lifecycle_state: LifecycleState;
  platform_state: { apple: PlatformProjection | null; google: PlatformProjection | null };
  overall_state: LifecycleState;
  blocking_reasons: LifecycleBlockingReason[];
  warnings: LifecycleWarning[];
  recommended_next_actions: LifecycleNextAction[];
  rollback_available: boolean;
  rollback_candidate_id: string | null;
  current_candidate_id: string | null;
  latest_approved_candidate_id: string | null;
  latest_rejected_candidate_id: string | null;
  version_line: string[];
  timeline_summary: {
    events: number;
    last_event_type: LifecycleEventType | null;
    last_event_at_reference: string | null;
  };
  risk_level: LifecycleRiskLevel;
}
