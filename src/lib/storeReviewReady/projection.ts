/**
 * REVIEW.READY.GATE.OS.1 — Projection helpers (pure)
 *
 * Convert raw DB rows into a normalized ReviewInput for evaluateReviewGate().
 */
import type {
  ReviewInput,
  ManifestInput,
  ListingInput,
  BuildInput,
  PackageInput,
  ScreenshotsInput,
  SmokeInput,
  TestsInput,
  GuardsInput,
  KnownLimitations,
  Platform,
} from "./contracts";

export interface RawProjectionInput {
  manifest_row: Record<string, unknown> | null;
  listing_rows: Array<Record<string, unknown>>;
  build_rows: Array<Record<string, unknown>>;
  screenshot_counts: Array<{ platform: Platform; ready: number; required?: number }>;
  package_valid: boolean;
  package_hash: string | null;
  package_errors: string[];
  smoke_passed: boolean | null;
  smoke_ran_at: string | null;
  tests_guard_passed: boolean;
  tests_contract_passed: boolean;
  test_failures: string[];
  guards_known_secret: boolean;
  guards_admin_route: boolean;
  guards_shadow_unlock: boolean;
  lifecycle_implemented: boolean;
  iap_dispatcher_present: boolean;
  evaluated_at: string;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

export function projectManifest(row: Record<string, unknown> | null): ManifestInput {
  if (!row) {
    return {
      manifest_id: null, course_id: null, curriculum_id: null, product_id: null,
      bundle_id: null, sku: null, version_name: null, privacy_url: null,
      support_url: null, hash: null, complete: false,
    };
  }
  const manifest_id = str(row.id);
  const bundle_id = str(row.bundle_id);
  const version_name = str(row.version_name);
  const complete = Boolean(manifest_id && bundle_id && version_name);
  return {
    manifest_id,
    course_id: str(row.course_id),
    curriculum_id: str(row.curriculum_id),
    product_id: str(row.product_id),
    bundle_id,
    sku: str(row.sku) ?? str(row.iap_sku),
    version_name,
    privacy_url: str(row.privacy_url),
    support_url: str(row.support_url),
    hash: str(row.manifest_hash) ?? str(row.hash),
    complete,
  };
}

export function projectListings(rows: Array<Record<string, unknown>>): ListingInput[] {
  return rows.map((r) => ({
    platform: ((str(r.platform) ?? "android") as Platform),
    status: (str(r.status) as ListingInput["status"]) ?? null,
    version: typeof r.version === "number" ? (r.version as number) : null,
    hash: str(r.content_hash) ?? str(r.hash),
  }));
}

export function projectBuilds(rows: Array<Record<string, unknown>>): BuildInput[] {
  return rows.map((r) => ({
    platform: ((str(r.platform) ?? "android") as Platform),
    status: (str(r.status) as BuildInput["status"]) ?? null,
    artifact_url: str(r.artifact_url),
    build_hash: str(r.metadata_hash) ?? str(r.build_hash),
    stage: str(r.stage),
    dry_run: Boolean(r.dry_run),
  }));
}

export function projectInput(raw: RawProjectionInput): ReviewInput {
  const screenshots: ScreenshotsInput[] = raw.screenshot_counts.map((s) => ({
    platform: s.platform,
    ready_count: s.ready,
    required_count: s.required ?? 3,
  }));
  const pkg: PackageInput = {
    valid: raw.package_valid,
    hash: raw.package_hash,
    errors: raw.package_errors,
  };
  const smoke: SmokeInput = {
    has_run: raw.smoke_passed !== null,
    passed: raw.smoke_passed === true,
    ran_at: raw.smoke_ran_at,
  };
  const tests: TestsInput = {
    guard_tests_passed: raw.tests_guard_passed,
    contract_tests_passed: raw.tests_contract_passed,
    failures: raw.test_failures,
  };
  const guards: GuardsInput = {
    known_secret_found: raw.guards_known_secret,
    admin_route_found: raw.guards_admin_route,
    shadow_unlock_found: raw.guards_shadow_unlock,
  };
  const known_limitations: KnownLimitations = {
    lifecycle_implemented: raw.lifecycle_implemented,
    iap_dispatcher_present: raw.iap_dispatcher_present,
  };
  return {
    manifest: projectManifest(raw.manifest_row),
    listings: projectListings(raw.listing_rows),
    builds: projectBuilds(raw.build_rows),
    package: pkg,
    screenshots,
    smoke,
    tests,
    guards,
    known_limitations,
    evaluated_at: raw.evaluated_at,
  };
}
