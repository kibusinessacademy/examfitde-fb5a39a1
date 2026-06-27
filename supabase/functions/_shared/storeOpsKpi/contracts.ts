/**
 * STORE.OPS.KPI.OS.1 — Pure contracts
 *
 * Hard rules:
 *  - No DB. No HTTP. No clock. No RNG. No fetch.
 *  - This layer NEVER publishes, NEVER submits, NEVER calls Store APIs.
 *  - It aggregates existing StoreOps data into operational KPIs.
 */

export type Platform = "android" | "ios";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export type BottleneckKind =
  | "listing_bottleneck"
  | "screenshot_bottleneck"
  | "build_bottleneck"
  | "review_gate_bottleneck"
  | "lifecycle_bottleneck"
  | "rejection_bottleneck"
  | "stale_candidate_bottleneck";

export type RecommendedActionKind =
  | "generate_listing"
  | "generate_screenshots"
  | "fix_build"
  | "complete_manifest"
  | "address_review_blocker"
  | "resolve_lifecycle_block"
  | "respond_to_rejection"
  | "refresh_stale_candidate";

export interface ManifestInput {
  manifest_id: string;
  has_privacy_url: boolean;
  has_support_url: boolean;
  complete: boolean;
}

export interface BuildInput {
  manifest_id: string;
  platform: Platform;
  status: "queued" | "running" | "success" | "failed" | "manual_required" | null;
}

export interface ListingInput {
  manifest_id: string;
  platform: Platform;
  status: "draft" | "review_ready" | "approved" | "rejected" | null;
}

export interface ScreenshotInput {
  manifest_id: string;
  platform: Platform;
  ready_count: number;
  required_count: number;
}

export interface ReviewGateInput {
  manifest_id: string;
  review_state: string;
  review_score: number;
  android_ready: boolean;
  ios_ready: boolean;
  blockers: Array<{ code: string; message?: string }>;
}

export interface CandidateInput {
  candidate_id: string;
  manifest_id: string;
  status: string;
  manifest_hash: string | null;
  listing_hash: string | null;
  package_hash: string | null;
  build_hash: string | null;
  created_at_reference: string;
  invalidated: boolean;
}

export interface LifecycleEventInput {
  manifest_id: string;
  candidate_id: string;
  event_type: string;
  to_state: string;
  occurred_at_reference: string;
}

export interface LifecycleFeedbackInput {
  manifest_id: string;
  store_feedback_type: string;
  store_feedback_status: string;
  reason_code: string | null;
}

export interface KnownLimitationsInput {
  lifecycle_implemented: boolean;
  iap_dispatcher_present: boolean;
}

export interface StoreOpsInput {
  manifests: ManifestInput[];
  builds: BuildInput[];
  listings: ListingInput[];
  screenshots: ScreenshotInput[];
  review_gates: ReviewGateInput[];
  candidates: CandidateInput[];
  lifecycle_events: LifecycleEventInput[];
  lifecycle_feedback: LifecycleFeedbackInput[];
  known_limitations: KnownLimitationsInput;
  /** Deterministic reference time (ISO). Used to compute stale candidates. */
  evaluated_at_reference: string;
  /** Threshold in days after which an open candidate is considered stale. */
  stale_after_days?: number;
}

export interface Bottleneck {
  kind: BottleneckKind;
  severity: RiskLevel;
  affected_count: number;
  affected_manifest_ids: string[];
  recommended_action: RecommendedActionKind;
}

export interface RecommendedAction {
  action: RecommendedActionKind;
  reason: string;
  affected_manifest_ids: string[];
}

export interface KpiSummary {
  total_manifests: number;
  review_ready_count: number;
  blocked_count: number;
  approved_count: number;
  rejected_count: number;
  build_success_rate: number;
  android_ready_count: number;
  ios_ready_count: number;
  missing_screenshots_count: number;
  missing_listing_count: number;
  missing_privacy_count: number;
  missing_support_count: number;
  average_review_score: number;
  candidate_invalidated_count: number;
  rollback_available_count: number;
  lifecycle_blocked_count: number;
  stale_candidates_count: number;
}

export interface PlatformSplit {
  android: { listings_ready: number; builds_ok: number; screenshots_ok: number };
  ios: { listings_ready: number; builds_ok: number; screenshots_ok: number };
}

export interface RiskDistribution {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface StoreOpsKpiProjection {
  summary: KpiSummary;
  platform_split: PlatformSplit;
  risk_distribution: RiskDistribution;
  bottlenecks: Bottleneck[];
  top_blockers: Array<{ code: string; count: number }>;
  top_rejection_reasons: Array<{ reason: string; count: number }>;
  recommended_actions: RecommendedAction[];
  warnings: string[];
  health_score: number;
  generated_at_reference: string;
}
