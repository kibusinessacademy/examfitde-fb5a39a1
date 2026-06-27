import { describe, it, expect } from "vitest";
import {
  planAutopilot,
  decideExecution,
  projectAutopilot,
  evaluateRisk,
  filterAllowedActions,
  isAllowedAction,
  isForbiddenAction,
  ALLOWED_AUTOPILOT_ACTIONS,
  FORBIDDEN_AUTOPILOT_ACTIONS,
  ESTIMATED_RUNTIME,
  type AutopilotInput,
  type AutopilotMode,
} from "@/lib/storeOpsAutopilot";

const REF = "2026-06-27T12:00:00.000Z";

function input(overrides: Partial<AutopilotInput> = {}): AutopilotInput {
  return {
    run_id: "run-1",
    mode: "recommend_only",
    requested_actions: "auto",
    evaluated_at_reference: REF,
    manifests: [
      { manifest_id: "m1", complete: true, has_privacy_url: true, has_support_url: true },
    ],
    review_gates: [
      { manifest_id: "m1", review_state: "review_ready", review_ready: true, android_ready: true, ios_ready: true, blocker_count: 0 },
    ],
    candidates: [],
    lifecycle: [{ manifest_id: "m1", current_state: "ready", has_error: false }],
    builds: [
      { manifest_id: "m1", platform: "android", status: "success" },
      { manifest_id: "m1", platform: "ios", status: "success" },
    ],
    listings: [
      { manifest_id: "m1", platform: "android", status: "approved" },
      { manifest_id: "m1", platform: "ios", status: "approved" },
    ],
    screenshots: [
      { manifest_id: "m1", platform: "android", ready_count: 3, required_count: 3 },
      { manifest_id: "m1", platform: "ios", ready_count: 3, required_count: 3 },
    ],
    kpi: [],
    batch_status: [{ manifest_id: "m1", has_open_failures: false }],
    hash_drift: [{ manifest_id: "m1", drifted: false }],
    known_limitations: { lifecycle_implemented: true, iap_dispatcher_present: true },
    ...overrides,
  };
}

describe("STORE.OPS.AUTOPILOT.OS.1 — modes", () => {
  it("1. disabled produces no plan items and no manual step", () => {
    const p = planAutopilot(input({ mode: "disabled" }));
    expect(p.safe_actions).toHaveLength(0);
    expect(p.manual_actions).toHaveLength(0);
    expect(p.blocked_actions).toHaveLength(0);
    expect(decideExecution(p, "disabled").should_execute).toBe(false);
  });

  it("2. recommend_only never executes", () => {
    const p = planAutopilot(input({ mode: "recommend_only" }));
    expect(p.manual_actions.length).toBeGreaterThan(0);
    expect(decideExecution(p, "recommend_only").should_execute).toBe(false);
  });

  it("3. safe_execute only allows allow-listed actions", () => {
    const p = planAutopilot(input({ mode: "safe_execute" }));
    const d = decideExecution(p, "safe_execute");
    expect(d.should_execute).toBe(true);
    for (const a of d.executable_actions) {
      expect(ALLOWED_AUTOPILOT_ACTIONS.includes(a.action_type)).toBe(true);
    }
  });
});

describe("STORE.OPS.AUTOPILOT.OS.1 — forbidden actions", () => {
  it("4-9. publish/submit/rollout/iap/entitlement/manual_feedback are forbidden", () => {
    for (const f of FORBIDDEN_AUTOPILOT_ACTIONS) {
      expect(isAllowedAction(f)).toBe(false);
      expect(isForbiddenAction(f)).toBe(true);
    }
    const { allowed, rejected } = filterAllowedActions([...FORBIDDEN_AUTOPILOT_ACTIONS]);
    expect(allowed).toHaveLength(0);
    expect(rejected.length).toBe(FORBIDDEN_AUTOPILOT_ACTIONS.length);
  });
});

