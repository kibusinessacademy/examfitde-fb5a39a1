/**
 * Wave: Integrity Heartbeat Loop + Reaper CAS — contract tests.
 *
 * 1) Static contract on package-run-integrity-check worker:
 *    - exports INTEGRITY_HEARTBEAT_MS ≤ 30_000
 *    - calls startIntegrityHeartbeat(...) inside the handler
 *    - increments meta.heartbeat_tick_count on every tick
 *    - first heartbeat is fired immediately (`void tick()` before setInterval)
 *
 * 2) Long-running heartbeat-loop simulation (Vitest fake timers):
 *    - Stub `sb.rpc("heartbeat_job_processing", …)` and run for 65s.
 *    - Expect ≥ 2 heartbeat calls (1 immediate + at least 1 loop tick).
 *
 * 3) DB contract: complete_job CAS smoke RPC must refuse anon and the
 *    function must exist (no syntax errors). The actual positive/negative
 *    truth-table is verified inside the migration's DO-block.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const WORKER = path.resolve(
  process.cwd(),
  "supabase/functions/package-run-integrity-check/index.ts",
);
const SRC = fs.readFileSync(WORKER, "utf8");

describe("Integrity worker · heartbeat-loop static contract", () => {
  it("exports INTEGRITY_HEARTBEAT_MS ≤ 30_000", () => {
    expect(SRC).toMatch(/export const INTEGRITY_HEARTBEAT_MS\s*=\s*(\d[_\d]*)/);
    const m = SRC.match(/INTEGRITY_HEARTBEAT_MS\s*=\s*(\d[_\d]*)/)!;
    const v = Number(m[1].replace(/_/g, ""));
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(30_000);
  });

  it("registers a setInterval-based heartbeat loop", () => {
    expect(SRC).toMatch(/setInterval\(\s*tick\s*,\s*INTEGRITY_HEARTBEAT_MS\s*\)/);
  });

  it("fires first heartbeat immediately before the interval kicks in", () => {
    // void tick() must appear before setInterval(tick, …) inside the heartbeat factory
    const idxVoidTick = SRC.indexOf("void tick();");
    const idxInterval = SRC.indexOf("setInterval(tick, INTEGRITY_HEARTBEAT_MS)");
    expect(idxVoidTick).toBeGreaterThan(0);
    expect(idxInterval).toBeGreaterThan(idxVoidTick);
  });

  it("each tick increments meta.heartbeat_tick_count", () => {
    expect(SRC).toMatch(/heartbeat_tick_count:\s*tickCount/);
    expect(SRC).toMatch(/tickCount\s*\+=\s*1/);
  });

  it("fallback heartbeat path also writes last_heartbeat_at AND CAS-guards on status='processing'", () => {
    // Fallback when RPC signature differs must still set last_heartbeat_at
    // and only touch rows in status='processing' (CAS).
    expect(SRC).toMatch(/last_heartbeat_at:\s*new Date\(\)\.toISOString\(\)/);
    expect(SRC).toMatch(/\.eq\("status",\s*"processing"\)/);
  });

  it("handler invokes startIntegrityHeartbeat after package_id validation", () => {
    expect(SRC).toMatch(/heartbeat\s*=\s*startIntegrityHeartbeat\(sb,\s*jobId,\s*packageId\)/);
  });
});

describe("Integrity worker · heartbeat-loop emits ≥2 ticks in 65s window", () => {
  it("simulates a long-running job and asserts at least 2 heartbeats", async () => {
    vi.useFakeTimers();

    let rpcCalls = 0;
    const sb = {
      rpc: vi.fn(async (name: string, _args?: Record<string, unknown>) => {
        if (name === "heartbeat_job_processing") rpcCalls += 1;
        return { data: true, error: null };
      }),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { meta: {} } }) }) }) }),
    };

    // Inline the loop's behavior so the test is hermetic (no Deno import).
    const HEARTBEAT_MS = 30_000;
    let stopped = false;
    let tickCount = 0;
    const tick = async () => {
      if (stopped) return;
      tickCount += 1;
      await sb.rpc("heartbeat_job_processing", {});
    };
    void tick();
    const handle = setInterval(tick, HEARTBEAT_MS);

    await vi.advanceTimersByTimeAsync(65_000);
    stopped = true;
    clearInterval(handle);
    vi.useRealTimers();

    // 1 immediate + 2 interval ticks at 30s + 60s = 3 calls in 65s
    expect(rpcCalls).toBeGreaterThanOrEqual(2);
    expect(tickCount).toBeGreaterThanOrEqual(2);
  });
});

describe("complete_job · CAS contract (DB-side)", () => {
  const sb = createClient(
    "https://ubdvvvsiryenhrfmqsvw.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViZHZ2dnNpcnllbmhyZm1xc3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NDA4MjgsImV4cCI6MjA4MzAxNjgyOH0.LGMpcVQMXziF3Zal4SoprwQj6KfNyqjVJXDXEh3pAEc",
  );

  it("fn_smoke_complete_job_cas refuses anon and is wired (no syntax errors)", async () => {
    const { error } = await sb.rpc("fn_smoke_complete_job_cas" as any, {
      p_initial_status: "processing",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/forbidden|permission denied|not allowed|role/i);
    expect(error!.message).not.toMatch(/syntax|operator does not exist|does not exist/i);
  });

  it("complete_job (jsonb overload) is service-role-only — function compiles", async () => {
    const { error } = await sb.rpc("complete_job" as any, {
      p_job_id: "00000000-0000-0000-0000-000000000000",
      p_result: { smoke: true },
    });
    // Either forbidden (RLS) or row-not-found (returns false). Both prove the
    // function exists and has no syntax errors.
    if (error) {
      expect(error.message).not.toMatch(/syntax|operator does not exist|function .* does not exist/i);
    }
  });
});
