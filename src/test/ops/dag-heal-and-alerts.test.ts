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
});
