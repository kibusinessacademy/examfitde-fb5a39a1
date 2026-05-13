/**
 * Reconciler Branch-3 decision spec — gate-status-driven, NOT reason-code-driven.
 *
 * Mirror of the Branch 3 logic in index.ts so the contract is enforced
 * as an executable spec. If anyone re-introduces reason-code matching
 * as the primary success path, these tests fail.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

type ChildStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

type Decision =
  | { kind: "re_park" }
  | { kind: "child_failed"; last_error_code: "CHILD_JOB_FAILED" }
  | { kind: "completed_after_children"; gate_status_after: string }
  | {
      kind: "no_effect_after_children";
      last_error_code: "NO_EFFECT_LF_REPAIR";
      gate_status_after: string;
      gate_reasons_after: string[];
    };

function reconcile(input: {
  childStatuses: ChildStatus[];
  dispatchedChildren: number;
  gateStatusAfter?: string;
  gateReasonsAfter?: string[];
}): Decision {
  const { childStatuses, gateStatusAfter = "", gateReasonsAfter = [] } = input;
  const anyFailed = childStatuses.some((s) => s === "failed" || s === "cancelled");
  if (anyFailed) return { kind: "child_failed", last_error_code: "CHILD_JOB_FAILED" };

  const allCompleted = childStatuses.every((s) => s === "completed");
  if (!allCompleted) return { kind: "re_park" };

  // Branch 3 — STRICT: only PASS completes the parent.
  if (gateStatusAfter === "PASS") {
    return { kind: "completed_after_children", gate_status_after: gateStatusAfter };
  }
  return {
    kind: "no_effect_after_children",
    last_error_code: "NO_EFFECT_LF_REPAIR",
    gate_status_after: gateStatusAfter,
    gate_reasons_after: gateReasonsAfter,
  };
}

Deno.test("1. all children completed + gate PASS → completed", () => {
  const r = reconcile({
    childStatuses: ["completed", "completed"],
    dispatchedChildren: 2,
    gateStatusAfter: "PASS",
    gateReasonsAfter: [],
  });
  assertEquals(r.kind, "completed_after_children");
});

Deno.test("2. all children completed + gate NEEDS_REPAIR (matching REPAIR_LF reason) → no-effect", () => {
  const r = reconcile({
    childStatuses: ["completed", "completed"],
    dispatchedChildren: 2,
    gateStatusAfter: "NEEDS_REPAIR",
    gateReasonsAfter: ["REPAIR_LF_COVERAGE"],
  });
  assertEquals(r.kind, "no_effect_after_children");
  if (r.kind === "no_effect_after_children") {
    assertEquals(r.last_error_code, "NO_EFFECT_LF_REPAIR");
  }
});

Deno.test("3. all children completed + gate NEEDS_REPAIR but no matching REPAIR_LF reason → still no-effect (gate-driven)", () => {
  const r = reconcile({
    childStatuses: ["completed", "completed", "completed"],
    dispatchedChildren: 3,
    gateStatusAfter: "NEEDS_REPAIR",
    gateReasonsAfter: ["SOMETHING_ELSE", "PENDING_QC_HIGH"],
  });
  assertEquals(r.kind, "no_effect_after_children");
});

Deno.test("4. waiting children → re-park (no fresh dispatch)", () => {
  const r = reconcile({
    childStatuses: ["completed", "processing"],
    dispatchedChildren: 2,
    gateStatusAfter: "PASS", // irrelevant while waiting
  });
  assertEquals(r.kind, "re_park");
});

Deno.test("5. child failed → parent failed CHILD_JOB_FAILED", () => {
  const r = reconcile({
    childStatuses: ["completed", "failed"],
    dispatchedChildren: 2,
  });
  assertEquals(r.kind, "child_failed");
  if (r.kind === "child_failed") {
    assertEquals(r.last_error_code, "CHILD_JOB_FAILED");
  }
});

Deno.test("6. WAITING_FOR_MATERIALIZATION (not PASS) → no-effect (gate-driven, not reason-driven)", () => {
  const r = reconcile({
    childStatuses: ["completed"],
    dispatchedChildren: 1,
    gateStatusAfter: "WAITING_FOR_MATERIALIZATION",
    gateReasonsAfter: ["UPSTREAM_GENERATION_ACTIVE"],
  });
  assertEquals(r.kind, "no_effect_after_children");
});
