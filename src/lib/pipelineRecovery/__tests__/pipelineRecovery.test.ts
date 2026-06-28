import { describe, it, expect } from "vitest";
import {
  buildRecoverySummary,
  planPublishGateRecovery,
  planPlanningRecovery,
  planLfRepairRecovery,
  planProviderFallback,
  diagnoseStudiumLane,
  riskFor,
  RecoveryActionSchema,
  RecoveryPlanSchema,
  RecoverySummarySchema,
  RECOVERY_POLICY,
  FORBIDDEN_FIELDS,
  type RecoveryInput,
  type PackageSnapshot,
  type JobSnapshot,
  type WorkerSnapshot,
} from "../index";

const NOW = "2026-06-28T12:00:00.000Z";
const HOURS_AGO = (h: number) => new Date(Date.parse(NOW) - h * 3600_000).toISOString();

const pkg = (overrides: Partial<PackageSnapshot> = {}): PackageSnapshot => ({
  package_id: overrides.package_id ?? "00000000-0000-0000-0000-000000000001",
  status: "done",
  track: "EXAM_FIRST",
  build_progress: 100,
  integrity_passed: false,
  council_approved: false,
  council_approved_at: null,
  published_at: null,
  is_published: false,
  updated_at: HOURS_AGO(2),
  ...overrides,
});

const job = (overrides: Partial<JobSnapshot> = {}): JobSnapshot => ({
  job_type: "package_run_integrity_check",
  status: "pending",
  package_id: null,
  attempts: 0,
  max_attempts: 5,
  last_error: null,
  locked_by: null,
  updated_at: HOURS_AGO(1),
  ...overrides,
});

const worker = (overrides: Partial<WorkerSnapshot> = {}): WorkerSnapshot => ({
  worker_id: "w1",
  job_types: ["package_scaffold_learning_course"],
  last_heartbeat_at: NOW,
  ...overrides,
});

// ─── Contracts (4) ────────────────────────────────────────────────────
describe("contracts", () => {
  it("RecoveryActionSchema rejects auto_executable=true", () => {
    expect(() =>
      RecoveryActionSchema.parse({
        action_id: "x", package_id: null, action_type: "diagnose_only",
        cause: "UNKNOWN", reason: "x", steps_to_enqueue: [], metadata: {},
        risk: riskFor("UNKNOWN"), auto_executable: true,
      }),
    ).toThrow();
  });
  it("RecoveryPlanSchema accepts empty actions", () => {
    expect(() => RecoveryPlanSchema.parse({ package_id: null, status_snapshot: "x", causes: [], actions: [] })).not.toThrow();
  });
  it("RecoverySummarySchema validates a built summary", () => {
    const s = buildRecoverySummary({ now: NOW, packages: [], jobs: [], workers: [] });
    expect(() => RecoverySummarySchema.parse(s)).not.toThrow();
  });
  it("FORBIDDEN_FIELDS lists the 4 hard-blocked fields", () => {
    expect(FORBIDDEN_FIELDS).toEqual(["integrity_passed", "council_approved", "is_published", "published_at"]);
  });
});

