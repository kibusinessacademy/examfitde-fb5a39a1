/**
 * STORE.OPS.INTELLIGENCE.OS.1 — Pure SSOT tests.
 * Determinism, analyzer correctness, clustering, risk, confidence, recommendations, projection.
 */
import { describe, it, expect } from "vitest";
import {
  actionSuccessRates,
  averageBatchRuntimeSeconds,
  computeTrends,
  manualInterventions,
  modeSuccessRates,
  recurringRiskPatterns,
  topBlockers,
  topFailures,
  topRejections,
} from "@/lib/storeOpsIntelligence/analyzer";
import { clusterBlockers } from "@/lib/storeOpsIntelligence/blocker-clustering";
import { computeConfidence } from "@/lib/storeOpsIntelligence/confidence";
import {
  aggregateRisk,
  governanceRisk,
  operationalRisk,
  technicalRisk,
} from "@/lib/storeOpsIntelligence/risk-score";
import {
  ALLOWED_RECOMMENDATIONS,
  FORBIDDEN_RECOMMENDATIONS,
  type AutopilotActionSnapshot,
  type AutopilotRunSnapshot,
  type BatchItemSnapshot,
  type BatchSnapshot,
  type IntelligenceInput,
  type KpiHistorySnapshot,
} from "@/lib/storeOpsIntelligence/contracts";
import {
  assertNoForbidden,
  filterAllowedRecommendations,
  isAllowedRecommendation,
  isForbiddenRecommendation,
} from "@/lib/storeOpsIntelligence/intelligence-policy";
import { buildRecommendations } from "@/lib/storeOpsIntelligence/recommendation-engine";
import { projectIntelligence } from "@/lib/storeOpsIntelligence/projection";
import { buildIntelligenceAudit } from "@/lib/storeOpsIntelligence/audit";

const REF = "2026-06-27T10:00:00.000Z";

function makeItem(
  partial: Partial<BatchItemSnapshot> & Pick<BatchItemSnapshot, "manifest_id" | "action_type" | "status">,
): BatchItemSnapshot {
  return { batch_id: "b1", blocker_codes: [], ...partial };
}
function makeAction(
  partial: Partial<AutopilotActionSnapshot> & Pick<AutopilotActionSnapshot, "manifest_id" | "action_type" | "status">,
): AutopilotActionSnapshot {
  return { run_id: "r1", blocker_codes: [], ...partial };
}
function makeRun(p: Partial<AutopilotRunSnapshot> = {}): AutopilotRunSnapshot {
  return {
    run_id: p.run_id ?? "r1",
    mode: p.mode ?? "recommend_only",
    state: p.state ?? "planned",
    risk_score: p.risk_score ?? 10,
    risk_level: p.risk_level ?? "low",
    safe_count: p.safe_count ?? 5,
    manual_count: p.manual_count ?? 0,
    blocked_count: p.blocked_count ?? 0,
    succeeded: p.succeeded ?? 5,
    failed: p.failed ?? 0,
    evaluated_at_reference: p.evaluated_at_reference ?? REF,
  };
}
function makeBatch(p: Partial<BatchSnapshot> = {}): BatchSnapshot {
  return {
    batch_id: p.batch_id ?? "b1",
    state: p.state ?? "completed",
    total: p.total ?? 10,
    succeeded: p.succeeded ?? 8,
    failed: p.failed ?? 1,
    blocked: p.blocked ?? 1,
    skipped: p.skipped ?? 0,
    created_at_reference: p.created_at_reference ?? REF,
  };
}
function makeKpi(p: Partial<KpiHistorySnapshot> = {}): KpiHistorySnapshot {
  return {
    snapshot_id: p.snapshot_id ?? "k1",
    health_score: p.health_score ?? 80,
    blocked_count: p.blocked_count ?? 0,
    rejected_count: p.rejected_count ?? 0,
    build_success_rate: p.build_success_rate ?? 1,
    top_rejection_reasons: p.top_rejection_reasons ?? [],
    top_blockers: p.top_blockers ?? [],
    created_at_reference: p.created_at_reference ?? REF,
  };
}

