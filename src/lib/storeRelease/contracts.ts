/**
 * STORE.PUBLISH.ORCHESTRATION.OS.1 — Pure Contracts
 *
 * Deterministic SSOT for Store Release orchestration.
 * No DB. No HTTP. No clock. No RNG. No fetch.
 *
 * Hard rule: this module never publishes, never submits, never rolls out.
 * Humans approve. The system orchestrates.
 */

export type ReleaseState =
  | "draft"
  | "candidate"
  | "review_ready"
  | "approved_for_submission"
  | "submitted_external"
  | "waiting_review"
  | "approved_store"
  | "rejected"
  | "cancelled"
  | "retired"
  | "released";

export type ReleaseTimelineEventType =
  | "created"
  | "review_completed"
  | "candidate_created"
  | "candidate_invalidated"
  | "approved"
  | "submission_started"
  | "submission_cancelled"
  | "store_feedback_received"
  | "rejected"
  | "archived";

export interface ReleaseCandidate {
  manifest_id: string;
  product_id: string | null;
  curriculum_id: string | null;
  course_id: string | null;
  version: string;
  build_number: string | null;
  package_hash: string | null;
  listing_hash: string | null;
  review_gate_version: string | null;
  android_build_reference: string | null;
  ios_build_reference: string | null;
  smoke_version: string | null;
  created_at_reference: string;
}

export interface ReleasePolicyInput {
  /** review_ready means review-gate state === "review_ready" */
  review_ready: boolean;
  build_current: boolean;
  hashes_current: boolean;
  manifest_current: boolean;
  listings_current: boolean;
  smoke_current: boolean;
  tests_current: boolean;
  known_limitations_accepted: boolean;
}

export type ReleasePolicyBlockerCode =
  | "REVIEW_NOT_READY"
  | "BUILD_STALE"
  | "HASH_DRIFT"
  | "MANIFEST_STALE"
  | "LISTINGS_STALE"
  | "SMOKE_STALE"
  | "TESTS_STALE"
  | "KNOWN_LIMITATIONS_OPEN";

export interface ReleasePolicyDecision {
  approved_for_submission: boolean;
  blockers: ReleasePolicyBlockerCode[];
}

export interface ReleaseTimelineEvent {
  event: ReleaseTimelineEventType;
  /** caller-supplied deterministic timestamp; gate never reads clock */
  occurred_at: string;
  actor_id: string | null;
  note: string | null;
  payload: Record<string, unknown>;
}

export interface ReleaseHashes {
  manifest_hash: string | null;
  listing_hash: string | null;
  package_hash: string | null;
  build_hash: string | null;
  review_hash: string | null;
  smoke_hash: string | null;
}

export interface ReleaseProjection {
  state: ReleaseState;
  candidate: ReleaseCandidate | null;
  policy: ReleasePolicyDecision;
  hashes: ReleaseHashes;
  invalidated_reason: string | null;
  next_actions: ReleaseNextAction[];
}

export type ReleaseNextAction =
  | "create_candidate"
  | "invalidate_candidate"
  | "approve_for_submission"
  | "export_submission_package"
  | "await_human_review";
