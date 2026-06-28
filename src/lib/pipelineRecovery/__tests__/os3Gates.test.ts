/**
 * PIPELINE.RECOVERY.OS.3 — Hard Gate Tests
 *
 * Covers:
 *  1. skipped_due_to_quarantine semantics (quarantineGuard)
 *  2. Diagnosis for package_scaffold_learning_course pending > 60min
 *  3. No-Progress lock: reaudit failed + no fix → lock_bronze_review
 *  4. Forbidden-field guard: OS.3 must not mutate publish/approval flags
 */
import { describe, it, expect } from "vitest";
import {
  evaluateQuarantine,
  isQuarantineBlocking,
  QUARANTINE_BLOCK_REASONS,
} from "../quarantineGuard";
import {
  diagnosePlanningJob,
  isRestartSafe,
  type PlanningJobRow,
  type WorkerHeartbeatRow,
} from "../planningDiagnosis";
import { evaluateQualityNoProgress } from "../qualityNoProgress";
import { FORBIDDEN_FIELDS } from "../recoveryPolicy";

// ─────────────────────────────────────────────────────────────
// 1) QUARANTINE GATE: skipped_due_to_quarantine
// ─────────────────────────────────────────────────────────────
describe("OS.3 / quarantineGuard — skipped_due_to_quarantine", () => {
  it("blocks LF run when LF_REPAIR_LOOP is under_review", () => {
    expect(
      isQuarantineBlocking({ reason_code: "LF_REPAIR_LOOP", status: "under_review" }),
    ).toBe(true);
  });

  it("does NOT block when ledger entry is cleared/released", () => {
    expect(
      isQuarantineBlocking({ reason_code: "LF_REPAIR_LOOP", status: "released" }),
    ).toBe(false);
    expect(
      isQuarantineBlocking({ reason_code: "QUALITY_NO_PROGRESS", status: "cleared" }),
    ).toBe(false);
  });

  it("ignores non-blocking reason codes", () => {
    expect(
      isQuarantineBlocking({ reason_code: "NEEDS_HUMAN_REVIEW", status: "under_review" }),
    ).toBe(false);
  });

  it("evaluateQuarantine returns matched rows scoped to packageId", () => {
    const ledger = [
      { package_id: "pkg-A", reason_code: "LF_REPAIR_LOOP", status: "under_review" },
      { package_id: "pkg-A", reason_code: "QUALITY_NO_PROGRESS", status: "under_review" },
      { package_id: "pkg-B", reason_code: "LF_REPAIR_LOOP", status: "under_review" },
      { package_id: "pkg-A", reason_code: "LF_REPAIR_LOOP", status: "released" },
    ];
    const dec = evaluateQuarantine("pkg-A", ledger);
    expect(dec.blocked).toBe(true);
    expect(dec.matched.map((m) => m.reason_code).sort()).toEqual([
      "LF_REPAIR_LOOP",
      "QUALITY_NO_PROGRESS",
    ]);
  });

  it("includes all four canonical blocking reasons", () => {
    expect([...QUARANTINE_BLOCK_REASONS].sort()).toEqual(
      [
        "LF_REPAIR_LOOP",
        "MAX_ATTEMPTS_EXHAUSTED",
        "PROVIDER_LOOP_GUARD",
        "QUALITY_NO_PROGRESS",
      ].sort(),
    );
  });
});

// ─────────────────────────────────────────────────────────────
// 2) PLANNING DIAGNOSIS: pending > 60min
// ─────────────────────────────────────────────────────────────
const NOW = "2026-06-28T12:00:00.000Z";
const STUCK_61M_AGO = "2026-06-28T10:59:00.000Z"; // > 60min
const FRESH_2M_AGO = "2026-06-28T11:58:00.000Z";

const baseJob = (overrides: Partial<PlanningJobRow> = {}): PlanningJobRow => ({
  id: "job-1",
  package_id: "pkg-1",
  job_type: "package_scaffold_learning_course",
  status: "pending",
  worker_pool: "default",
  started_at: null,
  last_heartbeat_at: null,
  updated_at: STUCK_61M_AGO,
  ...overrides,
});