describe("STORE.OPS.INTELLIGENCE.OS.1 — policy", () => {
  it("exposes a non-empty allow-list", () => {
    expect(ALLOWED_RECOMMENDATIONS.length).toBeGreaterThan(0);
  });
  it("forbidden list contains publish / submit / rollout", () => {
    expect(FORBIDDEN_RECOMMENDATIONS).toContain("publish");
    expect(FORBIDDEN_RECOMMENDATIONS).toContain("submit_for_review");
    expect(FORBIDDEN_RECOMMENDATIONS).toContain("production_rollout");
  });
  it("isAllowedRecommendation accepts allow-listed codes", () => {
    expect(isAllowedRecommendation("RUN_SIMULATION_FIRST")).toBe(true);
  });
  it("isAllowedRecommendation rejects unknown codes", () => {
    expect(isAllowedRecommendation("RANDOM_CODE")).toBe(false);
  });
  it("isForbiddenRecommendation flags forbidden codes", () => {
    expect(isForbiddenRecommendation("publish")).toBe(true);
    expect(isForbiddenRecommendation("RISK_ACCEPTABLE")).toBe(false);
  });
  it("assertNoForbidden throws on forbidden codes", () => {
    expect(() => assertNoForbidden(["publish"])).toThrow(/forbidden_recommendation/);
  });
  it("assertNoForbidden allows allow-listed codes", () => {
    expect(() => assertNoForbidden(["RISK_ACCEPTABLE", "RUN_SIMULATION_FIRST"])).not.toThrow();
  });
  it("filterAllowedRecommendations strips forbidden + unknown", () => {
    const { allowed, rejected } = filterAllowedRecommendations([
      { code: "RUN_SIMULATION_FIRST" },
      { code: "publish" },
      { code: "FOO" },
    ]);
    expect(allowed.map((a) => a.code)).toEqual(["RUN_SIMULATION_FIRST"]);
    expect(rejected.length).toBe(2);
  });
});

describe("STORE.OPS.INTELLIGENCE.OS.1 — analyzer", () => {
  const items: BatchItemSnapshot[] = [
    makeItem({ manifest_id: "m1", action_type: "generate_listing", status: "failed", blocker_codes: ["MISSING_LISTING"] }),
    makeItem({ manifest_id: "m2", action_type: "generate_listing", status: "succeeded" }),
    makeItem({ manifest_id: "m3", action_type: "run_review_gate", status: "blocked", blocker_codes: ["REVIEW_GATE_BLOCKED", "MISSING_LISTING"] }),
  ];
  const actions: AutopilotActionSnapshot[] = [
    makeAction({ manifest_id: "m1", action_type: "generate_listing", status: "failed", blocker_codes: ["MISSING_LISTING"] }),
    makeAction({ manifest_id: "m2", action_type: "run_review_gate", status: "succeeded" }),
  ];

  it("topBlockers ranks by frequency", () => {
    const r = topBlockers(items, actions);
    expect(r[0].key).toBe("MISSING_LISTING");
    expect(r[0].count).toBe(3);
  });
  it("topFailures groups by action_type", () => {
    const r = topFailures(items, actions);
    expect(r[0].key).toBe("generate_listing");
    expect(r[0].count).toBe(2);
  });
  it("topRejections aggregates kpi rejection reasons", () => {
    const r = topRejections([makeKpi({ top_rejection_reasons: ["broken_metadata", "broken_metadata", "missing_privacy"] })]);
    expect(r[0].key).toBe("broken_metadata");
    expect(r[0].count).toBe(2);
  });
  it("manualInterventions tallies manual actions by mode", () => {
    const runs = [makeRun({ mode: "safe_execute", manual_count: 3 }), makeRun({ mode: "recommend_only", manual_count: 1 })];
    const r = manualInterventions(runs);
    expect(r.find((x) => x.key === "safe_execute")?.count).toBe(3);
    expect(r.find((x) => x.key === "recommend_only")?.count).toBe(1);
  });
  it("recurringRiskPatterns counts risk levels", () => {
    const r = recurringRiskPatterns([makeRun({ risk_level: "high" }), makeRun({ risk_level: "high" }), makeRun({ risk_level: "low" })]);
    expect(r[0].key).toBe("high");
  });
  it("actionSuccessRates computes per-action stats", () => {
    const r = actionSuccessRates(items, actions);
    const gl = r.find((x) => x.action_type === "generate_listing")!;
    expect(gl.total).toBe(3);
    expect(gl.failed).toBe(2);
    expect(gl.succeeded).toBe(1);
    expect(gl.success_rate).toBeCloseTo(1 / 3);
  });
  it("modeSuccessRates aggregates across runs", () => {
    const r = modeSuccessRates([makeRun({ mode: "recommend_only", safe_count: 3, succeeded: 2 })]);
    expect(r[0].mode).toBe("recommend_only");
    expect(r[0].total).toBe(3);
  });
  it("averageBatchRuntimeSeconds returns null for empty batches", () => {
    expect(averageBatchRuntimeSeconds([])).toBeNull();
  });
  it("averageBatchRuntimeSeconds returns proxy average", () => {
    expect(averageBatchRuntimeSeconds([makeBatch({ total: 10 }), makeBatch({ total: 20 })])).toBe(15);
  });
  it("computeTrends emits health_score delta when ≥2 kpi snapshots", () => {
    const r = computeTrends(
      [
        makeKpi({ snapshot_id: "a", health_score: 80, created_at_reference: "2026-01-01" }),
        makeKpi({ snapshot_id: "b", health_score: 60, created_at_reference: "2026-02-01" }),
      ],
      [],
    );
    const t = r.find((x) => x.metric === "health_score")!;
    expect(t.delta).toBe(-20);
    expect(t.direction).toBe("down");
  });
  it("computeTrends emits risk_score delta when ≥2 runs", () => {
    const r = computeTrends(
      [],
      [
        makeRun({ risk_score: 10, evaluated_at_reference: "2026-01-01" }),
        makeRun({ risk_score: 40, evaluated_at_reference: "2026-02-01" }),
      ],
    );
    const t = r.find((x) => x.metric === "risk_score")!;
    expect(t.direction).toBe("up");
  });
  it("analyzer is deterministic", () => {
    const a = topBlockers(items, actions);
    const b = topBlockers(items, actions);
    expect(a).toEqual(b);
  });
});