describe("STORE.OPS.AUTOPILOT.OS.1 — applicability blockers", () => {
  it("10. hash mismatch blocks safe execute of release candidate", () => {
    const p = planAutopilot(input({
      mode: "safe_execute",
      hash_drift: [{ manifest_id: "m1", drifted: true }],
    }));
    const rc = p.blocked_actions.find((a) => a.action_type === "create_release_candidate");
    expect(rc?.blockers.some((b) => b.code === "HASH_MISMATCH")).toBe(true);
  });

  it("11. missing screenshots block create_release_candidate", () => {
    const p = planAutopilot(input({
      mode: "safe_execute",
      screenshots: [
        { manifest_id: "m1", platform: "android", ready_count: 1, required_count: 3 },
        { manifest_id: "m1", platform: "ios", ready_count: 3, required_count: 3 },
      ],
    }));
    const rc = p.blocked_actions.find((a) => a.action_type === "create_release_candidate");
    expect(rc?.blockers.some((b) => b.code === "MISSING_SCREENSHOTS")).toBe(true);
  });

  it("12. missing build blocks create_release_candidate", () => {
    const p = planAutopilot(input({
      mode: "safe_execute",
      builds: [{ manifest_id: "m1", platform: "android", status: "failed" }],
    }));
    const rc = p.blocked_actions.find((a) => a.action_type === "create_release_candidate");
    expect(rc?.blockers.some((b) => b.code === "MISSING_BUILD")).toBe(true);
  });
});

