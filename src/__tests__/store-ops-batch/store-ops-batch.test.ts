import { describe, it, expect } from "vitest";
import {
  planBatch,
  projectBatch,
  deriveStateFromItems,
  isAllowedAction,
  isForbiddenAction,
  filterAllowedActions,
  ALLOWED_BATCH_ACTIONS,
  FORBIDDEN_BATCH_ACTIONS,
  type BatchPlanInput,
} from "@/lib/storeOpsBatch";

const REF = "2026-06-27T12:00:00.000Z";

function input(overrides: Partial<BatchPlanInput> = {}): BatchPlanInput {
  return {
    batch_id: "batch-1",
    manifest_ids: ["m1", "m2"],
    selected_action_types: ["run_kpi_snapshot", "run_review_gate"],
    planned_at_reference: REF,
    manifests: [
      { manifest_id: "m1", complete: true, has_privacy_url: true, has_support_url: true },
      { manifest_id: "m2", complete: false, has_privacy_url: false, has_support_url: false },
    ],
    review_gates: [
      { manifest_id: "m1", review_state: "review_ready", android_ready: true, ios_ready: true, blocked: false },
    ],
    kpi: [],
    lifecycle: [
      { manifest_id: "m1", current_state: "ready", blocked: false },
      { manifest_id: "m2", current_state: "rejected", blocked: true },
    ],
    builds: [],
    ...overrides,
  };
}

describe("STORE.OPS.BATCH.OS.1 — policy", () => {
  it("permits only allowed actions", () => {
    for (const a of ALLOWED_BATCH_ACTIONS) expect(isAllowedAction(a)).toBe(true);
    for (const f of FORBIDDEN_BATCH_ACTIONS) {
      expect(isAllowedAction(f)).toBe(false);
      expect(isForbiddenAction(f)).toBe(true);
    }
  });

  it("filters out forbidden actions and reports them", () => {
    const { allowed, rejected } = filterAllowedActions([
      "run_kpi_snapshot",
      "publish",
      "submit_for_review",
      "production_rollout",
    ]);
    expect(allowed).toEqual(["run_kpi_snapshot"]);
    expect(rejected.sort()).toEqual(["production_rollout", "publish", "submit_for_review"]);
  });
});

describe("STORE.OPS.BATCH.OS.1 — plan", () => {
  it("is deterministic and sorted", () => {
    const a = planBatch(input());
    const b = planBatch(input());
    expect(a).toEqual(b);
    expect(a.items.map((i) => i.manifest_id)).toEqual([...a.items.map((i) => i.manifest_id)].sort());
  });

  it("blocks items whose manifest is incomplete or lifecycle is blocked", () => {
    const p = planBatch(input());
    const m2items = p.items.filter((i) => i.manifest_id === "m2");
    expect(m2items.every((i) => i.status === "blocked")).toBe(true);
    expect(m2items[0].blockers.some((b) => b.code === "MANIFEST_INCOMPLETE")).toBe(true);
    expect(m2items[0].blockers.some((b) => b.code === "LIFECYCLE_BLOCKED")).toBe(true);
  });

  it("blocks create_release_candidate when review gate not ready", () => {
    const p = planBatch(input({
      manifest_ids: ["m1"],
      selected_action_types: ["create_release_candidate"],
      review_gates: [{ manifest_id: "m1", review_state: "qa_required", android_ready: false, ios_ready: false, blocked: false }],
    }));
    expect(p.items[0].status).toBe("blocked");
    expect(p.items[0].blockers.some((b) => b.code === "REVIEW_GATE_BLOCKED")).toBe(true);
  });

  it("rejects forbidden actions with warnings", () => {
    const p = planBatch(input({
      selected_action_types: ["publish" as any, "submit_for_review" as any, "run_kpi_snapshot"],
    }));
    expect(p.warnings.length).toBeGreaterThanOrEqual(2);
    expect(p.items.every((i) => i.action_type === "run_kpi_snapshot")).toBe(true);
  });
});

describe("STORE.OPS.BATCH.OS.1 — state machine", () => {
  it("derives planned/partially_completed/completed/blocked", () => {
    expect(deriveStateFromItems([])).toBe("draft");
    expect(deriveStateFromItems([{ manifest_id: "m", action_type: "run_kpi_snapshot", status: "planned", blockers: [] }])).toBe("planned");
    expect(deriveStateFromItems([
      { manifest_id: "m", action_type: "run_kpi_snapshot", status: "succeeded", blockers: [] },
      { manifest_id: "m", action_type: "run_review_gate", status: "failed", blockers: [] },
    ])).toBe("partially_completed");
    expect(deriveStateFromItems([
      { manifest_id: "m", action_type: "run_kpi_snapshot", status: "succeeded", blockers: [] },
    ])).toBe("completed");
    expect(deriveStateFromItems([
      { manifest_id: "m", action_type: "run_kpi_snapshot", status: "blocked", blockers: [] },
    ])).toBe("blocked");
  });
});

describe("STORE.OPS.BATCH.OS.1 — projection", () => {
  it("merges results into plan and counts outcomes", () => {
    const plan = planBatch(input({ manifest_ids: ["m1"], selected_action_types: ["run_kpi_snapshot", "run_review_gate"] }));
    const proj = projectBatch(plan, [
      { manifest_id: "m1", action_type: "run_kpi_snapshot", status: "succeeded" },
      { manifest_id: "m1", action_type: "run_review_gate", status: "failed" },
    ], REF);
    expect(proj.succeeded).toBe(1);
    expect(proj.failed).toBe(1);
    expect(proj.state).toBe("partially_completed");
  });
});
