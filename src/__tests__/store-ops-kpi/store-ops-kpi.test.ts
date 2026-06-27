import { describe, it, expect } from "vitest";
import {
  projectStoreOpsKpi,
  computeSummary,
  computePlatformSplit,
  topBlockers,
  topRejectionReasons,
  computeRiskDistribution,
  computeHealthScore,
  detectBottlenecks,
  classifyManifestRisk,
  type StoreOpsInput,
} from "@/lib/storeOpsKpi";

const T = "2026-06-27T00:00:00.000Z";

function base(over: Partial<StoreOpsInput> = {}): StoreOpsInput {
  return {
    manifests: [],
    builds: [],
    listings: [],
    screenshots: [],
    review_gates: [],
    candidates: [],
    lifecycle_events: [],
    lifecycle_feedback: [],
    known_limitations: { lifecycle_implemented: true, iap_dispatcher_present: true },
    evaluated_at_reference: T,
    stale_after_days: 14,
    ...over,
  };
}

const m = (id: string, over: Partial<StoreOpsInput["manifests"][number]> = {}) => ({
  manifest_id: id, has_privacy_url: true, has_support_url: true, complete: true, ...over,
});

function fullPipelineManifest(id: string): StoreOpsInput {
  return base({
    manifests: [m(id)],
    builds: [
      { manifest_id: id, platform: "android", status: "success" },
      { manifest_id: id, platform: "ios", status: "success" },
    ],
    listings: [
      { manifest_id: id, platform: "android", status: "approved" },
      { manifest_id: id, platform: "ios", status: "approved" },
    ],
    screenshots: [
      { manifest_id: id, platform: "android", ready_count: 3, required_count: 3 },
      { manifest_id: id, platform: "ios", ready_count: 3, required_count: 3 },
    ],
    review_gates: [
      { manifest_id: id, review_state: "review_ready", review_score: 95, android_ready: true, ios_ready: true, blockers: [] },
    ],
    candidates: [
      { candidate_id: "c1", manifest_id: id, status: "approved", manifest_hash: "h", listing_hash: "l", package_hash: "p", build_hash: "b", created_at_reference: T, invalidated: false },
    ],
  });
}