describe("OS.3 / planningDiagnosis — package_scaffold_learning_course pending > 60min", () => {
  it("HEALTHY_BUT_PENDING + restart_safe when worker is fresh", () => {
    const workers: WorkerHeartbeatRow[] = [{
      worker_id: "w1",
      job_types: ["package_scaffold_learning_course"],
      worker_pool: "default",
      last_heartbeat_at: FRESH_2M_AGO,
    }];
    const d = diagnosePlanningJob({ now: NOW, job: baseJob(), workers, policy: null, quarantine: null });
    expect(d.cause).toBe("HEALTHY_BUT_PENDING");
    expect(d.restart_safe).toBe(true);
    expect(isRestartSafe(d.cause)).toBe(true);
  });

  it("DISPATCHER_OFF + NOT restart_safe when no worker handles the job_type", () => {
    const d = diagnosePlanningJob({ now: NOW, job: baseJob(), workers: [], policy: null, quarantine: null });
    expect(d.cause).toBe("DISPATCHER_OFF");
    expect(d.restart_safe).toBe(false);
  });

  it("WORKER_HEARTBEAT_STALE when all eligible workers are stale > 10min", () => {
    const workers: WorkerHeartbeatRow[] = [{
      worker_id: "w1",
      job_types: ["package_scaffold_learning_course"],
      worker_pool: "default",
      last_heartbeat_at: "2026-06-28T11:30:00.000Z", // 30m old
    }];
    const d = diagnosePlanningJob({ now: NOW, job: baseJob(), workers, policy: null, quarantine: null });
    expect(d.cause).toBe("WORKER_HEARTBEAT_STALE");
    expect(d.restart_safe).toBe(false);
  });

  it("JOB_TYPE_QUARANTINED hard-blocks restart", () => {
    const d = diagnosePlanningJob({
      now: NOW, job: baseJob(), workers: [], policy: null,
      quarantine: { job_type: "package_scaffold_learning_course", status: "quarantined" },
    });
    expect(d.cause).toBe("JOB_TYPE_QUARANTINED");
    expect(d.restart_safe).toBe(false);
  });

  it("POOL_MISMATCH when queue.worker_pool ≠ policy.worker_pool", () => {
    const d = diagnosePlanningJob({
      now: NOW,
      job: baseJob({ worker_pool: "default" }),
      workers: [],
      policy: { job_type: "package_scaffold_learning_course", worker_pool: "scaffold-heavy" },
      quarantine: null,
    });
    expect(d.cause).toBe("POOL_MISMATCH");
    expect(d.restart_safe).toBe(false);
  });

  it("CLAIM_LOST + restart_safe for processing job without heartbeat >30min", () => {
    const d = diagnosePlanningJob({
      now: NOW,
      job: baseJob({ status: "processing", last_heartbeat_at: "2026-06-28T11:00:00.000Z" }),
      workers: [{
        worker_id: "w1", job_types: ["package_scaffold_learning_course"],
        worker_pool: "default", last_heartbeat_at: FRESH_2M_AGO,
      }],
      policy: null, quarantine: null,
    });
    expect(d.cause).toBe("CLAIM_LOST");
    expect(d.restart_safe).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 3) NO-PROGRESS: reaudit failed + no content fix → lock
// ─────────────────────────────────────────────────────────────
describe("OS.3 / qualityNoProgress — reaudit failed + no fix → lock_bronze_review", () => {
  const TWO_DAYS_AGO = "2026-06-26T12:00:00.000Z";
  const YESTERDAY = "2026-06-27T12:00:00.000Z";

  it("LOCKS when last reaudit failed >24h ago AND no fix occurred since", () => {
    const dec = evaluateQualityNoProgress({
      now: NOW,
      package_id: "pkg-x",
      reaudit_attempts: [{ package_id: "pkg-x", executed_at: TWO_DAYS_AGO, verification_status: "verified_no_change" }],
      fix_signals: [{ package_id: "pkg-x", occurred_at: "2026-06-20T00:00:00.000Z", kind: "content_fix" }],
    });
    expect(dec.lock).toBe(true);
    expect(dec.reason).toBe("no_fix_since_last_reaudit");
  });

  it("DOES NOT lock when a content_fix occurred after the last reaudit", () => {
    const dec = evaluateQualityNoProgress({
      now: NOW,
      package_id: "pkg-x",
      reaudit_attempts: [{ package_id: "pkg-x", executed_at: TWO_DAYS_AGO }],
      fix_signals: [{ package_id: "pkg-x", occurred_at: YESTERDAY, kind: "content_fix" }],
    });
    expect(dec.lock).toBe(false);
    expect(dec.reason).toBe("fix_signal_after_last_reaudit");
  });

  it("LOCKS (rate-limit) when last reaudit was <24h ago", () => {
    const dec = evaluateQualityNoProgress({
      now: NOW,
      package_id: "pkg-x",
      reaudit_attempts: [{ package_id: "pkg-x", executed_at: YESTERDAY }],
      fix_signals: [],
    });
    expect(dec.lock).toBe(true);
    expect(dec.reason).toBe("reaudit_too_recent");
  });

  it("DOES NOT lock first-ever reaudit", () => {
    const dec = evaluateQualityNoProgress({
      now: NOW,
      package_id: "pkg-x",
      reaudit_attempts: [],
      fix_signals: [],
    });
    expect(dec.lock).toBe(false);
    expect(dec.reason).toBe("no_previous_reaudit");
  });
});

// ─────────────────────────────────────────────────────────────
// 4) FORBIDDEN-FIELD GUARD: OS.3 must not mutate publish/approval flags
// ─────────────────────────────────────────────────────────────
describe("OS.3 / FORBIDDEN_FIELDS guard", () => {
  it("declares publish/approval flags as forbidden", () => {
    expect([...FORBIDDEN_FIELDS].sort()).toEqual(
      ["council_approved", "integrity_passed", "is_published", "published_at"].sort(),
    );
  });

  it("rejects any payload that touches a forbidden field", () => {
    const safePatch = { status: "queued", build_progress: 12 };
    const unsafePatch = { is_published: true };
    const violates = (p: Record<string, unknown>) =>
      Object.keys(p).some((k) => (FORBIDDEN_FIELDS as readonly string[]).includes(k));
    expect(violates(safePatch)).toBe(false);
    expect(violates(unsafePatch)).toBe(true);
  });
});
