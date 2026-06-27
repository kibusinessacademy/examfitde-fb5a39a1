/**
 * REVIEW.READY.GATE.OS.1 — Pure Contracts
 *
 * Deterministic SSOT for Store Review Readiness.
 * No DB. No HTTP. No clock. No RNG. No fetch.
 */

export type ReviewState =
  | "draft"
  | "missing_assets"
  | "building"
  | "build_failed"
  | "qa_required"
  | "review_ready"
  | "blocked"
  | "released";

export type ReviewBlockerCode =
  | "MANIFEST_INCOMPLETE"
  | "NO_ANDROID_BUILD"
  | "NO_IOS_BUILD"
  | "PACKAGE_INVALID"
  | "LISTING_NOT_APPROVED"
  | "SCREENSHOTS_MISSING"
  | "PRIVACY_URL_MISSING"
  | "SUPPORT_URL_MISSING"
  | "NO_IAP_SMOKE"
  | "TEST_FAILURE"
  | "KNOWN_SECRET"
  | "ADMIN_ROUTE_FOUND"
  | "SHADOW_UNLOCK_FOUND"
  | "UNKNOWN_PRODUCT"
  | "UNKNOWN_CURRICULUM"
  | "UNKNOWN_SKU"
  | "HASH_MISMATCH"
  | "UNKNOWN_BUILD"
  | "LIFECYCLE_NOT_IMPLEMENTED";

export type Platform = "android" | "ios";

export interface ReviewBlocker {
  code: ReviewBlockerCode;
  platform?: Platform | "both";
  message: string;
}

export interface ReviewWarning {
  code: string;
  message: string;
}

export interface NextAction {
  action:
    | "generate_listing"
    | "generate_screenshots"
    | "run_build"
    | "run_smoke"
    | "run_tests"
    | "fix_guards"
    | "approve_listing"
    | "retry_build"
    | "complete_manifest"
    | "add_privacy_url"
    | "add_support_url";
  platform?: Platform;
  reason: string;
}

export interface ManifestInput {
  manifest_id: string | null;
  course_id: string | null;
  curriculum_id: string | null;
  product_id: string | null;
  bundle_id: string | null;
  sku: string | null;
  version_name: string | null;
  privacy_url: string | null;
  support_url: string | null;
  hash: string | null;
  complete: boolean;
}

export interface ListingInput {
  platform: Platform;
  status: "draft" | "review_ready" | "approved" | "rejected" | null;
  version: number | null;
  hash: string | null;
}

export interface BuildInput {
  platform: Platform;
  status: "queued" | "running" | "success" | "failed" | "manual_required" | null;
  artifact_url: string | null;
  build_hash: string | null;
  stage: string | null;
  dry_run: boolean;
}

export interface PackageInput {
  valid: boolean;
  hash: string | null;
  errors: string[];
}

export interface ScreenshotsInput {
  platform: Platform;
  ready_count: number;
  required_count: number;
}

export interface SmokeInput {
  has_run: boolean;
  passed: boolean;
  ran_at: string | null;
}

export interface TestsInput {
  guard_tests_passed: boolean;
  contract_tests_passed: boolean;
  failures: string[];
}

export interface GuardsInput {
  known_secret_found: boolean;
  admin_route_found: boolean;
  shadow_unlock_found: boolean;
}

export interface KnownLimitations {
  lifecycle_implemented: boolean;
  iap_dispatcher_present: boolean;
}

export interface ReviewInput {
  manifest: ManifestInput;
  listings: ListingInput[];
  builds: BuildInput[];
  package: PackageInput;
  screenshots: ScreenshotsInput[];
  smoke: SmokeInput;
  tests: TestsInput;
  guards: GuardsInput;
  known_limitations: KnownLimitations;
  /** Deterministic timestamp injected by caller — gate itself does not read clock */
  evaluated_at: string;
}

export interface ReviewProjection {
  review_state: ReviewState;
  review_score: number;
  blockers: ReviewBlocker[];
  warnings: ReviewWarning[];
  next_actions: NextAction[];
  approved_platforms: Platform[];
  android_ready: boolean;
  ios_ready: boolean;
  package_hash: string | null;
  manifest_hash: string | null;
  listing_hash: string | null;
  build_hash: string | null;
  generated_at: string;
}
