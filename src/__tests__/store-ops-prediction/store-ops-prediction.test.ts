/**
 * STORE.OPS.PREDICTION.OS.1 — deterministic projection & explainability tests.
 *
 * Covers predictor, outcome model, blocker / rejection / manual forecasts,
 * duration estimator, queue load, risk aggregation, confidence and the full
 * projection orchestrator. Pure-only — no DB, no HTTP, no clock, no RNG.
 */
import { describe, it, expect } from "vitest";
import {
  assertPlannedOperation,
  isForbiddenAction,
} from "@/lib/storeOpsPrediction/prediction-policy";
import { computeActionBaselines } from "@/lib/storeOpsPrediction/predictor";
import { computeOutcome } from "@/lib/storeOpsPrediction/outcome-model";
import {
  forecastBlockers,
  forecastManualInterventions,
  forecastRejections,
} from "@/lib/storeOpsPrediction/blocker-forecast";
import {
  estimateDuration,
  estimateQueueLoad,
} from "@/lib/storeOpsPrediction/duration-estimator";
import { computeConfidence } from "@/lib/storeOpsPrediction/confidence";
import { projectPrediction } from "@/lib/storeOpsPrediction/projection";
import { buildPredictionAudit } from "@/lib/storeOpsPrediction/audit";
import type {
  AutopilotActionSnapshot,
  AutopilotRunSnapshot,
  BatchItemSnapshot,
  BatchSnapshot,
  IntelligenceRunSnapshot,
  KpiHistorySnapshot,
  PlannedOperation,
  PredictionInput,
} from "@/lib/storeOpsPrediction/contracts";

const REF_TS = "2026-06-27T00:00:00.000Z";

function batch(id: string, total: number, succeeded: number, failed: number, blocked = 0): BatchSnapshot {
  return {
    batch_id: id,
    state: "completed",
    total,
    succeeded,
    failed,
    blocked,
    skipped: 0,
    created_at_reference: REF_TS,
  };
}

function item(
  batch_id: string,
  action_type: string,
  status: string,
  blockers: string[] = [],
  duration: number | null = 60,
): BatchItemSnapshot {
  return {
    batch_id,
    manifest_id: `m-${action_type}-${status}`,
    action_type,
    status,
    blocker_codes: blockers,
    duration_seconds: duration,
  };
}

function autoAction(
  run_id: string,
  action_type: string,
  status: string,
  blockers: string[] = [],
): AutopilotActionSnapshot {
  return { run_id, manifest_id: "m1", action_type, status, blocker_codes: blockers };
}

function autoRun(
  id: string,
  mode: string,
  safe: number,
  manual: number,
  blocked: number,
): AutopilotRunSnapshot {
  return {
    run_id: id,
    mode,
    state: "completed",
    risk_score: 10,
    risk_level: "low",
    safe_count: safe,
    manual_count: manual,
    blocked_count: blocked,
    succeeded: safe,
    failed: 0,
    evaluated_at_reference: REF_TS,
  };
}

function kpi(health: number, rejected = 0, reasons: string[] = []): KpiHistorySnapshot {
  return {
    snapshot_id: "k1",
    health_score: health,
    blocked_count: 0,
    rejected_count: rejected,
    build_success_rate: 0.95,
    top_rejection_reasons: reasons,
    top_blockers: [],
    created_at_reference: REF_TS,
  };
}

function plan(over: Partial<PlannedOperation> = {}): PlannedOperation {
  return {
    operation_key: "test:op",
    planned_action_types: ["run_review_gate", "create_release_candidate"],
    expected_manifest_count: 10,
    mode: "safe_execute",
    ...over,
  };
}

function input(over: Partial<PredictionInput> = {}): PredictionInput {
  return {
    run_id: "00000000-0000-0000-0000-000000000001",
    evaluated_at_reference: REF_TS,
    planned: plan(),
    batches: [],
    batch_items: [],
    kpi_history: [],
    autopilot_runs: [],
    autopilot_actions: [],
    intelligence_runs: [],
    intelligence_findings: [],
    ...over,
  };
}

