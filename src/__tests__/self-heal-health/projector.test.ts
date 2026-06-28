import { describe, it, expect } from "vitest";
import { project, type ProjInputs, type HealLogRow } from "../../../supabase/functions/_shared/selfHealHealth/index.ts";

const NOW = "2026-06-28T12:00:00.000Z";
const hAgo = (h: number) => new Date(Date.parse(NOW) - h * 3600_000).toISOString();

function row(p: Partial<HealLogRow>): HealLogRow {
  return {
    action_type: "retry_failed_jobs",
    trigger_source: "daily_runner",
    result_status: "success",
    duration_ms: 100,
    created_at: hAgo(1),
    followup_verdict: null,
    followup_score_before: null,
    followup_score_after: null,
    ...p,
  };
}

const base = (heals: HealLogRow[], over: Partial<ProjInputs> = {}): ProjInputs => ({
  heals,
  summary: { health_score: 90, traffic_light: "green", failed_1h: 0, failed_24h: 0, stuck_jobs: 0, failed_packages: 0, integrity_issues: 0, heals_24h: heals.length, heals_success_24h: heals.filter(h => h.result_status === "success").length, heals_failed_24h: heals.filter(h => h.result_status === "failed").length, auto_heal_allowed: true },
  policy: { is_active: true, incident_mode: false, incident_activated_at: null, incident_activated_by: null, cooldowns: { a: 1 }, requires_approval: ["republish_course"] },
  now_iso: NOW,
  ...over,
});