// ─── Publish Gate (8) ─────────────────────────────────────────────────
describe("publishGateRecovery", () => {
  it("QUALITY_NOT_FINISHED when integrity_passed=false", () => {
    const plans = planPublishGateRecovery(NOW, [pkg()], []);
    expect(plans[0].causes).toContain("QUALITY_NOT_FINISHED");
    expect(plans[0].actions[0].steps_to_enqueue).toContain("run_integrity_check");
  });
  it("COUNCIL_PENDING when integrity ok but council false", () => {
    const plans = planPublishGateRecovery(NOW, [pkg({ integrity_passed: true })], []);
    expect(plans[0].causes).toContain("COUNCIL_PENDING");
    expect(plans[0].actions[0].steps_to_enqueue).toContain("quality_council");
  });
  it("AUDIT/PROJECTION pending when both true but unpublished", () => {
    const plans = planPublishGateRecovery(NOW, [pkg({ integrity_passed: true, council_approved: true })], []);
    expect(plans[0].causes).toContain("PROJECTION_PENDING");
    expect(plans[0].actions[0].action_type).toBe("diagnose_only");
  });
  it("skips fresh done packages (age below threshold)", () => {
    const plans = planPublishGateRecovery(NOW, [pkg({ updated_at: NOW })], []);
    expect(plans).toHaveLength(0);
  });
  it("skips already published", () => {
    const plans = planPublishGateRecovery(NOW, [pkg({ is_published: true })], []);
    expect(plans).toHaveLength(0);
  });
  it("mixed: two packages, two plans", () => {
    const plans = planPublishGateRecovery(NOW, [pkg({ package_id: "00000000-0000-0000-0000-000000000001" }), pkg({ package_id: "00000000-0000-0000-0000-000000000002", integrity_passed: true })], []);
    expect(plans).toHaveLength(2);
  });
  it("skips when re-audit job is already pending", () => {
    const p = pkg();
    const plans = planPublishGateRecovery(NOW, [p], [job({ package_id: p.package_id, status: "pending" })]);
    expect(plans[0].actions).toHaveLength(0);
  });
  it("idempotent: same input → same output", () => {
    const a = planPublishGateRecovery(NOW, [pkg()], []);
    const b = planPublishGateRecovery(NOW, [pkg()], []);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("NEVER produces an action that mutates integrity/council/publish", () => {
    const plans = planPublishGateRecovery(NOW, [pkg()], []);
    for (const p of plans) for (const a of p.actions) {
      expect(a.action_type).not.toMatch(/publish|approve|mark_integrity/);
      expect(JSON.stringify(a.metadata)).not.toMatch(/set_integrity|force_publish/);
    }
  });
});

// ─── Planning (7) ─────────────────────────────────────────────────────
describe("planningRecovery", () => {
  const planningPkg = (o: Partial<PackageSnapshot> = {}) =>
    pkg({ status: "planning", build_progress: 0, updated_at: HOURS_AGO(3), integrity_passed: null, council_approved: null, ...o });

  it("PLANNING_DISPATCHER_OFF when no fresh workers", () => {
    const plans = planPlanningRecovery(NOW, [planningPkg()], [], []);
    expect(plans[0].causes[0]).toBe("PLANNING_DISPATCHER_OFF");
  });
  it("PLANNING_CLAIM_LOST when workers exist but no jobs", () => {
    const plans = planPlanningRecovery(NOW, [planningPkg()], [], [worker()]);
    expect(plans[0].causes[0]).toBe("PLANNING_CLAIM_LOST");
  });
  it("PLANNING_WORKER_LOST when jobs exist but not processing", () => {
    const p = planningPkg();
    const plans = planPlanningRecovery(NOW, [p], [job({ package_id: p.package_id, status: "failed" })], [worker()]);
    expect(plans[0].causes[0]).toBe("PLANNING_WORKER_LOST");
  });
  it("skips when worker is actively processing", () => {
    const p = planningPkg();
    const plans = planPlanningRecovery(NOW, [p], [job({ package_id: p.package_id, status: "processing", locked_by: "w1" })], [worker()]);
    expect(plans[0].actions).toHaveLength(0);
  });
  it("skips when lock held", () => {
    const p = planningPkg();
    const plans = planPlanningRecovery(NOW, [p], [job({ package_id: p.package_id, status: "processing", locked_by: "w99" })], []);
    expect(plans[0].actions).toHaveLength(0);
  });
  it("skips fresh planning (below age threshold)", () => {
    const plans = planPlanningRecovery(NOW, [planningPkg({ updated_at: NOW })], [], []);
    expect(plans).toHaveLength(0);
  });
  it("skips when progress > 0", () => {
    const plans = planPlanningRecovery(NOW, [planningPkg({ build_progress: 5 })], [], []);
    expect(plans).toHaveLength(0);
  });
});

// ─── LF Anti-Loop (6) ─────────────────────────────────────────────────
describe("lfRepairRecovery", () => {
  const lfJob = (o: Partial<JobSnapshot> = {}) => job({ job_type: "package_repair_exam_pool_lf_coverage", package_id: "00000000-0000-0000-0000-0000000000aa", status: "failed", ...o });
  it("cycle 0: no plan", () => {
    expect(planLfRepairRecovery(NOW, [])).toHaveLength(0);
  });
  it("cycle 1: no plan", () => {
    expect(planLfRepairRecovery(NOW, [lfJob()])).toHaveLength(0);
  });
  it("cycle 2: stops with manual_review", () => {
    const plans = planLfRepairRecovery(NOW, [lfJob(), lfJob()]);
    expect(plans[0].actions[0].action_type).toBe("mark_manual_review_required");
  });
  it("REQUEUE_LOOP_KILLED counts as cycle", () => {
    const plans = planLfRepairRecovery(NOW, [lfJob({ status: "pending", last_error: "REQUEUE_LOOP_KILLED" }), lfJob()]);
    expect(plans).toHaveLength(1);
  });
  it("ignores non-LF jobs", () => {
    expect(planLfRepairRecovery(NOW, [job({ status: "failed", package_id: "00000000-0000-0000-0000-0000000000ab" })])).toHaveLength(0);
  });
  it("respects configured max cycles", () => {
    expect(RECOVERY_POLICY.lf_max_repair_cycles).toBe(2);
  });
});

// ─── Provider Fallback (6) ────────────────────────────────────────────
describe("providerFallback", () => {
  const provJob = (o: Partial<JobSnapshot> = {}) =>
    job({ job_type: "lesson_generate_content", package_id: "00000000-0000-0000-0000-0000000000bb", status: "failed", last_error: "PROVIDER_LOOP_GUARD: x", attempts: 5, max_attempts: 5, ...o });

  it("PROVIDER_LOOP_GUARD triggers fallback plan", () => {
    const plans = planProviderFallback(NOW, [provJob()]);
    expect(plans[0].actions[0].action_type).toBe("propose_provider_fallback");
    expect(plans[0].actions[0].metadata.fallback_model).toBe(RECOVERY_POLICY.provider_fallback_model);
  });
  it("MAX_ATTEMPTS_EXHAUSTED via attempts ≥ max_attempts triggers fallback", () => {
    const plans = planProviderFallback(NOW, [provJob({ last_error: null })]);
    expect(plans[0].causes[0]).toBe("PROVIDER_MAX_ATTEMPTS_EXHAUSTED");
  });
  it("non-allowlisted job_type → no plan", () => {
    const plans = planProviderFallback(NOW, [provJob({ job_type: "package_quality_council" })]);
    expect(plans).toHaveLength(0);
  });
  it("no error & attempts low → no plan", () => {
    const plans = planProviderFallback(NOW, [provJob({ last_error: null, attempts: 1 })]);
    expect(plans).toHaveLength(0);
  });
  it("auto_executable is always false", () => {
    const plans = planProviderFallback(NOW, [provJob()]);
    expect(plans[0].actions[0].auto_executable).toBe(false);
  });
  it("idempotent", () => {
    const a = planProviderFallback(NOW, [provJob()]);
    const b = planProviderFallback(NOW, [provJob()]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ─── Studium Lane (5) ─────────────────────────────────────────────────
describe("stuckLaneDetector (STUDIUM)", () => {
  it("STUDIUM_NO_WORKER when no studium worker fresh", () => {
    const plans = diagnoseStudiumLane(NOW, [pkg({ track: "STUDIUM", status: "planning", updated_at: HOURS_AGO(3) })], []);
    expect(plans[0].causes[0]).toBe("STUDIUM_NO_WORKER");
  });
  it("STUDIUM_ROUTING_OFF when worker exists but stuck", () => {
    const plans = diagnoseStudiumLane(NOW, [pkg({ track: "STUDIUM", status: "planning", updated_at: HOURS_AGO(3) })], [worker({ job_types: ["studium_generate"] })]);
    expect(plans[0].causes[0]).toBe("STUDIUM_ROUTING_OFF");
  });
  it("healthy → no plan", () => {
    const plans = diagnoseStudiumLane(NOW, [pkg({ track: "STUDIUM", status: "building", updated_at: NOW })], [worker({ job_types: ["studium_generate"] })]);
    expect(plans).toHaveLength(0);
  });
  it("ignores non-STUDIUM tracks", () => {
    const plans = diagnoseStudiumLane(NOW, [pkg({ track: "EXAM_FIRST", status: "planning", updated_at: HOURS_AGO(3) })], []);
    expect(plans).toHaveLength(0);
  });
  it("action_type is always diagnose_only", () => {
    const plans = diagnoseStudiumLane(NOW, [pkg({ track: "STUDIUM", status: "planning", updated_at: HOURS_AGO(3) })], []);
    expect(plans[0].actions[0].action_type).toBe("diagnose_only");
  });
});

// ─── Risk (5) ─────────────────────────────────────────────────────────
describe("recoveryRisk", () => {
  it("UNKNOWN risk has lowest confidence", () => {
    expect(riskFor("UNKNOWN").confidence).toBeLessThan(riskFor("QUALITY_NOT_FINISHED").confidence);
  });
  it("LF_REPAIR_LOOP impact is high", () => expect(riskFor("LF_REPAIR_LOOP").impact).toBe("high"));
  it("AUDIT_PENDING operator_effort is low", () => expect(riskFor("AUDIT_PENDING").operator_effort).toBe("low"));
  it("STUDIUM_NO_WORKER expected_recovery is low", () => expect(riskFor("STUDIUM_NO_WORKER").expected_recovery).toBe("low"));
  it("all risk values are bounded 0..1", () => {
    for (const c of ["QUALITY_NOT_FINISHED","COUNCIL_PENDING","AUDIT_PENDING","PROJECTION_PENDING","PLANNING_WORKER_LOST","PLANNING_DISPATCHER_OFF","PLANNING_CLAIM_LOST","LF_REPAIR_LOOP","PROVIDER_LOOP_GUARD","PROVIDER_MAX_ATTEMPTS_EXHAUSTED","STUDIUM_NO_WORKER","STUDIUM_ROUTING_OFF","UNKNOWN"] as const) {
      const r = riskFor(c);
      expect(r.risk).toBeGreaterThanOrEqual(0); expect(r.risk).toBeLessThanOrEqual(1);
      expect(r.confidence).toBeGreaterThanOrEqual(0); expect(r.confidence).toBeLessThanOrEqual(1);
      expect(r.false_positive_risk).toBeGreaterThanOrEqual(0); expect(r.false_positive_risk).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Projection (5) ───────────────────────────────────────────────────
describe("projection", () => {
  const input: RecoveryInput = {
    now: NOW,
    packages: [
      pkg({ package_id: "00000000-0000-0000-0000-000000000001" }),
      pkg({ package_id: "00000000-0000-0000-0000-000000000002", status: "planning", build_progress: 0, updated_at: HOURS_AGO(3) }),
      pkg({ package_id: "00000000-0000-0000-0000-000000000003", track: "STUDIUM", status: "planning", updated_at: HOURS_AGO(5) }),
    ],
    jobs: [
      job({ job_type: "lesson_generate_content", package_id: "00000000-0000-0000-0000-000000000099", status: "failed", last_error: "PROVIDER_LOOP_GUARD", attempts: 5, max_attempts: 5 }),
      job({ job_type: "package_repair_exam_pool_lf_coverage", package_id: "00000000-0000-0000-0000-00000000aabb", status: "failed" }),
      job({ job_type: "package_repair_exam_pool_lf_coverage", package_id: "00000000-0000-0000-0000-00000000aabb", status: "failed" }),
    ],
    workers: [],
  };
  const summary = buildRecoverySummary(input);

  it("aggregates done_pending_count", () => expect(summary.done_pending_count).toBeGreaterThanOrEqual(1));
  it("aggregates stuck_planning_count", () => expect(summary.stuck_planning_count).toBeGreaterThanOrEqual(1));
  it("aggregates lf_loop_count", () => expect(summary.lf_loop_count).toBeGreaterThanOrEqual(1));
  it("aggregates provider_loop_count", () => expect(summary.provider_loop_count).toBeGreaterThanOrEqual(1));
  it("pipeline_health is critical when STUDIUM routing issues exist", () =>
    expect(summary.pipeline_health).toBe("critical"));
});

// ─── Forbidden Actions (4) ────────────────────────────────────────────
describe("forbidden actions", () => {
  it("publish gate never proposes mark_integrity / force_publish action types", () => {
    const plans = planPublishGateRecovery(NOW, [pkg()], []);
    for (const p of plans) for (const a of p.actions) {
      expect(a.action_type).not.toBe("mark_manual_review_required" as never);
      expect(["enqueue_done_reaudit", "diagnose_only"]).toContain(a.action_type);
    }
  });
  it("planning recovery only emits restart_planning", () => {
    const plans = planPlanningRecovery(NOW, [pkg({ status: "planning", build_progress: 0, updated_at: HOURS_AGO(3) })], [], []);
    for (const p of plans) for (const a of p.actions) {
      expect(a.action_type).toBe("restart_planning");
    }
  });
  it("provider fallback only proposes — never executes", () => {
    const plans = planProviderFallback(NOW, [job({ job_type: "lesson_generate_content", package_id: "00000000-0000-0000-0000-0000000000cc", status: "failed", last_error: "PROVIDER_LOOP_GUARD", attempts: 5, max_attempts: 5 })]);
    expect(plans[0].actions[0].auto_executable).toBe(false);
  });
  it("studium detector is diagnose_only", () => {
    const plans = diagnoseStudiumLane(NOW, [pkg({ track: "STUDIUM", status: "planning", updated_at: HOURS_AGO(3) })], []);
    expect(plans[0].actions[0].action_type).toBe("diagnose_only");
  });
});
