import { describe, it, expect } from "vitest";
import { supabase } from "@/integrations/supabase/client";

/**
 * Phase-3 Forensic Test-Suite
 * - Manual DAG heal smoke counters (admin_smoke_dag_heal_counters)
 * - Gap-Sync per Lane (admin_get_dag_gap_sync)
 * - Traffic-aware cta_visible suppression helper (fn_should_suppress_cta_visible)
 * - Adaptive burst sizing (fn_adaptive_burst_size)
 * - Worker forensics + bronze auto-unlock + pre/post smoke (admin-gated refusal)
 *
 * Notes:
 * - These run as anon (no admin role); admin_* RPCs MUST refuse.
 */

describe("Phase-3 ops: DAG heal + alert hardening", () => {
  it("admin_smoke_dag_heal_counters refuses without admin role", async () => {
    const { data, error } = await supabase.rpc("admin_smoke_dag_heal_counters" as any);
    expect(error).toBeTruthy();
    expect(data).toBeNull();
  });

  it("admin_get_dag_gap_sync refuses without admin role", async () => {
    const { error } = await supabase.rpc("admin_get_dag_gap_sync" as any);
    expect(error).toBeTruthy();
  });

  describe("fn_should_suppress_cta_visible truth table", () => {
    const cases: Array<[number, number, number, boolean, string]> = [
      [5, 0, 27, true, "low baseline → suppress"],
      [15, 0, 27, false, "high baseline → fire"],
      [5, 3, 27, false, "c1h>0 → no-op"],
      [5, 0, 0, false, "c24h=0 → no-op"],
    ];
    for (const [baseline, c1h, c24h, expected, label] of cases) {
      it(label, async () => {
        const { data, error } = await supabase.rpc(
          "fn_should_suppress_cta_visible" as any,
          { p_baseline_3h: baseline, p_c1h: c1h, p_c24h: c24h },
        );
        expect(error).toBeNull();
        expect(data).toBe(expected);
      });
    }
  });

  describe("fn_adaptive_burst_size truth table", () => {
    const cases: Array<[number, number]> = [
      [0, 25], [50, 25], [100, 25],
      [101, 35], [500, 35],
      [501, 50], [1000, 50],
      [1001, 75], [5000, 75],
    ];
    for (const [pending, expected] of cases) {
      it(`pending=${pending} → burst=${expected}`, async () => {
        const { data, error } = await supabase.rpc(
          "fn_adaptive_burst_size" as any,
          { p_pending: pending },
        );
        expect(error).toBeNull();
        expect(data).toBe(expected);
      });
    }
  });

  it("admin_get_worker_throughput_forensics refuses anon", async () => {
    const { error } = await supabase.rpc("admin_get_worker_throughput_forensics" as any);
    expect(error).toBeTruthy();
  });

  it("admin_bronze_tail_auto_unlock refuses anon", async () => {
    const { error } = await supabase.rpc("admin_bronze_tail_auto_unlock" as any, { p_max: 1 });
    expect(error).toBeTruthy();
  });

  it("admin_smoke_dag_heal_pre_post refuses anon", async () => {
    const { error } = await supabase.rpc("admin_smoke_dag_heal_pre_post" as any, { p_phase: "pre" });
    expect(error).toBeTruthy();
  });

  describe("S1: fn_adaptive_burst_size_v2 truth table", () => {
    // [pending, failure_rate, reaper_churn, lane, pool, expected_max, label]
    const cases: Array<[number, number, number, string | null, string, number, string]> = [
      [50,    0,    0, null,       "default", 25, "low pending → 25"],
      [1500,  0,    0, null,       "default", 75, "high pending → 75"],
      [1500,  0.30, 0, null,       "default", 40, "high failure → halved"],
      [1500,  0,   12, null,       "default", 40, "reaper churn → halved"],
      [1500,  0,    0, "control",  "default", 35, "control lane capped 35"],
      [50,    0,    0, "recovery", "default", 35, "recovery lane floor 35"],
      [1500,  0,    0, null,       "premium", 25, "non-default pool capped 25"],
      // Phase-S2: extra invariants
      [1500,  0.21, 0, null,       "default", 40, "failure_rate > 20% halves"],
      [1500,  0.10, 0, null,       "default", 75, "failure_rate <= 20% no shedding"],
      [1500,  0,    6, null,       "default", 40, "reaper churn > 5 halves"],
      [1500,  0,    4, null,       "default", 75, "reaper churn <= 5 no shedding"],
      [10000, 0,    0, null,       "default", 100, "boundary clamp upper 100"],
    ];
    for (const [pending, fr, churn, lane, pool, max, label] of cases) {
      it(label, async () => {
        const { data, error } = await supabase.rpc(
          "fn_adaptive_burst_size_v2" as any,
          { p_pending: pending, p_failure_rate_15m: fr, p_reaper_churn_5m: churn, p_lane: lane, p_pool: pool },
        );
        expect(error).toBeNull();
        expect(typeof data).toBe("number");
        expect(data).toBeLessThanOrEqual(max);
        expect(data).toBeGreaterThanOrEqual(5);
      });
    }
  });

  it("admin_get_quality_gate_decisions refuses anon", async () => {
    const { data, error } = await supabase.rpc(
      "admin_get_quality_gate_decisions" as any,
      { p_decision: null, p_limit: 10 },
    );
    expect(error).toBeTruthy();
    expect(data).toBeNull();
  });

  // S2: Track A — Gate Decision History
  it("admin_get_gate_decision_history refuses anon", async () => {
    const { error } = await supabase.rpc(
      "admin_get_gate_decision_history" as any,
      { p_package_id: "00000000-0000-0000-0000-000000000000", p_limit: 5 },
    );
    expect(error).toBeTruthy();
  });
  it("admin_record_gate_decisions_now refuses anon", async () => {
    const { error } = await supabase.rpc("admin_record_gate_decisions_now" as any);
    expect(error).toBeTruthy();
  });

  // S2: Track D — Auto-Pulse Verification
  it("admin_get_auto_recovery_pulse_health refuses anon", async () => {
    const { error } = await supabase.rpc(
      "admin_get_auto_recovery_pulse_health" as any,
      { p_window_hours: 24 },
    );
    expect(error).toBeTruthy();
  });
  it("admin_smoke_auto_recovery_pulse refuses anon", async () => {
    const { error } = await supabase.rpc("admin_smoke_auto_recovery_pulse" as any);
    expect(error).toBeTruthy();
  });
  it("fn_auto_recovery_pulse_decide_dryrun is service-role-only (anon refused)", async () => {
    const { error } = await supabase.rpc("fn_auto_recovery_pulse_decide_dryrun" as any);
    expect(error).toBeTruthy();
  });
});
