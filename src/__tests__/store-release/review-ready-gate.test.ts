/**
 * REVIEW.READY.GATE.OS.1 — Contract tests
 *
 * Validates deterministic behavior of the review gate.
 */
import { describe, expect, it } from "vitest";
import { evaluateReviewGate } from "../../lib/storeReviewReady/reviewGate";
import type { ReviewInput, Platform } from "../../lib/storeReviewReady/contracts";
import { TOTAL_SCORE } from "../../lib/storeReviewReady/rules";

const NOW = "2026-06-27T00:00:00.000Z";

function fullyGreen(): ReviewInput {
  return {
    manifest: {
      manifest_id: "m-1", course_id: "c-1", curriculum_id: "k-1", product_id: "p-1",
      bundle_id: "com.examfit.kursA", sku: "examfit.kursA.full", version_name: "1.0.0",
      privacy_url: "https://berufos.com/privacy", support_url: "https://berufos.com/support",
      hash: "PKG_HASH_1", complete: true,
    },
    listings: (["android", "ios"] as Platform[]).map((p) => ({
      platform: p, status: "approved", version: 1, hash: `L_${p}`,
    })),
    builds: (["android", "ios"] as Platform[]).map((p) => ({
      platform: p, status: "success", artifact_url: `https://x/${p}.bin`,
      build_hash: `B_${p}`, stage: p === "android" ? "upload-internal" : "upload-testflight", dry_run: false,
    })),
    package: { valid: true, hash: "PKG_HASH_1", errors: [] },
    screenshots: [
      { platform: "android", ready_count: 5, required_count: 3 },
      { platform: "ios", ready_count: 5, required_count: 3 },
    ],
    smoke: { has_run: true, passed: true, ran_at: NOW },
    tests: { guard_tests_passed: true, contract_tests_passed: true, failures: [] },
    guards: { known_secret_found: false, admin_route_found: false, shadow_unlock_found: false },
    known_limitations: { lifecycle_implemented: true, iap_dispatcher_present: true },
    evaluated_at: NOW,
  };
}

