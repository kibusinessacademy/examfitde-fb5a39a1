/**
 * STORE.OPS.BATCH.OS.1 — Pure Contracts
 *
 * Hard rules:
 *  - No DB. No HTTP. No clock. No RNG. No fetch.
 *  - This layer NEVER publishes, NEVER submits, NEVER calls Store APIs.
 *  - Only orchestrates SAFE follow-up actions across many manifests.
 */

export type BatchState =
  | "draft"
  | "planned"
  | "running"
  | "partially_completed"
  | "completed"
  | "blocked"
  | "cancelled";

/** Allowed safe actions only. Publish / submit / rollout are forbidden by policy. */
export type BatchActionType =
  | "generate_listing"
  | "enqueue_screenshots"
  | "run_android_dry_build"
  | "run_ios_dry_build"
  | "run_review_gate"
  | "run_kpi_snapshot"
  | "create_release_candidate"
  | "evaluate_lifecycle"
  | "export_submission_package";

export const ALLOWED_BATCH_ACTIONS: readonly BatchActionType[] = [
  "generate_listing",
  "enqueue_screenshots",
  "run_android_dry_build",
  "run_ios_dry_build",
  "run_review_gate",
  "run_kpi_snapshot",
  "create_release_candidate",
  "evaluate_lifecycle",
  "export_submission_package",
] as const;

export const FORBIDDEN_BATCH_ACTIONS = [
  "publish",
  "submit_for_review",
  "production_rollout",
  "store_release",
  "iap_change",
  "entitlement_change",
] as const;

export type BatchItemStatus =
  | "skipped"
  | "planned"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked";

export type BatchBlockerCode =
  | "MANIFEST_INCOMPLETE"
  | "LIFECYCLE_BLOCKED"
  | "REVIEW_GATE_BLOCKED"
  | "BUILD_FAILED"
  | "HASH_DRIFT"
  | "ACTION_NOT_APPLICABLE"
  | "DEPENDENCY_NOT_READY";

export interface BatchBlocker {
  code: BatchBlockerCode;
  message: string;
}

export interface ManifestSnapshotInput {
  manifest_id: string;
  complete: boolean;
  has_privacy_url: boolean;
  has_support_url: boolean;
}

export interface ReviewGateSnapshot {
  manifest_id: string;
  review_state: string;
  android_ready: boolean;
  ios_ready: boolean;
  blocked: boolean;
}

export interface KpiSnapshotItem {
  manifest_id: string;
  risk_level: "low" | "medium" | "high" | "critical";
}

export interface LifecycleSnapshotItem {
  manifest_id: string;
  current_state: string;
  blocked: boolean;
}

export interface BuildSnapshotItem {
  manifest_id: string;
  platform: "android" | "ios";
  status: "queued" | "running" | "success" | "failed" | "manual_required" | null;
}

export interface BatchPlanInput {
  batch_id: string;
  manifest_ids: string[];
  selected_action_types: BatchActionType[];
  manifests: ManifestSnapshotInput[];
  review_gates: ReviewGateSnapshot[];
  kpi: KpiSnapshotItem[];
  lifecycle: LifecycleSnapshotItem[];
  builds: BuildSnapshotItem[];
  /** Deterministic reference timestamp (ISO). */
  planned_at_reference: string;
}

export interface BatchItem {
  manifest_id: string;
  action_type: BatchActionType;
  status: BatchItemStatus;
  blockers: BatchBlocker[];
}

export interface BatchPlan {
  batch_id: string;
  planned_at_reference: string;
  items: BatchItem[];
  skipped_action_types: BatchActionType[];
  warnings: string[];
}

export interface BatchExecutionItemResult {
  manifest_id: string;
  action_type: BatchActionType;
  status: BatchItemStatus;
  blockers?: BatchBlocker[];
}

export interface BatchProjection {
  batch_id: string;
  state: BatchState;
  items: BatchItem[];
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  blocked: number;
  generated_at_reference: string;
  warnings: string[];
}