describe("SELF.HEAL.OS.1 projector", () => {
  it("is deterministic & stable for empty input", () => {
    const p1 = project(base([]));
    const p2 = project(base([]));
    expect(p1.system).toEqual(p2.system);
    expect(p1.action_queue).toEqual([]);
    expect(p1.projector_version).toMatch(/^self-heal-os-/);
  });

  it("emits HEAL_DISABLED when auto_heal_allowed=false", () => {
    const p = project(base([], { summary: { health_score: 50, traffic_light: "red", failed_1h: 3, failed_24h: 10, stuck_jobs: 4, failed_packages: 5, integrity_issues: 1, heals_24h: 0, heals_success_24h: 0, heals_failed_24h: 0, auto_heal_allowed: false } }));
    expect(p.action_queue[0].code).toBe("HEAL_DISABLED");
    expect(p.action_queue[0].severity).toBe("critical");
  });

  it("emits INCIDENT_MODE when policy.incident_mode=true", () => {
    const p = project(base([], { policy: { is_active: true, incident_mode: true, incident_activated_at: NOW, incident_activated_by: "alice", cooldowns: {}, requires_approval: [] } }));
    expect(p.action_queue.some(a => a.code === "INCIDENT_MODE")).toBe(true);
    expect(p.system.incident_mode).toBe(true);
  });

  it("flags HEAL_FAIL_SPIKE when failed_24h>=5", () => {
    const heals = Array.from({ length: 6 }, () => row({ result_status: "failed", created_at: hAgo(2) }));
    const p = project(base(heals));
    expect(p.action_queue.some(a => a.code === "HEAL_FAIL_SPIKE")).toBe(true);
  });

  it("flags HEAL_SILENCE when no heals but failed/stuck jobs exist", () => {
    const p = project(base([], { summary: { health_score: 60, traffic_light: "yellow", failed_1h: 2, failed_24h: 8, stuck_jobs: 1, failed_packages: 0, integrity_issues: 0, heals_24h: 0, heals_success_24h: 0, heals_failed_24h: 0, auto_heal_allowed: true } }));
    expect(p.action_queue.some(a => a.code === "HEAL_SILENCE")).toBe(true);
  });

  it("flags HEAL_THRASHING above 100 heals/24h", () => {
    const heals = Array.from({ length: 120 }, (_, i) => row({ created_at: hAgo(1) }));
    const sum = { health_score: 90, traffic_light: "green", failed_1h: 0, failed_24h: 0, stuck_jobs: 0, failed_packages: 0, integrity_issues: 0, heals_24h: 120, heals_success_24h: 120, heals_failed_24h: 0, auto_heal_allowed: true };
    const p = project(base(heals, { summary: sum }));
    expect(p.action_queue.some(a => a.code === "HEAL_THRASHING")).toBe(true);
  });

  it("flags ACTION_REGRESSION when regressed > improved", () => {
    const heals = [
      ...Array.from({ length: 4 }, () => row({ result_status: "success", followup_verdict: "regressed", followup_score_before: 80, followup_score_after: 60 })),
      row({ result_status: "success", followup_verdict: "improved", followup_score_before: 60, followup_score_after: 70 }),
    ];
    const p = project(base(heals));
    const reg = p.action_queue.find(a => a.code === "ACTION_REGRESSION");
    expect(reg).toBeTruthy();
    expect(reg!.severity).toBe("high");
    expect(p.action_types[0].avg_score_delta).toBeLessThan(0);
  });

  it("flags ACTION_HIGH_FAILURE when success_rate<0.5 with ≥5 settled", () => {
    const heals = [
      ...Array.from({ length: 4 }, () => row({ result_status: "failed" })),
      row({ result_status: "success" }),
    ];
    const p = project(base(heals));
    expect(p.action_queue.some(a => a.code === "ACTION_HIGH_FAILURE")).toBe(true);
  });

  it("flags ACTION_NO_EFFECT (improved=0, no_change≥5)", () => {
    const heals = Array.from({ length: 6 }, () => row({ result_status: "success", followup_verdict: "no_change" }));
    const p = project(base(heals));
    expect(p.action_queue.some(a => a.code === "ACTION_NO_EFFECT")).toBe(true);
  });

  it("flags ACTION_NO_FOLLOWUP at low coverage with ≥10 runs", () => {
    const heals = Array.from({ length: 12 }, () => row({ result_status: "success" }));
    const p = project(base(heals));
    expect(p.action_queue.some(a => a.code === "ACTION_NO_FOLLOWUP")).toBe(true);
  });

  it("sorts action_queue by score descending (critical first)", () => {
    const heals = [
      ...Array.from({ length: 4 }, () => row({ result_status: "failed" })),
      row({ result_status: "success" }),
    ];
    const p = project(base(heals, { policy: { is_active: true, incident_mode: true, incident_activated_at: null, incident_activated_by: null, cooldowns: {}, requires_approval: [] } }));
    expect(p.action_queue[0].severity).toBe("critical");
    for (let i = 1; i < p.action_queue.length; i++) {
      const prev = p.action_queue[i - 1] as any;
      const cur = p.action_queue[i] as any;
      expect(prev.score >= cur.score).toBe(true);
    }
  });

  it("computes per-action KPIs and trigger_breakdown deterministically", () => {
    const heals = [
      row({ action_type: "A", trigger_source: "cron", result_status: "success", followup_verdict: "improved", followup_score_before: 50, followup_score_after: 80, created_at: hAgo(2) }),
      row({ action_type: "A", trigger_source: "cron", result_status: "success", followup_verdict: "improved", followup_score_before: 60, followup_score_after: 70, created_at: hAgo(3) }),
      row({ action_type: "B", trigger_source: "manual", result_status: "failed", created_at: hAgo(5) }),
    ];
    const p = project(base(heals));
    const a = p.action_types.find(x => x.action_type === "A")!;
    expect(a.success).toBe(2);
    expect(a.improved).toBe(2);
    expect(a.effective_rate).toBe(1);
    expect(a.avg_score_delta).toBe(20);
    const cron = p.trigger_breakdown.find(t => t.trigger_source === "cron")!;
    expect(cron.runs_24h).toBe(2);
    expect(cron.success_24h).toBe(2);
  });
});