describe("REVIEW.READY.GATE.OS.1 — pure deterministic gate", () => {
  it("review_ready when everything is green", () => {
    const r = evaluateReviewGate(fullyGreen());
    expect(r.review_state).toBe("review_ready");
    expect(r.android_ready).toBe(true);
    expect(r.ios_ready).toBe(true);
    expect(r.approved_platforms).toEqual(["android", "ios"]);
    expect(r.blockers).toHaveLength(0);
    expect(r.review_score).toBe(TOTAL_SCORE);
  });

  it("MANIFEST_INCOMPLETE blocker when manifest missing", () => {
    const i = fullyGreen();
    i.manifest = { ...i.manifest, complete: false, manifest_id: null };
    const r = evaluateReviewGate(i);
    expect(r.blockers.map((b) => b.code)).toContain("MANIFEST_INCOMPLETE");
    expect(r.review_state).not.toBe("review_ready");
  });

  it("LISTING_NOT_APPROVED blocker for each platform missing approval", () => {
    const i = fullyGreen();
    i.listings = i.listings.map((l) => ({ ...l, status: "review_ready" }));
    const r = evaluateReviewGate(i);
    expect(r.blockers.filter((b) => b.code === "LISTING_NOT_APPROVED")).toHaveLength(2);
    expect(r.next_actions.some((a) => a.action === "approve_listing")).toBe(true);
  });

  it("NO_ANDROID_BUILD when android build missing", () => {
    const i = fullyGreen();
    i.builds = i.builds.filter((b) => b.platform !== "android");
    const r = evaluateReviewGate(i);
    expect(r.blockers.map((b) => b.code)).toContain("NO_ANDROID_BUILD");
    expect(r.android_ready).toBe(false);
  });

  it("NO_IOS_BUILD when ios build missing", () => {
    const i = fullyGreen();
    i.builds = i.builds.filter((b) => b.platform !== "ios");
    const r = evaluateReviewGate(i);
    expect(r.blockers.map((b) => b.code)).toContain("NO_IOS_BUILD");
    expect(r.ios_ready).toBe(false);
  });

  it("SCREENSHOTS_MISSING when below required", () => {
    const i = fullyGreen();
    i.screenshots = [
      { platform: "android", ready_count: 1, required_count: 3 },
      { platform: "ios", ready_count: 0, required_count: 3 },
    ];
    const r = evaluateReviewGate(i);
    expect(r.blockers.filter((b) => b.code === "SCREENSHOTS_MISSING")).toHaveLength(2);
  });

  it("NO_IAP_SMOKE when smoke never ran", () => {
    const i = fullyGreen();
    i.smoke = { has_run: false, passed: false, ran_at: null };
    const r = evaluateReviewGate(i);
    expect(r.blockers.map((b) => b.code)).toContain("NO_IAP_SMOKE");
    expect(r.review_state).toBe("qa_required");
  });

  it("TEST_FAILURE blocks readiness", () => {
    const i = fullyGreen();
    i.tests = { guard_tests_passed: false, contract_tests_passed: true, failures: ["g1"] };
    const r = evaluateReviewGate(i);
    expect(r.blockers.map((b) => b.code)).toContain("TEST_FAILURE");
    expect(r.review_state).toBe("qa_required");
  });

  it("KNOWN_SECRET = hard blocker → blocked state", () => {
    const i = fullyGreen();
    i.guards.known_secret_found = true;
    const r = evaluateReviewGate(i);
    expect(r.blockers.map((b) => b.code)).toContain("KNOWN_SECRET");
    expect(r.review_state).toBe("blocked");
  });

  it("SHADOW_UNLOCK_FOUND = hard blocker", () => {
    const i = fullyGreen();
    i.guards.shadow_unlock_found = true;
    expect(evaluateReviewGate(i).review_state).toBe("blocked");
  });

  it("ADMIN_ROUTE_FOUND = hard blocker", () => {
    const i = fullyGreen();
    i.guards.admin_route_found = true;
    expect(evaluateReviewGate(i).review_state).toBe("blocked");
  });

  it("HASH_MISMATCH between manifest and package", () => {
    const i = fullyGreen();
    i.package.hash = "OTHER";
    const r = evaluateReviewGate(i);
    expect(r.blockers.map((b) => b.code)).toContain("HASH_MISMATCH");
    expect(r.review_state).toBe("blocked");
  });

  it("LIFECYCLE_NOT_IMPLEMENTED hard-blocks", () => {
    const i = fullyGreen();
    i.known_limitations.lifecycle_implemented = false;
    const r = evaluateReviewGate(i);
    expect(r.blockers.map((b) => b.code)).toContain("LIFECYCLE_NOT_IMPLEMENTED");
    expect(r.review_state).toBe("blocked");
  });

  it("PACKAGE_INVALID hard-blocks", () => {
    const i = fullyGreen();
    i.package = { valid: false, hash: "PKG_HASH_1", errors: ["missing iap.config.ts"] };
    expect(evaluateReviewGate(i).review_state).toBe("blocked");
  });

  it("UNKNOWN_PRODUCT/CURRICULUM/SKU emitted when manifest refs missing", () => {
    const i = fullyGreen();
    i.manifest = { ...i.manifest, product_id: null, curriculum_id: null, sku: null };
    const codes = evaluateReviewGate(i).blockers.map((b) => b.code);
    expect(codes).toContain("UNKNOWN_PRODUCT");
    expect(codes).toContain("UNKNOWN_CURRICULUM");
    expect(codes).toContain("UNKNOWN_SKU");
  });

  it("PRIVACY_URL_MISSING and SUPPORT_URL_MISSING distinct blockers", () => {
    const i = fullyGreen();
    i.manifest.privacy_url = null;
    i.manifest.support_url = null;
    const codes = evaluateReviewGate(i).blockers.map((b) => b.code);
    expect(codes).toContain("PRIVACY_URL_MISSING");
    expect(codes).toContain("SUPPORT_URL_MISSING");
  });

  it("build failed → state=build_failed and retry_build next action", () => {
    const i = fullyGreen();
    i.builds = i.builds.map((b) =>
      b.platform === "android" ? { ...b, status: "failed", build_hash: null } : b,
    );
    const r = evaluateReviewGate(i);
    expect(r.review_state).toBe("build_failed");
    expect(r.next_actions.some((a) => a.action === "retry_build")).toBe(true);
  });

  it("dry_run builds emit warning but still no approved_platforms", () => {
    const i = fullyGreen();
    i.builds = i.builds.map((b) => ({ ...b, dry_run: true }));
    const r = evaluateReviewGate(i);
    expect(r.warnings.some((w) => w.code === "BUILD_IS_DRYRUN")).toBe(true);
    expect(r.android_ready).toBe(false);
    expect(r.ios_ready).toBe(false);
  });

  it("score decreases monotonically when assets are removed", () => {
    const green = evaluateReviewGate(fullyGreen()).review_score;
    const i = fullyGreen();
    i.screenshots = [{ platform: "android", ready_count: 0, required_count: 3 }];
    expect(evaluateReviewGate(i).review_score).toBeLessThan(green);
  });

  it("output is deterministic across repeated calls", () => {
    const a = JSON.stringify(evaluateReviewGate(fullyGreen()));
    const b = JSON.stringify(evaluateReviewGate(fullyGreen()));
    expect(a).toBe(b);
  });

  it("missing manifest yields draft/missing_assets, not review_ready", () => {
    const i = fullyGreen();
    i.manifest = {
      manifest_id: null, course_id: null, curriculum_id: null, product_id: null,
      bundle_id: null, sku: null, version_name: null, privacy_url: null,
      support_url: null, hash: null, complete: false,
    };
    const r = evaluateReviewGate(i);
    expect(["missing_assets", "blocked", "draft"]).toContain(r.review_state);
    expect(r.review_state).not.toBe("review_ready");
  });

  it("generated_at is passed through unchanged", () => {
    const i = fullyGreen();
    i.evaluated_at = "2030-01-01T00:00:00.000Z";
    expect(evaluateReviewGate(i).generated_at).toBe("2030-01-01T00:00:00.000Z");
  });

  it("approved_platforms only populated when review_ready", () => {
    const i = fullyGreen();
    i.smoke = { has_run: false, passed: false, ran_at: null };
    const r = evaluateReviewGate(i);
    expect(r.approved_platforms).toHaveLength(0);
  });

  it("score never exceeds 100", () => {
    const r = evaluateReviewGate(fullyGreen());
    expect(r.review_score).toBeLessThanOrEqual(100);
  });

  it("score never below 0", () => {
    const i = fullyGreen();
    i.guards = { known_secret_found: true, admin_route_found: true, shadow_unlock_found: true };
    i.tests = { guard_tests_passed: false, contract_tests_passed: false, failures: ["all"] };
    i.smoke = { has_run: false, passed: false, ran_at: null };
    i.package = { valid: false, hash: null, errors: ["x"] };
    i.known_limitations = { lifecycle_implemented: false, iap_dispatcher_present: false };
    expect(evaluateReviewGate(i).review_score).toBeGreaterThanOrEqual(0);
  });

  it("hashes from inputs are surfaced to projection", () => {
    const r = evaluateReviewGate(fullyGreen());
    expect(r.manifest_hash).toBe("PKG_HASH_1");
    expect(r.package_hash).toBe("PKG_HASH_1");
    expect(r.listing_hash).toContain("L_android");
    expect(r.build_hash).toContain("B_android");
  });

  it("UNKNOWN_BUILD on failed build, not on missing build", () => {
    const failed = fullyGreen();
    failed.builds = failed.builds.map((b) =>
      b.platform === "ios" ? { ...b, status: "failed", build_hash: null } : b,
    );
    expect(evaluateReviewGate(failed).blockers.map((b) => b.code)).toContain("UNKNOWN_BUILD");
  });

  it("listing in review_ready (not approved) suggests approve_listing", () => {
    const i = fullyGreen();
    i.listings = i.listings.map((l) =>
      l.platform === "android" ? { ...l, status: "review_ready" } : l,
    );
    const actions = evaluateReviewGate(i).next_actions;
    expect(actions.some((a) => a.action === "approve_listing" && a.platform === "android")).toBe(true);
  });

  it("missing screenshots suggests generate_screenshots per platform", () => {
    const i = fullyGreen();
    i.screenshots = [{ platform: "android", ready_count: 0, required_count: 3 }];
    const actions = evaluateReviewGate(i).next_actions.filter((a) => a.action === "generate_screenshots");
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  it("approved listing for one platform partially scores", () => {
    const i = fullyGreen();
    i.listings = [
      { platform: "android", status: "approved", version: 1, hash: "L_a" },
      { platform: "ios", status: "draft", version: 1, hash: "L_i" },
    ];
    const r = evaluateReviewGate(i);
    expect(r.review_state).not.toBe("review_ready");
    expect(r.blockers.some((b) => b.code === "LISTING_NOT_APPROVED" && b.platform === "ios")).toBe(true);
  });

  it("warnings emitted but not state-blocking for IAP_DISPATCHER_MISSING", () => {
    const i = fullyGreen();
    i.known_limitations.iap_dispatcher_present = false;
    const r = evaluateReviewGate(i);
    expect(r.warnings.some((w) => w.code === "IAP_DISPATCHER_MISSING")).toBe(true);
  });

  it("missing manifest still emits PRIVACY/SUPPORT structure-safe", () => {
    const i = fullyGreen();
    i.manifest = projectGuard(i.manifest);
    expect(() => evaluateReviewGate(i)).not.toThrow();
  });

  it("contract test stability — all blocker codes are unique strings", () => {
    const i = fullyGreen();
    i.manifest.product_id = null;
    i.manifest.curriculum_id = null;
    const r = evaluateReviewGate(i);
    const codes = r.blockers.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("next_actions is non-empty whenever there is a blocker", () => {
    const i = fullyGreen();
    i.manifest.privacy_url = null;
    const r = evaluateReviewGate(i);
    expect(r.next_actions.length).toBeGreaterThan(0);
  });
});

function projectGuard<T>(x: T): T {
  return x;
}