describe("STORE.OPS.PREDICTION.OS.1 — policy", () => {
  it("accepts allow-listed planned operation", () => {
    const r = assertPlannedOperation(plan());
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("rejects publish/submit/rollout/approve action types", () => {
    for (const bad of ["publish", "submit_for_review", "production_rollout", "approve", "bypass_review", "modify_policy", "modify_gate", "extend_autopilot"]) {
      const r = assertPlannedOperation(plan({ planned_action_types: [bad] }));
      expect(r.ok).toBe(false);
      expect(r.violations.some((v) => v.includes("forbidden_action"))).toBe(true);
    }
  });

  it("rejects substring smuggling of forbidden tokens", () => {
    const r = assertPlannedOperation(plan({ planned_action_types: ["sneaky_publish_now"] }));
    expect(r.ok).toBe(false);
  });

  it("rejects empty operation_key", () => {
    const r = assertPlannedOperation(plan({ operation_key: "" }));
    expect(r.ok).toBe(false);
  });

  it("rejects negative manifest count", () => {
    const r = assertPlannedOperation(plan({ expected_manifest_count: -1 }));
    expect(r.ok).toBe(false);
  });

  it("isForbiddenAction agrees with policy", () => {
    expect(isForbiddenAction("publish")).toBe(true);
    expect(isForbiddenAction("PUBLISH")).toBe(true);
    expect(isForbiddenAction("run_review_gate")).toBe(false);
  });
});

describe("STORE.OPS.PREDICTION.OS.1 — predictor (action baselines)", () => {
  it("returns empty array for no input", () => {
    expect(computeActionBaselines([], [])).toEqual([]);
  });

  it("aggregates success / failure / blocked correctly", () => {
    const items = [
      item("b1", "x", "succeeded"),
      item("b1", "x", "failed"),
      item("b1", "x", "blocked"),
      item("b1", "x", "succeeded"),
    ];
    const [b] = computeActionBaselines(items, []);
    expect(b.observed_total).toBe(4);
    expect(b.observed_succeeded).toBe(2);
    expect(b.observed_failed).toBe(1);
    expect(b.observed_blocked).toBe(1);
    expect(b.success_rate).toBe(0.5);
    expect(b.failure_rate).toBe(0.25);
    expect(b.block_rate).toBe(0.25);
  });

  it("aggregates batch and autopilot actions together", () => {
    const items = [item("b1", "x", "succeeded")];
    const actions = [autoAction("r1", "x", "failed")];
    const [b] = computeActionBaselines(items, actions);
    expect(b.observed_total).toBe(2);
    expect(b.observed_succeeded).toBe(1);
    expect(b.observed_failed).toBe(1);
  });

  it("computes average duration only over numeric samples", () => {
    const items = [
      item("b1", "x", "succeeded", [], 60),
      item("b1", "x", "succeeded", [], 120),
      item("b1", "x", "succeeded", [], null),
    ];
    const [b] = computeActionBaselines(items, []);
    expect(b.duration_sample_count).toBe(2);
    expect(b.average_duration_seconds).toBe(90);
  });

  it("is deterministic: identical input → identical output", () => {
    const items = [item("b1", "x", "succeeded"), item("b1", "y", "failed")];
    const a = computeActionBaselines(items, []);
    const b = computeActionBaselines(items, []);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("orders baselines deterministically by action_type", () => {
    const items = [item("b1", "z", "succeeded"), item("b1", "a", "failed"), item("b1", "m", "blocked")];
    const out = computeActionBaselines(items, []);
    expect(out.map((b) => b.action_type)).toEqual(["a", "m", "z"]);
  });
});

describe("STORE.OPS.PREDICTION.OS.1 — outcome model", () => {
  it("returns no_data when planned size or actions is zero", () => {
    const o = computeOutcome(plan({ expected_manifest_count: 0 }), []);
    expect(o.baseline_used).toBe("no_data");
    expect(o.success_probability).toBe(0);
  });

  it("uses action baseline when sample is sufficient", () => {
    const items = Array.from({ length: 5 }, () => item("b1", "run_review_gate", "succeeded"));
    const baselines = computeActionBaselines(items, []);
    const o = computeOutcome(plan({ planned_action_types: ["run_review_gate"], expected_manifest_count: 10 }), baselines);
    expect(o.baseline_used).toBe("action_baseline");
    expect(o.expected_succeeded).toBe(10);
    expect(o.success_probability).toBe(1);
  });

  it("falls back to global baseline for unseen action types", () => {
    const items = Array.from({ length: 4 }, () => item("b1", "other", "succeeded"));
    const baselines = computeActionBaselines(items, []);
    const o = computeOutcome(plan({ planned_action_types: ["never_seen"], expected_manifest_count: 5 }), baselines);
    expect(o.baseline_used).toBe("global_baseline");
  });

  it("reflects failure rates in expected_failures", () => {
    const items = [
      ...Array.from({ length: 4 }, () => item("b1", "x", "succeeded")),
      ...Array.from({ length: 4 }, () => item("b1", "x", "failed")),
      ...Array.from({ length: 2 }, () => item("b1", "x", "blocked")),
    ];
    const baselines = computeActionBaselines(items, []);
    const o = computeOutcome(plan({ planned_action_types: ["x"], expected_manifest_count: 10 }), baselines);
    expect(o.expected_failures).toBe(4);
    expect(o.expected_blocked).toBe(2);
    expect(o.expected_succeeded).toBe(4);
  });

  it("success probability stays within [0,1]", () => {
    for (let i = 0; i < 5; i++) {
      const items = Array.from({ length: 10 }, (_, k) =>
        item("b1", "x", k % 3 === 0 ? "failed" : "succeeded"),
      );
      const baselines = computeActionBaselines(items, []);
      const o = computeOutcome(plan({ planned_action_types: ["x"], expected_manifest_count: 7 }), baselines);
      expect(o.success_probability).toBeGreaterThanOrEqual(0);
      expect(o.success_probability).toBeLessThanOrEqual(1);
    }
  });
});

describe("STORE.OPS.PREDICTION.OS.1 — blocker / rejection / manual forecasts", () => {
  it("forecastBlockers returns empty array for no events", () => {
    expect(forecastBlockers([], [], plan())).toEqual([]);
  });

  it("blocker historical_rate and expected_occurrences scale with planned size", () => {
    const items = [
      item("b1", "x", "blocked", ["LISTING_INCOMPLETE"]),
      item("b1", "x", "blocked", ["LISTING_INCOMPLETE"]),
      item("b1", "x", "succeeded"),
      item("b1", "x", "succeeded"),
    ];
    const f = forecastBlockers(items, [], plan({ planned_action_types: ["x"], expected_manifest_count: 100 }));
    expect(f[0].blocker_code).toBe("LISTING_INCOMPLETE");
    expect(f[0].historical_occurrences).toBe(2);
    expect(f[0].historical_rate).toBe(0.5);
    expect(f[0].expected_occurrences).toBe(50);
  });

  it("blocker output ordered by historical_occurrences desc", () => {
    const items = [
      item("b", "x", "blocked", ["A"]),
      item("b", "x", "blocked", ["A"]),
      item("b", "x", "blocked", ["B"]),
    ];
    const f = forecastBlockers(items, [], plan());
    expect(f.map((e) => e.blocker_code)).toEqual(["A", "B"]);
  });

  it("forecastRejections aggregates KPI top_rejection_reasons", () => {
    const k = [kpi(80, 2, ["screenshot_missing"]), kpi(80, 1, ["screenshot_missing", "listing_short"])];
    const f = forecastRejections(k, plan({ expected_manifest_count: 50 }));
    expect(f.find((r) => r.reason === "screenshot_missing")?.historical_occurrences).toBe(2);
    expect(f.find((r) => r.reason === "listing_short")?.historical_occurrences).toBe(1);
  });

  it("forecastManualInterventions returns 0 when no autopilot history", () => {
    const m = forecastManualInterventions([], plan());
    expect(m.historical_rate).toBe(0);
    expect(m.expected_count).toBe(0);
    expect(m.sample_size).toBe(0);
  });

  it("forecastManualInterventions computes rate × planned size", () => {
    const runs = [autoRun("r1", "safe_execute", 7, 3, 0)];
    const m = forecastManualInterventions(runs, plan({ planned_action_types: ["x"], expected_manifest_count: 20 }));
    expect(m.historical_rate).toBe(0.3);
    expect(m.expected_count).toBe(6);
  });
});

describe("STORE.OPS.PREDICTION.OS.1 — duration & queue load", () => {
  it("estimateDuration uses per-action averages when available", () => {
    const items = [
      item("b", "x", "succeeded", [], 60),
      item("b", "x", "succeeded", [], 60),
    ];
    const baselines = computeActionBaselines(items, []);
    const d = estimateDuration(baselines, plan({ planned_action_types: ["x"], expected_manifest_count: 5 }));
    expect(d.per_action[0].expected_seconds).toBe(300);
  });

  it("estimateDuration falls back to global avg for unseen action types", () => {
    const items = [item("b", "known", "succeeded", [], 120)];
    const baselines = computeActionBaselines(items, []);
    const d = estimateDuration(baselines, plan({ planned_action_types: ["unknown"], expected_manifest_count: 3 }));
    expect(d.per_action[0].expected_seconds).toBe(360);
  });

  it("estimateDuration falls back to default 90s with no samples", () => {
    const d = estimateDuration([], plan({ planned_action_types: ["x"], expected_manifest_count: 2 }));
    expect(d.per_action[0].expected_seconds).toBe(180);
  });

  it("estimateQueueLoad computes load_factor vs recent average", () => {
    const batches = [batch("b1", 50, 50, 0), batch("b2", 50, 50, 0)];
    const q = estimateQueueLoad(batches, plan({ planned_action_types: ["a", "b"], expected_manifest_count: 50 }));
    expect(q.expected_action_count).toBe(100);
    expect(q.average_recent_batch_load).toBe(50);
    expect(q.load_factor).toBe(2);
  });

  it("estimateQueueLoad returns load_factor=99 when no recent batches but planned > 0", () => {
    const q = estimateQueueLoad([], plan());
    expect(q.load_factor).toBe(99);
  });
});

describe("STORE.OPS.PREDICTION.OS.1 — confidence", () => {
  it("returns sub-baseline score on empty data", () => {
    const c = computeConfidence({ baselines: [], items: [], kpi: [], total_events: 0 });
    expect(c.score).toBeLessThan(0.5);
    expect(c.sample_size).toBe(0);
  });

  it("rises with more events", () => {
    const small = computeConfidence({ baselines: [], items: [], kpi: [], total_events: 10 });
    const big = computeConfidence({ baselines: [], items: [], kpi: [], total_events: 100 });
    expect(big.sample_size).toBeGreaterThan(small.sample_size);
  });

  it("pattern_consistency = 1 when all action success rates equal", () => {
    const items = [item("b", "x", "succeeded"), item("b", "y", "succeeded")];
    const baselines = computeActionBaselines(items, []);
    const c = computeConfidence({ baselines, items, kpi: [], total_events: 2 });
    expect(c.pattern_consistency).toBe(1);
  });

  it("data_quality reflects missing status share", () => {
    const items = [
      item("b", "x", "succeeded"),
      { ...item("b", "x", "succeeded"), status: "" } as BatchItemSnapshot,
    ];
    const c = computeConfidence({ baselines: [], items, kpi: [], total_events: 2 });
    expect(c.data_quality).toBe(0.5);
  });

  it("historical_stability is high when KPI is flat", () => {
    const c = computeConfidence({ baselines: [], items: [], kpi: [kpi(80), kpi(80), kpi(80)], total_events: 0 });
    expect(c.historical_stability).toBe(1);
  });

  it("score stays in [0,1]", () => {
    const items = Array.from({ length: 50 }, () => item("b", "x", "succeeded"));
    const baselines = computeActionBaselines(items, []);
    const c = computeConfidence({ baselines, items, kpi: [kpi(50), kpi(90)], total_events: 50 });
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(c.score).toBeLessThanOrEqual(1);
  });
});

describe("STORE.OPS.PREDICTION.OS.1 — projection", () => {
  it("returns warning when no historical data is provided", () => {
    const p = projectPrediction(input());
    expect(p.warnings).toContain("no_historical_data_available");
  });

  it("warns when planned action type has no baseline at all", () => {
    const p = projectPrediction(input({ planned: plan({ planned_action_types: ["unknown_action"] }) }));
    expect(p.warnings).toContain("no_baseline_for_planned_actions");
  });

  it("warns on low confidence", () => {
    const p = projectPrediction(input());
    expect(p.warnings).toContain("low_confidence_prediction");
  });

  it("populates explainability.used_data when data is supplied", () => {
    const p = projectPrediction(
      input({
        batches: [batch("b1", 5, 5, 0)],
        batch_items: Array.from({ length: 5 }, () => item("b1", "run_review_gate", "succeeded")),
      }),
    );
    expect(p.explainability.used_data.join(",")).toContain("store_ops_batches");
    expect(p.explainability.used_data.join(",")).toContain("store_ops_batch_items");
  });

  it("risk total stays in [0,100]", () => {
    const p = projectPrediction(
      input({
        batches: [batch("b1", 100, 50, 30, 20)],
        batch_items: Array.from({ length: 10 }, (_, i) => item("b1", "x", i % 2 === 0 ? "failed" : "succeeded")),
        kpi_history: [kpi(40, 10)],
      }),
    );
    expect(p.risk.total).toBeGreaterThanOrEqual(0);
    expect(p.risk.total).toBeLessThanOrEqual(100);
  });

  it("risk level matches threshold mapping", () => {
    const veryBad = projectPrediction(
      input({
        batches: [batch("b1", 100, 0, 100)],
        batch_items: Array.from({ length: 50 }, () => item("b1", "x", "failed")),
        kpi_history: [kpi(10, 20)],
        autopilot_runs: [autoRun("r1", "safe_execute", 0, 30, 30)],
      }),
    );
    expect(["high", "critical"]).toContain(veryBad.risk.level);
  });

  it("influence factors are returned sorted by weight desc", () => {
    const p = projectPrediction(
      input({
        batches: [batch("b1", 100, 0, 100)],
        batch_items: Array.from({ length: 30 }, () => item("b1", "x", "failed")),
      }),
    );
    const weights = p.explainability.influence_factors.map((f) => f.weight);
    const sorted = [...weights].sort((a, b) => b - a);
    expect(weights).toEqual(sorted);
  });

  it("similar_runs include batches with comparable size when planned size matches", () => {
    const p = projectPrediction(
      input({
        batches: [batch("b-near", 10, 10, 0), batch("b-far", 1000, 1000, 0)],
        planned: plan({ expected_manifest_count: 10 }),
      }),
    );
    const ids = p.explainability.similar_runs.map((s) => s.ref_id);
    expect(ids).toContain("b-near");
  });

  it("similar_runs include autopilot_run when mode matches", () => {
    const p = projectPrediction(
      input({
        autopilot_runs: [autoRun("r-mode", "safe_execute", 5, 0, 0)],
        planned: plan({ mode: "safe_execute" }),
      }),
    );
    expect(p.explainability.similar_runs.some((s) => s.ref_id === "r-mode")).toBe(true);
  });

  it("findings include outcome, queue_load, manual_intervention_forecast", () => {
    const p = projectPrediction(input());
    const kinds = new Set(p.findings.map((f) => f.kind));
    expect(kinds.has("outcome")).toBe(true);
    expect(kinds.has("queue_load")).toBe(true);
    expect(kinds.has("manual_intervention_forecast")).toBe(true);
  });

  it("findings include one risk_component per dimension", () => {
    const p = projectPrediction(input());
    const riskFindings = p.findings.filter((f) => f.kind === "risk_component");
    expect(new Set(riskFindings.map((f) => f.key))).toEqual(
      new Set(["technical", "governance", "operational", "data_quality", "capacity"]),
    );
  });

  it("projection is deterministic for identical input", () => {
    const i = input({
      batches: [batch("b1", 10, 8, 2)],
      batch_items: [item("b1", "x", "succeeded")],
      kpi_history: [kpi(85)],
    });
    const a = projectPrediction(i);
    const b = projectPrediction(i);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("regression: KPI rejections push governance risk upward", () => {
    const low = projectPrediction(input({ kpi_history: [kpi(80, 0)] }));
    const high = projectPrediction(input({ kpi_history: [kpi(80, 20)] }));
    expect(high.risk.governance).toBeGreaterThan(low.risk.governance);
  });

  it("regression: autopilot manual_count raises governance risk", () => {
    const low = projectPrediction(input({ autopilot_runs: [autoRun("r", "x", 10, 0, 0)] }));
    const high = projectPrediction(input({ autopilot_runs: [autoRun("r", "x", 0, 10, 0)] }));
    expect(high.risk.governance).toBeGreaterThan(low.risk.governance);
  });

  it("regression: latest intelligence risk_total raises operational risk", () => {
    const intelLow: IntelligenceRunSnapshot = {
      run_id: "i1",
      risk_total: 10,
      risk_level: "low",
      confidence_score: 0.5,
      evaluated_at_reference: REF_TS,
    };
    const intelHigh: IntelligenceRunSnapshot = { ...intelLow, risk_total: 90, risk_level: "critical" };
    const low = projectPrediction(input({ intelligence_runs: [intelLow] }));
    const high = projectPrediction(input({ intelligence_runs: [intelHigh] }));
    expect(high.risk.operational).toBeGreaterThan(low.risk.operational);
  });

  it("regression: bigger planned size raises capacity risk", () => {
    const small = projectPrediction(
      input({ batches: [batch("b", 10, 10, 0)], planned: plan({ expected_manifest_count: 5 }) }),
    );
    const big = projectPrediction(
      input({ batches: [batch("b", 10, 10, 0)], planned: plan({ expected_manifest_count: 200 }) }),
    );
    expect(big.risk.capacity).toBeGreaterThan(small.risk.capacity);
  });

  it("buildPredictionAudit returns compact payload", () => {
    const p = projectPrediction(input());
    const audit = buildPredictionAudit(p);
    expect(audit.feature).toBe("store_ops_prediction_os_1");
    expect(audit.run_id).toBe(p.run_id);
    expect(audit.operation_key).toBe(p.operation_key);
  });
});
