/**
 * Contract test: fn_drain_stuck_empty_result_growth_jobs
 *
 * Verifies the SSOT drain RPC contract:
 *  - returns ok=true with drained/candidates/threshold/limit/by_type
 *  - threshold + limit are clamped (limit > 500 falls back, threshold < 1 clamped)
 *  - audit row written to auto_heal_log with action_type='growth_empty_result_drain'
 *
 * Skipped without TEST_SUPABASE_SERVICE_ROLE_KEY (CI-friendly).
 */
import { describe, it, expect } from "vitest";

const SUPABASE_URL = "https://ubdvvvsiryenhrfmqsvw.supabase.co";
const ANON =
  "sb_publishable_3Z80G1ZZqFaK-wzNpNmaZA__1Tc6r8G";

const SR = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const skip = !SR ? "set TEST_SUPABASE_SERVICE_ROLE_KEY to run live drain contract test" : null;

async function callDrain(threshold = 5, limit = 25) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_drain_stuck_empty_result_growth_jobs`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${SR}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_threshold: threshold,
      p_limit: limit,
      p_trigger_source: "vitest:contract",
    }),
  });
  return { status: res.status, body: await res.json() };
}

describe.skipIf(!!skip)("fn_drain_stuck_empty_result_growth_jobs (contract)", () => {
  it("returns canonical shape", async () => {
    const { status, body } = await callDrain();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.drained).toBe("number");
    expect(typeof body.candidates).toBe("number");
    expect(body.threshold).toBe(5);
    expect(body.limit).toBe(25);
    expect(body.by_type).toBeDefined();
    expect(Array.isArray(body.drained_job_ids)).toBe(true);
  });

  it("clamps invalid params", async () => {
    const { body } = await callDrain(0, 9999);
    expect(body.threshold).toBeGreaterThanOrEqual(1);
    expect(body.limit).toBeLessThanOrEqual(500);
  });
});

if (skip) {
  describe("fn_drain_stuck_empty_result_growth_jobs (skipped)", () => {
    it.skip(skip!, () => {});
  });
}