describe("STORE.OPS.KPI.OS.1 — pure SSOT", () => {
  it("1. empty input → health_score 0", () => {
    expect(projectStoreOpsKpi(base()).health_score).toBe(0);
  });

  it("2. full pipeline → high score (>=80)", () => {
    const p = projectStoreOpsKpi(fullPipelineManifest("a"));
    expect(p.health_score).toBeGreaterThanOrEqual(80);
  });

  it("3. failed build lowers score", () => {
    const ok = projectStoreOpsKpi(fullPipelineManifest("a")).health_score;
    const broken = fullPipelineManifest("a");
    broken.builds = [{ manifest_id: "a", platform: "android", status: "failed" }];
    expect(projectStoreOpsKpi(broken).health_score).toBeLessThan(ok);
  });

  it("4. missing listings → listing_bottleneck", () => {
    const i = base({ manifests: [m("a")], listings: [] });
    expect(detectBottlenecks(i).some((b) => b.kind === "listing_bottleneck")).toBe(true);
  });

  it("5. missing screenshots → screenshot_bottleneck", () => {
    const i = base({ manifests: [m("a")], screenshots: [] });
    expect(detectBottlenecks(i).some((b) => b.kind === "screenshot_bottleneck")).toBe(true);
  });

  it("6. rejections → rejection_bottleneck", () => {
    const i = base({
      manifests: [m("a")],
      lifecycle_feedback: [{ manifest_id: "a", store_feedback_type: "apple_binary_rejected", store_feedback_status: "rejected", reason_code: "guideline-2.3" }],
    });
    expect(detectBottlenecks(i).some((b) => b.kind === "rejection_bottleneck")).toBe(true);
  });

  it("7. lifecycle blocked → lifecycle_bottleneck", () => {
    const i = base({
      manifests: [m("a")],
      lifecycle_events: [{ manifest_id: "a", candidate_id: "c1", event_type: "blocked", to_state: "blocked", occurred_at_reference: T }],
    });
    expect(detectBottlenecks(i).some((b) => b.kind === "lifecycle_bottleneck")).toBe(true);
  });

  it("8. stale candidates detected", () => {
    const old = "2026-05-01T00:00:00.000Z";
    const i = base({
      manifests: [m("a")],
      candidates: [{ candidate_id: "c", manifest_id: "a", status: "submitted", manifest_hash: null, listing_hash: null, package_hash: null, build_hash: null, created_at_reference: old, invalidated: false }],
    });
    expect(computeSummary(i).stale_candidates_count).toBe(1);
  });

  it("9. top blockers correctly counted", () => {
    const i = base({
      manifests: [m("a"), m("b")],
      review_gates: [
        { manifest_id: "a", review_state: "blocked", review_score: 10, android_ready: false, ios_ready: false, blockers: [{ code: "NO_IOS_BUILD" }, { code: "LISTING_NOT_APPROVED" }] },
        { manifest_id: "b", review_state: "blocked", review_score: 12, android_ready: false, ios_ready: false, blockers: [{ code: "NO_IOS_BUILD" }] },
      ],
    });
    const tops = topBlockers(i);
    expect(tops[0]).toEqual({ code: "NO_IOS_BUILD", count: 2 });
  });

  it("10. top rejection reasons correctly counted", () => {
    const i = base({
      manifests: [m("a"), m("b")],
      lifecycle_feedback: [
        { manifest_id: "a", store_feedback_type: "apple_binary_rejected", store_feedback_status: "rejected", reason_code: "guideline-2.3" },
        { manifest_id: "b", store_feedback_type: "apple_binary_rejected", store_feedback_status: "rejected", reason_code: "guideline-2.3" },
      ],
    });
    expect(topRejectionReasons(i)[0]).toEqual({ reason: "guideline-2.3", count: 2 });
  });

  it("11. android/iOS split correct", () => {
    const p = computePlatformSplit(fullPipelineManifest("a"));
    expect(p.android.listings_ready).toBe(1);
    expect(p.ios.listings_ready).toBe(1);
    expect(p.android.builds_ok).toBe(1);
    expect(p.ios.builds_ok).toBe(1);
  });

  it("12. review_ready_count correct", () => {
    expect(computeSummary(fullPipelineManifest("a")).review_ready_count).toBe(1);
  });

  it("13. blocked_count correct", () => {
    const i = base({
      manifests: [m("a")],
      review_gates: [{ manifest_id: "a", review_state: "blocked", review_score: 0, android_ready: false, ios_ready: false, blockers: [] }],
    });
    expect(computeSummary(i).blocked_count).toBe(1);
  });

  it("14. build success rate correct", () => {
    const i = base({
      manifests: [m("a")],
      builds: [
        { manifest_id: "a", platform: "android", status: "success" },
        { manifest_id: "a", platform: "ios", status: "failed" },
      ],
    });
    expect(computeSummary(i).build_success_rate).toBe(0.5);
  });

  it("15. risk distribution correct", () => {
    const i = base({
      manifests: [m("a"), m("b")],
      review_gates: [
        { manifest_id: "a", review_state: "review_ready", review_score: 90, android_ready: true, ios_ready: true, blockers: [] },
        { manifest_id: "b", review_state: "blocked", review_score: 0, android_ready: false, ios_ready: false, blockers: [{ code: "X" }, { code: "Y" }, { code: "Z" }] },
      ],
      listings: [
        { manifest_id: "a", platform: "android", status: "approved" },
        { manifest_id: "a", platform: "ios", status: "approved" },
      ],
      screenshots: [
        { manifest_id: "a", platform: "android", ready_count: 3, required_count: 3 },
        { manifest_id: "a", platform: "ios", ready_count: 3, required_count: 3 },
      ],
    });
    const d = computeRiskDistribution(i);
    expect(d.low + d.medium + d.high + d.critical).toBe(2);
    expect(d.critical + d.high).toBeGreaterThanOrEqual(1);
  });

  it("16. health score deterministic", () => {
    const i = fullPipelineManifest("a");
    expect(computeHealthScore(i)).toBe(computeHealthScore(i));
  });

  it("17. recommended actions deterministic", () => {
    const i = base({ manifests: [m("a")], listings: [], screenshots: [] });
    const a = projectStoreOpsKpi(i).recommended_actions;
    const b = projectStoreOpsKpi(i).recommended_actions;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("29. repeated rejection reason increases risk", () => {
    const baseRej = base({
      manifests: [m("a")],
      lifecycle_feedback: [
        { manifest_id: "a", store_feedback_type: "apple_binary_rejected", store_feedback_status: "rejected", reason_code: "g-2.3" },
      ],
    });
    const repeated: StoreOpsInput = {
      ...baseRej,
      lifecycle_feedback: [
        ...baseRej.lifecycle_feedback,
        { manifest_id: "a", store_feedback_type: "apple_binary_rejected", store_feedback_status: "rejected", reason_code: "g-2.3" },
      ],
    };
    const r1 = classifyManifestRisk(baseRej, "a");
    const r2 = classifyManifestRisk(repeated, "a");
    const order = ["low", "medium", "high", "critical"];
    expect(order.indexOf(r2)).toBeGreaterThanOrEqual(order.indexOf(r1));
  });

  it("30. hash mismatch increases risk", () => {
    const noDrift = base({
      manifests: [m("a")],
      candidates: [
        { candidate_id: "c1", manifest_id: "a", status: "approved", manifest_hash: "h", listing_hash: null, package_hash: null, build_hash: null, created_at_reference: T, invalidated: false },
      ],
    });
    const drift: StoreOpsInput = {
      ...noDrift,
      candidates: [
        ...noDrift.candidates,
        { candidate_id: "c2", manifest_id: "a", status: "approved", manifest_hash: "h2", listing_hash: null, package_hash: null, build_hash: null, created_at_reference: T, invalidated: false },
      ],
    };
    const order = ["low", "medium", "high", "critical"];
    expect(order.indexOf(classifyManifestRisk(drift, "a"))).toBeGreaterThanOrEqual(order.indexOf(classifyManifestRisk(noDrift, "a")));
  });

  it("31. known limitations produce warning, not bottleneck", () => {
    const i = base({
      manifests: [m("a")],
      known_limitations: { lifecycle_implemented: false, iap_dispatcher_present: false },
    });
    const p = projectStoreOpsKpi(i);
    expect(p.warnings).toContain("lifecycle_layer_missing");
    expect(p.warnings).toContain("iap_dispatcher_missing");
    expect(p.bottlenecks.every((b) => b.kind !== "lifecycle_bottleneck")).toBe(true);
  });

  it("32. platform split stays separated", () => {
    const i = base({
      manifests: [m("a")],
      listings: [{ manifest_id: "a", platform: "android", status: "approved" }],
      builds: [{ manifest_id: "a", platform: "android", status: "success" }],
      screenshots: [{ manifest_id: "a", platform: "android", ready_count: 3, required_count: 3 }],
    });
    const p = computePlatformSplit(i);
    expect(p.android.listings_ready).toBe(1);
    expect(p.ios.listings_ready).toBe(0);
    expect(p.ios.builds_ok).toBe(0);
  });

  it("33. summary counts only known manifest IDs", () => {
    const i = base({
      manifests: [m("a")],
      review_gates: [
        { manifest_id: "a", review_state: "review_ready", review_score: 80, android_ready: true, ios_ready: true, blockers: [] },
        { manifest_id: "ghost", review_state: "review_ready", review_score: 80, android_ready: true, ios_ready: true, blockers: [] },
      ],
    });
    expect(computeSummary(i).review_ready_count).toBe(1);
  });

  it("34. bottleneck severity correctly mapped", () => {
    const i = base({
      manifests: [m("a"), m("b"), m("c"), m("d")],
      builds: [
        { manifest_id: "a", platform: "android", status: "failed" },
        { manifest_id: "b", platform: "android", status: "failed" },
        { manifest_id: "c", platform: "android", status: "failed" },
        { manifest_id: "d", platform: "android", status: "failed" },
      ],
    });
    const bb = detectBottlenecks(i).find((x) => x.kind === "build_bottleneck")!;
    expect(bb.severity).toBe("critical");
  });
});
