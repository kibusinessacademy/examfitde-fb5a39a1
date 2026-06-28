import { describe, it, expect } from "vitest";
import { classifyOutcome, aggregateRunOutcome, RECOVERY_RUN_POLICY } from "../runOutcome";

const T0 = "2026-06-28T10:00:00.000Z";
const T_AFTER_GRACE = "2026-06-28T10:02:00.000Z"; // +120s
const T_IN_GRACE = "2026-06-28T10:00:30.000Z"; // +30s

const pkg = (overrides: Partial<any> = {}) => ({
  package_id: "p1", status: "planning", build_progress: 0,
  integrity_passed: null, council_approved: null, is_published: false,
  updated_at: T0, ...overrides,
});

describe("classifyOutcome", () => {
  it("returns pending_verification within grace window", () => {
    const v = classifyOutcome("restart_planning", { pkg_before: pkg(), pkg_after: pkg({ status: "building" }), jobs_before: [], jobs_after: [] }, T0, T_IN_GRACE);
    expect(v.status).toBe("pending_verification");
    expect(v.reason).toBe("grace_window");
  });

  it("restart_planning → verified_success on promoted_to_building", () => {
    const v = classifyOutcome("restart_planning",
      { pkg_before: pkg(), pkg_after: pkg({ status: "building", build_progress: 10 }), jobs_before: [], jobs_after: [] },
      T0, T_AFTER_GRACE);
    expect(v.status).toBe("verified_success");
    expect(v.reason).toBe("promoted_to_building");
  });

  it("restart_planning → verified_regressed on progress drop", () => {
    const v = classifyOutcome("restart_planning",
      { pkg_before: pkg({ build_progress: 20 }), pkg_after: pkg({ build_progress: 5 }), jobs_before: [], jobs_after: [] },
      T0, T_AFTER_GRACE);
    expect(v.status).toBe("verified_regressed");
  });

  it("restart_planning → verified_no_change when nothing moved", () => {
    const v = classifyOutcome("restart_planning",
      { pkg_before: pkg(), pkg_after: pkg(), jobs_before: [], jobs_after: [] },
      T0, T_AFTER_GRACE);
    expect(v.status).toBe("verified_no_change");
  });

  it("restart_planning → pending while scaffold job runs", () => {
    const v = classifyOutcome("restart_planning",
      { pkg_before: pkg(), pkg_after: pkg(), jobs_before: [],
        jobs_after: [{ job_type: "package_scaffold_learning_course", status: "processing", attempts: 1, updated_at: T_AFTER_GRACE }] },
      T0, T_AFTER_GRACE);
    expect(v.status).toBe("pending_verification");
  });

  it("enqueue_done_reaudit → verified_success when audit jobs completed", () => {
    const before = [{ job_type: "package_run_integrity_check", status: "pending", attempts: 0, updated_at: T0 }];
    const after = [{ job_type: "package_run_integrity_check", status: "completed", attempts: 1, updated_at: T_AFTER_GRACE }];
    const v = classifyOutcome("enqueue_done_reaudit", { pkg_before: pkg(), pkg_after: pkg(), jobs_before: before, jobs_after: after }, T0, T_AFTER_GRACE);
    expect(v.status).toBe("verified_success");
  });

  it("enqueue_done_reaudit → pending while audit running", () => {
    const after = [{ job_type: "package_run_integrity_check", status: "processing", attempts: 1, updated_at: T_AFTER_GRACE }];
    const v = classifyOutcome("enqueue_done_reaudit", { pkg_before: pkg(), pkg_after: pkg(), jobs_before: [], jobs_after: after }, T0, T_AFTER_GRACE);
    expect(v.status).toBe("pending_verification");
  });

  it("mark_manual_review_required → success when quarantined_after=true", () => {
    const v = classifyOutcome("mark_manual_review_required",
      { pkg_before: pkg(), pkg_after: pkg(), jobs_before: [], jobs_after: [], quarantined_after: true },
      T0, T_AFTER_GRACE);
    expect(v.status).toBe("verified_success");
  });

  it("propose_provider_fallback always verified_success (proposal only)", () => {
    const v = classifyOutcome("propose_provider_fallback", { pkg_before: null, pkg_after: null, jobs_before: [], jobs_after: [] }, T0, T_AFTER_GRACE);
    expect(v.status).toBe("verified_success");
  });

  it("diagnose_only → skipped", () => {
    const v = classifyOutcome("diagnose_only", { pkg_before: null, pkg_after: null, jobs_before: [], jobs_after: [] }, T0, T_AFTER_GRACE);
    expect(v.status).toBe("skipped");
  });
});

describe("aggregateRunOutcome", () => {
  it("verifying when any pending", () => {
    const s = aggregateRunOutcome([{ status: "verified_success", reason: "", signals: {} }, { status: "pending_verification", reason: "", signals: {} }]);
    expect(s.health).toBe("verifying");
  });
  it("verified_regressed when any regressed", () => {
    const s = aggregateRunOutcome([{ status: "verified_success", reason: "", signals: {} }, { status: "verified_regressed", reason: "", signals: {} }]);
    expect(s.health).toBe("verified_regressed");
  });
  it("verified when only successes", () => {
    const s = aggregateRunOutcome([{ status: "verified_success", reason: "", signals: {} }, { status: "verified_success", reason: "", signals: {} }]);
    expect(s.health).toBe("verified");
    expect(s.success_rate).toBe(1);
  });
  it("verified_partial when mix of success + no_change", () => {
    const s = aggregateRunOutcome([{ status: "verified_success", reason: "", signals: {} }, { status: "verified_no_change", reason: "", signals: {} }]);
    expect(s.health).toBe("verified_partial");
    expect(s.success_rate).toBe(0.5);
  });
  it("policy constants stable", () => {
    expect(RECOVERY_RUN_POLICY.MAX_ACTIONS_PER_RUN).toBe(25);
    expect(RECOVERY_RUN_POLICY.VERIFICATION_GRACE_MS).toBe(60_000);
  });
});
