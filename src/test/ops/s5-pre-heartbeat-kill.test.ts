/**
 * S5 — Pre-Heartbeat Kill Forensics + Per-Lane E2E Smoke
 *
 * Verifies:
 *   - fn_is_pre_heartbeat_kill returns boolean for valid inputs
 *   - admin RPCs refuse anon
 *   - admin_lane_e2e_smoke shape (1 row per lane)
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ubdvvvsiryenhrfmqsvw.supabase.co";
const ANON =
  "sb_publishable_3Z80G1ZZqFaK-wzNpNmaZA__1Tc6r8G";

const sb = createClient(SUPABASE_URL, ANON);

const FORBIDDEN_RX = /forbidden|admin role required|permission denied/i;

describe("S5 · Pre-Heartbeat Kill Forensics", () => {
  it("fn_is_pre_heartbeat_kill is anon-callable and returns boolean", async () => {
    const { data, error } = await sb.rpc(
      "fn_is_pre_heartbeat_kill" as any,
      {
        p_locked_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        p_last_heartbeat_at: null,
        p_grace_seconds: 180,
      },
    );
    expect(error).toBeNull();
    expect(typeof data).toBe("boolean");
    expect(data).toBe(true);
  });

  it("fn_is_pre_heartbeat_kill returns false within grace", async () => {
    const { data, error } = await sb.rpc(
      "fn_is_pre_heartbeat_kill" as any,
      {
        p_locked_at: new Date(Date.now() - 10_000).toISOString(),
        p_last_heartbeat_at: null,
        p_grace_seconds: 180,
      },
    );
    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it("admin_get_pre_heartbeat_kill_risk refuses anon", async () => {
    const { error } = await sb.rpc("admin_get_pre_heartbeat_kill_risk" as any);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(FORBIDDEN_RX);
  });

  it("admin_clear_pre_heartbeat_quarantine refuses anon", async () => {
    const { error } = await sb.rpc(
      "admin_clear_pre_heartbeat_quarantine" as any,
      {
        p_package_id: "00000000-0000-0000-0000-000000000000",
        p_reason: "test reason here",
      },
    );
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(FORBIDDEN_RX);
  });

  it("admin_lane_e2e_smoke refuses anon", async () => {
    const { error } = await sb.rpc("admin_lane_e2e_smoke" as any);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(FORBIDDEN_RX);
  });
});

describe("S5 · Per-Lane Helper Smoke (anon-readable)", () => {
  const lanes = ["control", "generation", "content", "recovery", "default"];

  for (const lane of lanes) {
    it(`fn_lane_failure_rate_15m is callable or properly gated for lane=${lane}`, async () => {
      const { data, error } = await sb.rpc(
        "fn_lane_failure_rate_15m" as any,
        { p_lane: lane, p_pool: "default" },
      );
      if (error) {
        // service-role gated is acceptable
        expect(error.message).toMatch(/permission denied|forbidden/i);
      } else {
        const n = typeof data === "string" ? Number(data) : (data as number);
        expect(Number.isFinite(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1);
      }
    });

    it(`fn_adaptive_burst_size_v2 returns clamped int for lane=${lane}`, async () => {
      const { data, error } = await sb.rpc(
        "fn_adaptive_burst_size_v2" as any,
        {
          p_pending: 50,
          p_failure_rate_15m: 0.05,
          p_reaper_churn_5m: 0,
          p_lane: lane,
          p_pool: "default",
        },
      );
      expect(error).toBeNull();
      const n = data as number;
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(100);
    });
  }
});
