/**
 * REVIEW.READY.GATE.OS.1 — Pure Deterministic Gate
 *
 * Computes ReviewProjection from ReviewInput.
 * No DB, no HTTP, no clock, no RNG.
 */
import type {
  ReviewInput,
  ReviewProjection,
  ReviewBlocker,
  ReviewWarning,
  NextAction,
  Platform,
  ReviewState,
} from "./contracts";
import { SCORE_WEIGHTS, REQUIRED_SCREENSHOTS_PER_PLATFORM, PLATFORMS } from "./rules";

function findListing(input: ReviewInput, p: Platform) {
  return input.listings.find((l) => l.platform === p) ?? null;
}
function findBuild(input: ReviewInput, p: Platform) {
  return input.builds.find((b) => b.platform === p) ?? null;
}
function findShots(input: ReviewInput, p: Platform) {
  return input.screenshots.find((s) => s.platform === p) ?? null;
}

export function evaluateReviewGate(input: ReviewInput): ReviewProjection {
  const blockers: ReviewBlocker[] = [];
  const warnings: ReviewWarning[] = [];
  const next_actions: NextAction[] = [];

  // ── Manifest ─────────────────────────────────────────────────────────
  const m = input.manifest;
  let manifestScore = 0;
  if (!m.complete || !m.manifest_id) {
    blockers.push({ code: "MANIFEST_INCOMPLETE", platform: "both", message: "Mobile-Manifest unvollständig." });
    next_actions.push({ action: "complete_manifest", reason: "Manifest fehlende Pflichtfelder." });
  } else {
    manifestScore = SCORE_WEIGHTS.manifest;
    if (!m.product_id) blockers.push({ code: "UNKNOWN_PRODUCT", message: "Kein verknüpftes Produkt." });
    if (!m.curriculum_id) blockers.push({ code: "UNKNOWN_CURRICULUM", message: "Keine verknüpfte Curriculum-ID." });
    if (!m.sku) blockers.push({ code: "UNKNOWN_SKU", message: "Kein SKU am Manifest." });
    if (!m.privacy_url) {
      blockers.push({ code: "PRIVACY_URL_MISSING", message: "Privacy-URL fehlt." });
      next_actions.push({ action: "add_privacy_url", reason: "Privacy-URL pflicht für Store-Review." });
    }
    if (!m.support_url) {
      blockers.push({ code: "SUPPORT_URL_MISSING", message: "Support-URL fehlt." });
      next_actions.push({ action: "add_support_url", reason: "Support-URL pflicht für Store-Review." });
    }
  }

  // ── Listings ─────────────────────────────────────────────────────────
  let listingScore = 0;
  let listingHash: string | null = null;
  for (const p of PLATFORMS) {
    const l = findListing(input, p);
    if (!l || l.status !== "approved") {
      blockers.push({
        code: "LISTING_NOT_APPROVED",
        platform: p,
        message: `${p}-Listing nicht approved (status=${l?.status ?? "missing"}).`,
      });
      next_actions.push({
        action: l?.status === "review_ready" ? "approve_listing" : "generate_listing",
        platform: p,
        reason: `${p}-Listing fehlt oder unfertig.`,
      });
    } else {
      listingScore += SCORE_WEIGHTS.listing / 2;
      if (l.hash) listingHash = listingHash ? `${listingHash}|${l.hash}` : l.hash;
    }
  }

  // ── Screenshots ──────────────────────────────────────────────────────
  let shotsScore = 0;
  for (const p of PLATFORMS) {
    const s = findShots(input, p);
    const required = s?.required_count ?? REQUIRED_SCREENSHOTS_PER_PLATFORM;
    if (!s || s.ready_count < required) {
      blockers.push({
        code: "SCREENSHOTS_MISSING",
        platform: p,
        message: `${p}: ${s?.ready_count ?? 0}/${required} Screenshots bereit.`,
      });
      next_actions.push({ action: "generate_screenshots", platform: p, reason: `${p} braucht Screenshots.` });
    } else {
      shotsScore += SCORE_WEIGHTS.screenshots / 2;
    }
  }

  // ── Builds ──────────────────────────────────────────────────────────
  let buildScore = 0;
  let buildHash: string | null = null;
  let androidBuildOk = false;
  let iosBuildOk = false;
  for (const p of PLATFORMS) {
    const b = findBuild(input, p);
    if (!b) {
      blockers.push({
        code: p === "android" ? "NO_ANDROID_BUILD" : "NO_IOS_BUILD",
        platform: p,
        message: `${p}: kein Build vorhanden.`,
      });
      next_actions.push({ action: "run_build", platform: p, reason: `${p}-Build fehlt.` });
      continue;
    }
    if (b.status === "failed") {
      blockers.push({ code: "UNKNOWN_BUILD", platform: p, message: `${p}-Build failed.` });
      next_actions.push({ action: "retry_build", platform: p, reason: `${p}-Build muss erneut laufen.` });
      continue;
    }
    if (b.status !== "success") {
      warnings.push({ code: "BUILD_NOT_SUCCESS", message: `${p}-Build status=${b.status}.` });
      continue;
    }
    if (b.dry_run) {
      warnings.push({ code: "BUILD_IS_DRYRUN", message: `${p}-Build ist Dry-Run.` });
    }
    buildScore += SCORE_WEIGHTS.build / 2;
    if (p === "android") androidBuildOk = !b.dry_run;
    if (p === "ios") iosBuildOk = !b.dry_run;
    if (b.build_hash) buildHash = buildHash ? `${buildHash}|${b.build_hash}` : b.build_hash;
  }

  // ── Package ──────────────────────────────────────────────────────────
  let packageScoreOk = true;
  if (!input.package.valid) {
    blockers.push({ code: "PACKAGE_INVALID", message: `Package invalid: ${input.package.errors.join(", ")}` });
    packageScoreOk = false;
  }
  if (m.hash && input.package.hash && m.hash !== input.package.hash) {
    blockers.push({ code: "HASH_MISMATCH", message: "Manifest-Hash ≠ Package-Hash." });
  }

  // ── Smoke ────────────────────────────────────────────────────────────
  let smokeScore = 0;
  if (!input.smoke.has_run) {
    blockers.push({ code: "NO_IAP_SMOKE", message: "IAP-Smoke wurde nie ausgeführt." });
    next_actions.push({ action: "run_smoke", reason: "IAP-Smoke fehlt." });
  } else if (!input.smoke.passed) {
    blockers.push({ code: "NO_IAP_SMOKE", message: "IAP-Smoke failed." });
    next_actions.push({ action: "run_smoke", reason: "IAP-Smoke fehlgeschlagen." });
  } else {
    smokeScore = SCORE_WEIGHTS.smoke;
  }

  // ── Tests ────────────────────────────────────────────────────────────
  let testScore = 0;
  if (!input.tests.guard_tests_passed || !input.tests.contract_tests_passed) {
    blockers.push({
      code: "TEST_FAILURE",
      message: `Tests fehlgeschlagen: ${input.tests.failures.join(", ") || "unknown"}`,
    });
    next_actions.push({ action: "run_tests", reason: "Guard- oder Contract-Tests rot." });
  } else {
    testScore = SCORE_WEIGHTS.tests;
  }

  // ── Guards ───────────────────────────────────────────────────────────
  let guardsScore = SCORE_WEIGHTS.guards;
  if (input.guards.known_secret_found) {
    blockers.push({ code: "KNOWN_SECRET", message: "Secret im Package gefunden." });
    next_actions.push({ action: "fix_guards", reason: "Secret entfernen." });
    guardsScore = 0;
  }
  if (input.guards.admin_route_found) {
    blockers.push({ code: "ADMIN_ROUTE_FOUND", message: "Admin-Route im Package." });
    next_actions.push({ action: "fix_guards", reason: "Admin-Routen entfernen." });
    guardsScore = 0;
  }
  if (input.guards.shadow_unlock_found) {
    blockers.push({ code: "SHADOW_UNLOCK_FOUND", message: "Shadow-Unlock-Pfad gefunden." });
    next_actions.push({ action: "fix_guards", reason: "Shadow-Unlock entfernen." });
    guardsScore = 0;
  }

  // ── Known Limitations ────────────────────────────────────────────────
  let limitsScore = SCORE_WEIGHTS.known_limitations;
  if (!input.known_limitations.lifecycle_implemented) {
    blockers.push({ code: "LIFECYCLE_NOT_IMPLEMENTED", message: "IAP-Lifecycle nicht implementiert." });
    limitsScore = 0;
  }
  if (!input.known_limitations.iap_dispatcher_present) {
    warnings.push({ code: "IAP_DISPATCHER_MISSING", message: "IAP-Dispatcher nicht referenziert." });
    limitsScore = Math.max(0, limitsScore - 2);
  }

  // ── Governance score (cap on having identity + hash chain) ───────────
  let governanceScore = SCORE_WEIGHTS.governance;
  if (!packageScoreOk) governanceScore = 0;

  // ── Aggregate score ─────────────────────────────────────────────────
  const review_score =
    manifestScore +
    listingScore +
    shotsScore +
    buildScore +
    smokeScore +
    testScore +
    guardsScore +
    governanceScore +
    limitsScore;

  // ── State machine ────────────────────────────────────────────────────
  const hardBlockerCodes = new Set([
    "KNOWN_SECRET",
    "ADMIN_ROUTE_FOUND",
    "SHADOW_UNLOCK_FOUND",
    "HASH_MISMATCH",
    "PACKAGE_INVALID",
    "LIFECYCLE_NOT_IMPLEMENTED",
  ]);
  const hasHardBlock = blockers.some((b) => hardBlockerCodes.has(b.code));
  const hasAnyBuildFailed = blockers.some((b) => b.code === "UNKNOWN_BUILD");
  const hasBuildMissing = blockers.some((b) => b.code === "NO_ANDROID_BUILD" || b.code === "NO_IOS_BUILD");
  const hasAssetGap = blockers.some(
    (b) =>
      b.code === "SCREENSHOTS_MISSING" ||
      b.code === "LISTING_NOT_APPROVED" ||
      b.code === "PRIVACY_URL_MISSING" ||
      b.code === "SUPPORT_URL_MISSING" ||
      b.code === "MANIFEST_INCOMPLETE",
  );
  const hasTestOrSmokeFail = blockers.some((b) => b.code === "TEST_FAILURE" || b.code === "NO_IAP_SMOKE");

  let review_state: ReviewState;
  if (hasHardBlock) review_state = "blocked";
  else if (hasAnyBuildFailed) review_state = "build_failed";
  else if (hasBuildMissing) review_state = "building";
  else if (hasAssetGap) review_state = "missing_assets";
  else if (hasTestOrSmokeFail) review_state = "qa_required";
  else if (blockers.length === 0 && review_score >= 95) review_state = "review_ready";
  else review_state = "draft";

  const approved_platforms: Platform[] = [];
  if (review_state === "review_ready" && androidBuildOk) approved_platforms.push("android");
  if (review_state === "review_ready" && iosBuildOk) approved_platforms.push("ios");

  return {
    review_state,
    review_score,
    blockers,
    warnings,
    next_actions,
    approved_platforms,
    android_ready: approved_platforms.includes("android"),
    ios_ready: approved_platforms.includes("ios"),
    package_hash: input.package.hash,
    manifest_hash: m.hash,
    listing_hash: listingHash,
    build_hash: buildHash,
    generated_at: input.evaluated_at,
  };
}
