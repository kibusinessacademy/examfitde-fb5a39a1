import { describe, it, expect } from "vitest";
import { supabase } from "@/integrations/supabase/client";

/**
 * Phase-3 Forensic Test-Suite
 * - Manual DAG heal smoke counters (admin_smoke_dag_heal_counters)
 * - Gap-Sync per Lane (admin_get_dag_gap_sync)
 * - Traffic-aware cta_visible suppression helper (fn_should_suppress_cta_visible)
 *
 * Notes:
 * - These run as anon (no admin role); admin_* RPCs MUST refuse.
 * - The pure suppression helper MUST be callable + return correct truth-table.
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
      [5, 3, 27, false, "c1h>0 → no-op (no alert)"],
      [5, 0, 0, false, "c24h=0 → no-op (no alert)"],
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
});