describe("STORE.OPS.INTELLIGENCE.OS.1 — clustering", () => {
  it("groups identical blocker code sets", () => {
    const items: BatchItemSnapshot[] = [
      makeItem({ manifest_id: "m1", action_type: "x", status: "blocked", blocker_codes: ["A", "B"] }),
      makeItem({ manifest_id: "m2", action_type: "x", status: "blocked", blocker_codes: ["B", "A"] }),
      makeItem({ manifest_id: "m3", action_type: "y", status: "blocked", blocker_codes: ["C"] }),
    ];
    const r = clusterBlockers(items, []);
    expect(r[0].cluster_key).toBe("A|B");
    expect(r[0].occurrences).toBe(2);
    expect(r[0].affected_manifest_count).toBe(2);
  });
  it("ignores rows without blockers", () => {
    expect(clusterBlockers([makeItem({ manifest_id: "m1", action_type: "x", status: "succeeded" })], [])).toEqual([]);
  });
  it("clustering is deterministic", () => {
    const items: BatchItemSnapshot[] = [
      makeItem({ manifest_id: "m1", action_type: "x", status: "blocked", blocker_codes: ["A"] }),
      makeItem({ manifest_id: "m2", action_type: "x", status: "blocked", blocker_codes: ["A"] }),
    ];
    expect(clusterBlockers(items, [])).toEqual(clusterBlockers(items, []));
  });
});

describe("STORE.OPS.INTELLIGENCE.OS.1 — risk", () => {
  it("technicalRisk scales with action failures", () => {
    const r = technicalRisk(
      [{ action_type: "a", total: 10, succeeded: 0, failed: 10, blocked: 0, success_rate: 0 }],
      [makeKpi({ build_success_rate: 0 })],
    );
    expect(r).toBeGreaterThan(50);
  });
  it("technicalRisk is 0 with perfect history", () => {
    const r = technicalRisk(
      [{ action_type: "a", total: 10, succeeded: 10, failed: 0, blocked: 0, success_rate: 1 }],
      [makeKpi({ build_success_rate: 1 })],
    );
    expect(r).toBe(0);
  });
  it("governanceRisk grows with manual + blocked + rejections", () => {
    const r = governanceRisk(
      [makeRun({ safe_count: 0, manual_count: 5, blocked_count: 5 })],
      [makeKpi({ rejected_count: 10 })],
    );
    expect(r).toBeGreaterThanOrEqual(50);

  });
  it("operationalRisk grows with batch failures", () => {
    const r = operationalRisk([makeBatch({ total: 10, succeeded: 0, failed: 10 })], []);
    expect(r).toBeGreaterThan(40);
  });
  it("aggregateRisk computes level=low for low totals", () => {
    expect(aggregateRisk(0, 0, 0).level).toBe("low");
  });
  it("aggregateRisk computes level=critical at high totals", () => {
    expect(aggregateRisk(100, 100, 100).level).toBe("critical");
  });
  it("aggregateRisk weights deterministic", () => {
    const a = aggregateRisk(50, 50, 50);
    const b = aggregateRisk(50, 50, 50);
    expect(a).toEqual(b);
  });
});

