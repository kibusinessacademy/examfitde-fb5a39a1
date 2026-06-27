/**
 * STORE.OPS.AUTOPILOT.OS.1 — Pure Contracts
 *
 * Hard rules:
 *  - No DB. No HTTP. No clock. No RNG. No fetch.
 *  - NEVER publishes, NEVER submits, NEVER rolls out, NEVER touches IAP/entitlements.
 *  - Only orchestrates an allow-list of safe operator actions.
 */

export type AutopilotMode = "disabled" | "recommend_only" | "safe_execute" | "maintenance";

export type AutopilotActionType =
  | "run_review_gate"
  | "run_store_ops_kpi"
  | "run_lifecycle_projection"
  | "generate_listing"
  | "enqueue_screenshots"
  | "run_android_dry_build"
  | "run_ios_dry_build"
  | "create_release_candidate"
  | "export_submission_package"
  | "cleanup_stale_candidates"
  | "refresh_hashes"
  | "refresh_projection";

export const ALLOWED_AUTOPILOT_ACTIONS: readonly AutopilotActionType[] = [
  "run_review_gate",
  "run_store_ops_kpi",
  "run_lifecycle_projection",
  "generate_listing",
  "enqueue_screenshots",
  "run_android_dry_build",
  "run_ios_dry_build",
  "create_release_candidate",
  "export_submission_package",
  "cleanup_stale_candidates",
  "refresh_hashes",
  "refresh_projection",
] as const;

export const FORBIDDEN_AUTOPILOT_ACTIONS = [
  "publish",
  "submit_review",
  "production_rollout",
  "iap_change",
  "entitlement_change",
  "manual_feedback",
] as const;

/** Actions that never require Review-Ready / can run any time. */
export const ALWAYS_SAFE_ACTIONS: readonly AutopilotActionType[] = [
  "run_review_gate",
  "run_store_ops_kpi",
  "run_lifecycle_projection",
  "refresh_projection",
] as const;

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AutopilotActionStatus =
  | "planned"
  | "safe"
  | "manual_required"
  | "blocked"
  | "skipped"
  | "succeeded"
  | "failed";

export type AutopilotBlockerCode =
  | "MODE_DISABLED"
  | "FORBIDDEN_ACTION"
  | "REVIEW_NOT_READY"
  | "HASH_MISMATCH"
  | "MISSING_BUILD"
  | "MISSING_LISTING"
  | "MISSING_SCREENSHOTS"
  | "LIFECYCLE_ERROR"
  | "BATCH_ERROR"
  | "ACTION_NOT_APPLICABLE";

export interface AutopilotBlocker {
  code: AutopilotBlockerCode;
  message: string;
}

export interface ManifestSnapshot {
  manifest_id: string;
  complete: boolean;
  has_privacy_url: boolean;
  has_support_url: boolean;
}

export interface ReviewGateSnapshot {
  manifest_id: string;
  review_state: string;
  review_ready: boolean;
  android_ready: boolean;
  ios_ready: boolean;
  blocker_count: number;
}

export interface ReleaseCandidateSnapshot {
  candidate_id: string;
  manifest_id: string;
  status: string;
  invalidated: boolean;
  manifest_hash: string | null;
  listing_hash: string | null;
  package_hash: string | null;
  build_hash: string | null;
  created_at_reference: string;
}

export interface LifecycleSnapshot {
  manifest_id: string;
  current_state: string;
  has_error: boolean;
}

export interface BuildSnapshot {
  manifest_id: string;
  platform: "android" | "ios";
  status: "queued" | "running" | "success" | "failed" | "manual_required" | null;
}

export interface ListingSnapshot {
  manifest_id: string;
  platform: "android" | "ios";
  status: "draft" | "review_ready" | "approved" | "rejected" | null;
}

export interface ScreenshotSnapshot {
  manifest_id: string;
  platform: "android" | "ios";
  ready_count: number;
  required_count: number;
}

export interface KpiSnapshot {
  manifest_id: string;
  risk_level: RiskLevel;
}

export interface BatchStatusSnapshot {
  manifest_id: string;
  has_open_failures: boolean;
}

export interface HashDriftSnapshot {
  manifest_id: string;
  drifted: boolean;
}

export interface KnownLimitations {
  lifecycle_implemented: boolean;
  iap_dispatcher_present: boolean;
}

export interface AutopilotInput {
  run_id: string;
  mode: AutopilotMode;
  requested_actions: AutopilotActionType[] | "auto";
  manifests: ManifestSnapshot[];
  review_gates: ReviewGateSnapshot[];
  candidates: ReleaseCandidateSnapshot[];
  lifecycle: LifecycleSnapshot[];
  builds: BuildSnapshot[];
  listings: ListingSnapshot[];
  screenshots: ScreenshotSnapshot[];
  kpi: KpiSnapshot[];
  batch_status: BatchStatusSnapshot[];
  hash_drift: HashDriftSnapshot[];
  known_limitations: KnownLimitations;
  /** Deterministic reference ISO timestamp. */
  evaluated_at_reference: string;
  /** Days after which open candidates are stale. */
  stale_after_days?: number;
}

export interface AutopilotAction {
  manifest_id: string;
  action_type: AutopilotActionType;
  status: AutopilotActionStatus;
  blockers: AutopilotBlocker[];
  estimated_runtime_seconds: number;
}

export interface AutopilotPlan {
  run_id: string;
  mode: AutopilotMode;
  evaluated_at_reference: string;
  safe_actions: AutopilotAction[];
  manual_actions: AutopilotAction[];
  blocked_actions: AutopilotAction[];
  risk_score: number;
  risk_level: RiskLevel;
  estimated_runtime_seconds: number;
  recommended_sequence: AutopilotActionType[];
  next_manual_step: string | null;
  warnings: string[];
}

export interface AutopilotExecutionResult {
  manifest_id: string;
  action_type: AutopilotActionType;
  status: "succeeded" | "failed" | "skipped" | "blocked";
  message?: string;
}

export interface AutopilotProjection {
  run_id: string;
  mode: AutopilotMode;
  state: "planned" | "running" | "completed" | "partially_completed" | "blocked" | "cancelled";
  total: number;
  succeeded: number;
  failed: number;
  blocked: number;
  skipped: number;
  risk_score: number;
  risk_level: RiskLevel;
  generated_at_reference: string;
}
