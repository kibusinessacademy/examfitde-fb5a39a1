/**
 * S4 SQL regression smoke tests.
 *
 * Anon-side: prove the functions exist with the expected signatures and
 * admin-gated RPCs refuse — guards against regressions like:
 *   - `COUNT()` (Postgres rejects, must be COUNT(*))
 *   - `SELECT INTO` without column list
 *   - missing COALESCE on JSON casts in fn_is_bronze_locked
 *   - admin_requeue_bronze_quarantine schema drift
 */
import { describe, it, expect } from "vitest";
import { supabase } from "@/integrations/supabase/client";

const SCHEMA_REGRESSION = /column .* does not exist|function .* does not exist|relation .* does not exist|syntax error/i;
const RANDOM_UUID = "00000000-0000-4000-8000-000000000000";

describe("S4: Auto-Pulse + Bronze Quarantine SQL contract", () => {
  it("fn_lane_failure_rate_15m exists with expected signature (no schema drift)", async () => {
    const { data, error } = await supabase.rpc(
      "fn_lane_failure_rate_15m" as any,
      { p_lane: "control", p_pool: "default" },
    );
    if (error) {
      // Anon may be permission-denied (42501) — that proves the function exists.
      expect(error.message).not.toMatch(SCHEMA_REGRESSION);
    } else {
      expect(typeof data).toBe("number");
      expect(data).toBeGreaterThanOrEqual(0);
      expect(data).toBeLessThanOrEqual(1);
    }
  });

  it("fn_is_bronze_locked tolerates missing JSON keys (COALESCE casts)", async () => {
    const { error } = await supabase.rpc(
      "fn_is_bronze_locked" as any,
      { p_package_id: RANDOM_UUID },
    );
    if (error) {
      expect(error.message).not.toMatch(SCHEMA_REGRESSION);
      expect(error.message).not.toMatch(/invalid input syntax/i);
    }
  });

  it("admin_get_bronze_quarantine refuses anon (no schema drift)", async () => {
    const { error } = await supabase.rpc(
      "admin_get_bronze_quarantine" as any,
      { p_reason: null, p_limit: 10 },
    );
    expect(error).toBeTruthy();
    expect(error?.message ?? "").not.toMatch(SCHEMA_REGRESSION);
  });

  it("admin_requeue_bronze_quarantine refuses anon (signature stable)", async () => {
    const { error } = await supabase.rpc(
      "admin_requeue_bronze_quarantine" as any,
      { p_package_id: RANDOM_UUID, p_reason: "ci_smoke" },
    );
    expect(error).toBeTruthy();
    expect(error?.message ?? "").not.toMatch(SCHEMA_REGRESSION);
  });

  it("admin_get_auto_recovery_pulse_health refuses anon (no SQL regression)", async () => {
    const { error } = await supabase.rpc(
      "admin_get_auto_recovery_pulse_health" as any,
      { p_window_hours: 1 },
    );
    expect(error).toBeTruthy();
    expect(error?.message ?? "").not.toMatch(SCHEMA_REGRESSION);
  });
});
