import { describe, it, expect } from "vitest";
import {
  project, buildJobTypeKpis, buildActionQueue, summarizeDlq,
  PROJECTOR_VERSION, type ProjInputs,
} from "../../../supabase/functions/_shared/pipelineHealth/index.ts";

const baseInputs = (over: Partial<ProjInputs> = {}): ProjInputs => ({
  kpis: [{
    job_type: "package_run_integrity_check",
    pending: 5, processing: 1, completed: 100, failed: 5, cancelled: 10, blocked: 0,
    total: 121, avg_fail_attempts: 1.5, last_activity: "2026-06-27T10:00:00Z",
  }],
  stuck: [],
  dlq: [],
  pending_age: [],
  now_iso: "2026-06-27T12:00:00Z",
  ...over,
});

describe("pipelineHealth — KPI build", () => {
  it("computes ratios deterministically", () => {
    const k = buildJobTypeKpis(baseInputs().kpis)[0];
    expect(k.success_rate).toBe(Math.round((100 / 115) * 1000) / 1000);
    expect(k.cancel_ratio).toBe(Math.round((10 / 121) * 1000) / 1000);
  });
  it("classifies red on high cancel ratio", () => {
    const k = buildJobTypeKpis([{
      ...baseInputs().kpis[0], cancelled: 80, completed: 10, failed: 5, total: 100,
    }])[0];
    expect(k.health).toBe("red");
  });
  it("classifies green on healthy mix", () => {
    expect(buildJobTypeKpis(baseInputs().kpis)[0].health).toBe("green");
  });
  it("handles zero total", () => {
    const k = buildJobTypeKpis([{
      ...baseInputs().kpis[0], total: 0, completed: 0, failed: 0, cancelled: 0,
    }])[0];
    expect(k.success_rate).toBe(0);
    expect(k.health).toBe("yellow");
  });
});

describe("pipelineHealth — action queue", () => {
  it("ranks STUCK_RUNNING at top", () => {
    const p = project(baseInputs({
      stuck: [{ id: "abc12345", worker_pool: "p", job_type: "X", running_for_seconds: 2400, attempts: 3, last_error: null }],
    }));
    expect(p.action_queue[0].code).toBe("STUCK_RUNNING");
    expect(p.action_queue[0].severity).toBe("high");
  });
  it("flags CANCEL_LOOP only above threshold", () => {
    const p = project(baseInputs({
      kpis: [{ ...baseInputs().kpis[0], total: 100, cancelled: 80, completed: 10, failed: 10 }],
    }));
    expect(p.action_queue.some((a) => a.code === "CANCEL_LOOP")).toBe(true);
  });
  it("skips CANCEL_LOOP when total < 20", () => {
    const p = project(baseInputs({
      kpis: [{ ...baseInputs().kpis[0], total: 10, cancelled: 8, completed: 1, failed: 1 }],
    }));
    expect(p.action_queue.some((a) => a.code === "CANCEL_LOOP")).toBe(false);
  });
  it("flags HIGH_FAIL_RATE", () => {
    const p = project(baseInputs({
      kpis: [{ ...baseInputs().kpis[0], total: 100, failed: 60, completed: 30, cancelled: 10 }],
    }));
    expect(p.action_queue.some((a) => a.code === "HIGH_FAIL_RATE" && a.severity === "critical")).toBe(true);
  });
  it("flags STALE_PENDING when age > 1h and count >= 5", () => {
    const p = project(baseInputs({
      pending_age: [{
        job_type: "Y", worker_pool: "p", pending_jobs: 10, blocked_mode_jobs: 0,
        oldest_updated_at: "2026-06-27T10:30:00Z",
      }],
    }));
    expect(p.action_queue.some((a) => a.code === "STALE_PENDING")).toBe(true);
  });
  it("does not flag fresh pending", () => {
    const p = project(baseInputs({
      pending_age: [{
        job_type: "Y", worker_pool: "p", pending_jobs: 10, blocked_mode_jobs: 0,
        oldest_updated_at: "2026-06-27T11:55:00Z",
      }],
    }));
    expect(p.action_queue.some((a) => a.code === "STALE_PENDING")).toBe(false);
  });
  it("DLQ_BACKLOG triggers at >=3 per job_type", () => {
    const p = project(baseInputs({
      dlq: Array.from({ length: 5 }, () => ({
        job_type: "Z", error_category: "timeout", error_code: "ETIMEDOUT",
        created_at: "2026-06-27T11:00:00Z",
      })),
    }));
    expect(p.action_queue.some((a) => a.code === "DLQ_BACKLOG")).toBe(true);
  });
  it("caps action queue at 20", () => {
    const dlq = Array.from({ length: 50 }, (_, i) => ({
      job_type: `T${i}`, error_category: "x", error_code: "y",
      created_at: "2026-06-27T11:00:00Z",
    }));
    const p = project(baseInputs({
      dlq: [...dlq, ...dlq, ...dlq, ...dlq],
    }));
    expect(p.action_queue.length).toBeLessThanOrEqual(20);
  });
});

describe("pipelineHealth — totals & dlq summary", () => {
  it("aggregates totals across job_types", () => {
    const p = project({
      ...baseInputs(),
      kpis: [
        { ...baseInputs().kpis[0], pending: 1, processing: 1, completed: 1, failed: 1, cancelled: 1, blocked: 1, total: 6 },
        { ...baseInputs().kpis[0], job_type: "x2", pending: 2, processing: 2, completed: 2, failed: 2, cancelled: 2, blocked: 2, total: 12 },
      ],
    });
    expect(p.totals.pending).toBe(3);
    expect(p.totals.processing).toBe(3);
    expect(p.totals.completed).toBe(3);
  });
  it("summarizeDlq groups by category", () => {
    const s = summarizeDlq([
      { job_type: "a", error_category: "net", error_code: null, created_at: "x" },
      { job_type: "b", error_category: "net", error_code: null, created_at: "x" },
      { job_type: "c", error_category: null, error_code: null, created_at: "x" },
    ]);
    expect(s[0].category).toBe("net");
    expect(s[0].count).toBe(2);
    expect(s.find((x) => x.category === "uncategorized")?.count).toBe(1);
  });
  it("stamps version", () => {
    expect(project(baseInputs()).projector_version).toBe(PROJECTOR_VERSION);
  });
});

describe("pipelineHealth — determinism", () => {
  it("same input → same projection", () => {
    const a = project(baseInputs());
    const b = project(baseInputs());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