describe("STORE.OPS.INTELLIGENCE.OS.1 — confidence", () => {
  it("returns explainable breakdown", () => {
    const c = computeConfidence({
      items: [makeItem({ manifest_id: "m1", action_type: "x", status: "succeeded" })],
      runs: [makeRun({})],
      actions: [{ action_type: "x", total: 5, succeeded: 5, failed: 0, blocked: 0, success_rate: 1 }],
    });
    expect(c.sample_size).toBeGreaterThanOrEqual(0);
    expect(c.score).toBeGreaterThan(0);
    expect(c.score).toBeLessThanOrEqual(1);
  });
  it("low data → low sample_size", () => {
    const c = computeConfidence({ items: [], runs: [], actions: [] });
    expect(c.sample_size).toBe(0);
  });
  it("consistency 1 when all actions equal success_rate", () => {
    const c = computeConfidence({
      items: [],
      runs: [],
      actions: [
        { action_type: "a", total: 5, succeeded: 5, failed: 0, blocked: 0, success_rate: 1 },
        { action_type: "b", total: 5, succeeded: 5, failed: 0, blocked: 0, success_rate: 1 },
      ],
    });
    expect(c.consistency).toBe(1);
  });
});

describe("STORE.OPS.INTELLIGENCE.OS.1 — recommendations", () => {
  const baseArgs = () => ({
    risk: aggregateRisk(0, 0, 0),
    confidence: computeConfidence({ items: [], runs: [], actions: [] }),
    topBlockers: [] as ReturnType<typeof topBlockers>,
    topFailures: [] as ReturnType<typeof topFailures>,
    actionStats: [] as ReturnType<typeof actionSuccessRates>,
    runs: [] as AutopilotRunSnapshot[],
    batches: [] as BatchSnapshot[],
    clusters: [] as ReturnType<typeof clusterBlockers>,
    trends: [] as ReturnType<typeof computeTrends>,
  });

  it("returns NO_ACTION_REQUIRED when no signal", () => {
    const r = buildRecommendations(baseArgs());
    expect(r.map((x) => x.code)).toContain("NO_ACTION_REQUIRED");
  });
  it("emits DISABLE_AUTOPILOT and ENABLE_MAINTENANCE_MODE on critical risk", () => {
    const args = baseArgs();
    args.risk = aggregateRisk(100, 100, 100);
    const r = buildRecommendations(args);
    expect(r.map((x) => x.code)).toContain("DISABLE_AUTOPILOT");
    expect(r.map((x) => x.code)).toContain("ENABLE_MAINTENANCE_MODE");
  });
  it("emits RUN_SIMULATION_FIRST on high risk", () => {
    const args = baseArgs();
    args.risk = aggregateRisk(70, 60, 60);
    const r = buildRecommendations(args);
    expect(r.map((x) => x.code)).toContain("RUN_SIMULATION_FIRST");
  });
  it("emits INVESTIGATE_RECURRING_BLOCKER when cluster ≥3", () => {
    const args = baseArgs();
    args.clusters = [{ cluster_key: "A|B", blocker_codes: ["A", "B"], occurrences: 5, affected_manifest_count: 4, affected_action_types: ["x"] }];
    const r = buildRecommendations(args);
    expect(r.map((x) => x.code)).toContain("INVESTIGATE_RECURRING_BLOCKER");
  });
  it("emits REDUCE_BATCH_SIZE for large failing batches", () => {
    const args = baseArgs();
    args.batches = [makeBatch({ batch_id: "big", total: 30, failed: 5, blocked: 0 })];
    const r = buildRecommendations(args);
    expect(r.map((x) => x.code)).toContain("REDUCE_BATCH_SIZE");
  });
  it("emits RECALCULATE_KPI when risk trends up", () => {
    const args = baseArgs();
    args.trends = [{ metric: "risk_score", previous: 10, current: 40, delta: 30, direction: "up" }];
    const r = buildRecommendations(args);
    expect(r.map((x) => x.code)).toContain("RECALCULATE_KPI");
  });
  it("never emits forbidden recommendation codes", () => {
    const r = buildRecommendations({ ...baseArgs(), risk: aggregateRisk(100, 100, 100) });
    for (const rec of r) {
      expect(FORBIDDEN_RECOMMENDATIONS).not.toContain(rec.code as any);
    }
  });
  it("recommendations carry rationale + used_data + patterns + risk + confidence", () => {
    const r = buildRecommendations(baseArgs());
    for (const rec of r) {
      expect(typeof rec.rationale).toBe("string");
      expect(Array.isArray(rec.used_data)).toBe(true);
      expect(Array.isArray(rec.detected_patterns)).toBe(true);
      expect(rec.risk).toBeDefined();
      expect(rec.confidence).toBeDefined();
    }
  });
  it("dedups by code", () => {
    const r = buildRecommendations({ ...baseArgs(), risk: aggregateRisk(100, 100, 100) });
    const codes = r.map((x) => x.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("STORE.OPS.INTELLIGENCE.OS.1 — projection", () => {
  const makeInput = (overrides: Partial<IntelligenceInput> = {}): IntelligenceInput => ({
    run_id: "i1",
    evaluated_at_reference: REF,
    batches: [makeBatch()],
    batch_items: [makeItem({ manifest_id: "m1", action_type: "generate_listing", status: "succeeded" })],
    kpi_history: [makeKpi()],
    autopilot_runs: [makeRun()],
    autopilot_actions: [makeAction({ manifest_id: "m1", action_type: "generate_listing", status: "succeeded" })],
    ...overrides,
  });
  it("projection is deterministic for identical input", () => {
    const a = projectIntelligence(makeInput());
    const b = projectIntelligence(makeInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("includes warning on empty history", () => {
    const p = projectIntelligence({
      run_id: "i2",
      evaluated_at_reference: REF,
      batches: [],
      batch_items: [],
      kpi_history: [],
      autopilot_runs: [],
      autopilot_actions: [],
    });
    expect(p.warnings).toContain("no_historical_data");
  });
  it("emits a finding per category", () => {
    const input = makeInput({
      batch_items: [makeItem({ manifest_id: "m1", action_type: "x", status: "failed", blocker_codes: ["A"] })],
      kpi_history: [makeKpi({ top_rejection_reasons: ["broken"] })],
    });
    const p = projectIntelligence(input);
    expect(p.findings.some((f) => f.kind === "top_blocker")).toBe(true);
    expect(p.findings.some((f) => f.kind === "top_failure")).toBe(true);
    expect(p.findings.some((f) => f.kind === "top_rejection")).toBe(true);
    expect(p.findings.some((f) => f.kind === "action_success")).toBe(true);
    expect(p.findings.some((f) => f.kind === "recommendation")).toBe(true);
  });
  it("preserves run_id and evaluated_at_reference", () => {
    const p = projectIntelligence(makeInput({ run_id: "abc" }));
    expect(p.run_id).toBe("abc");
    expect(p.evaluated_at_reference).toBe(REF);
  });
  it("recommendation findings only allow-listed codes", () => {
    const p = projectIntelligence(makeInput());
    for (const f of p.findings.filter((x) => x.kind === "recommendation")) {
      expect(ALLOWED_RECOMMENDATIONS).toContain(f.key as any);
    }
  });
  it("audit payload omits secrets and arrays summarize", () => {
    const p = projectIntelligence(makeInput());
    const a = buildIntelligenceAudit(p);
    expect(a.feature).toBe("STORE.OPS.INTELLIGENCE.OS.1");
    expect(JSON.stringify(a)).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|publish|submitForReview/);
  });
  it("risk and confidence are bounded", () => {
    const p = projectIntelligence(makeInput());
    expect(p.risk.total).toBeGreaterThanOrEqual(0);
    expect(p.risk.total).toBeLessThanOrEqual(100);
    expect(p.confidence.score).toBeGreaterThanOrEqual(0);
    expect(p.confidence.score).toBeLessThanOrEqual(1);
  });
});