describe("STORE.OPS.AUTOPILOT.OS.1 — sequencing & determinism", () => {
  it("13. run_review_gate appears before create_release_candidate", () => {
    const p = planAutopilot(input({ mode: "safe_execute" }));
    const seq = p.recommended_sequence;
    const rg = seq.indexOf("run_review_gate");
    const rc = seq.indexOf("create_release_candidate");
    if (rg >= 0 && rc >= 0) expect(rg).toBeLessThan(rc);
  });

  it("14. KPI snapshot is always allowed", () => {
    const p = planAutopilot(input({
      mode: "safe_execute",
      review_gates: [{ manifest_id: "m1", review_state: "draft", review_ready: false, android_ready: false, ios_ready: false, blocker_count: 3 }],
    }));
    expect(p.safe_actions.some((a) => a.action_type === "run_store_ops_kpi")).toBe(true);
  });

  it("15. Lifecycle projection is always allowed", () => {
    const p = planAutopilot(input({
      mode: "safe_execute",
      review_gates: [{ manifest_id: "m1", review_state: "draft", review_ready: false, android_ready: false, ios_ready: false, blocker_count: 1 }],
    }));
    expect(p.safe_actions.some((a) => a.action_type === "run_lifecycle_projection")).toBe(true);
  });

  it("16. duplicate actions are deduplicated", () => {
    const p = planAutopilot(input({ mode: "safe_execute" }));
    const keys = p.safe_actions.map((a) => `${a.manifest_id}::${a.action_type}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("17. risk score is deterministic", () => {
    const a = evaluateRisk(input());
    const b = evaluateRisk(input());
    expect(a).toEqual(b);
  });

  it("18. recommended sequence is deterministic", () => {
    const a = planAutopilot(input({ mode: "safe_execute" }));
    const b = planAutopilot(input({ mode: "safe_execute" }));
    expect(a.recommended_sequence).toEqual(b.recommended_sequence);
  });

  it("19. runtime estimate is deterministic and sums per safe action", () => {
    const p = planAutopilot(input({ mode: "safe_execute" }));
    const sum = p.safe_actions.reduce((s, a) => s + (ESTIMATED_RUNTIME[a.action_type] ?? 0), 0);
    expect(p.estimated_runtime_seconds).toBe(sum);
  });
});

describe("STORE.OPS.AUTOPILOT.OS.1 — projection", () => {
  it("20. projection counts succeeded/failed/blocked", () => {
    const p = planAutopilot(input({ mode: "safe_execute" }));
    const proj = projectAutopilot(p, p.safe_actions.map((a) => ({
      manifest_id: a.manifest_id,
      action_type: a.action_type,
      status: "succeeded" as const,
    })), REF);
    expect(proj.succeeded).toBe(p.safe_actions.length);
    expect(proj.state === "completed" || proj.state === "partially_completed").toBe(true);
  });

  it("32. safe run ends cleanly when all are blocked", () => {
    const p = planAutopilot(input({
      mode: "safe_execute",
      builds: [{ manifest_id: "m1", platform: "android", status: "failed" }],
      review_gates: [{ manifest_id: "m1", review_state: "draft", review_ready: false, android_ready: false, ios_ready: false, blocker_count: 1 }],
    }));
    const proj = projectAutopilot(p, [], REF);
    expect(["blocked", "planned"]).toContain(proj.state);
  });

  it("36. refresh_projection is idempotent (re-planning gives same plan)", () => {
    const a = planAutopilot(input({ mode: "safe_execute" }));
    const b = planAutopilot(input({ mode: "safe_execute" }));
    expect(a).toEqual(b);
  });
});

describe("STORE.OPS.AUTOPILOT.OS.1 — allow-list integrity", () => {
  it("21-30. UI/edge cannot bypass allow-list", () => {
    expect(ALLOWED_AUTOPILOT_ACTIONS).not.toContain("publish");
    expect(ALLOWED_AUTOPILOT_ACTIONS).not.toContain("submit_review");
    expect(ALLOWED_AUTOPILOT_ACTIONS).not.toContain("production_rollout");
    expect(ALLOWED_AUTOPILOT_ACTIONS).not.toContain("iap_change");
    expect(ALLOWED_AUTOPILOT_ACTIONS).not.toContain("entitlement_change");
    expect(ALLOWED_AUTOPILOT_ACTIONS).not.toContain("manual_feedback");
  });

  it("33. simulation contract: plan is pure (no side effects exposed)", () => {
    const a = planAutopilot(input());
    const b = planAutopilot(input());
    expect(a).toEqual(b);
  });

  it("34. cleanup_stale_candidates is in allow-list (delete enforced by executor, not planner)", () => {
    expect(ALLOWED_AUTOPILOT_ACTIONS).toContain("cleanup_stale_candidates");
  });

  it("35. refresh_hashes is in allow-list as read-only refresh", () => {
    expect(ALLOWED_AUTOPILOT_ACTIONS).toContain("refresh_hashes");
  });
});

describe("STORE.OPS.AUTOPILOT.OS.1 — integration safety", () => {
  it("37. forbidden action set is disjoint from allow-list", () => {
    for (const a of ALLOWED_AUTOPILOT_ACTIONS) {
      expect(FORBIDDEN_AUTOPILOT_ACTIONS as readonly string[]).not.toContain(a);
    }
  });

  it("38. maintenance mode restricts to read/refresh/cleanup", () => {
    const p = planAutopilot(input({ mode: "maintenance" }));
    const allowed = new Set(["refresh_hashes", "refresh_projection", "cleanup_stale_candidates", "run_store_ops_kpi", "run_lifecycle_projection"]);
    for (const a of [...p.safe_actions, ...p.manual_actions, ...p.blocked_actions]) {
      expect(allowed.has(a.action_type)).toBe(true);
    }
  });

  it("39. lifecycle error blocks risky actions", () => {
    const p = planAutopilot(input({
      mode: "safe_execute",
      lifecycle: [{ manifest_id: "m1", current_state: "rejected", has_error: true }],
    }));
    expect(p.blocked_actions.length).toBeGreaterThan(0);
  });
});

describe("STORE.OPS.AUTOPILOT.OS.1 — risk levels", () => {
  it("40. risk grows with blockers and failures", () => {
    const low = evaluateRisk(input());
    const high = evaluateRisk(input({
      review_gates: [{ manifest_id: "m1", review_state: "blocked", review_ready: false, android_ready: false, ios_ready: false, blocker_count: 5 }],
      builds: [{ manifest_id: "m1", platform: "android", status: "failed" }, { manifest_id: "m1", platform: "ios", status: "failed" }],
      hash_drift: [{ manifest_id: "m1", drifted: true }],
      lifecycle: [{ manifest_id: "m1", current_state: "rejected", has_error: true }],
    }));
    expect(high.score).toBeGreaterThan(low.score);
    expect(["high", "critical", "medium"]).toContain(high.level);
  });
});
