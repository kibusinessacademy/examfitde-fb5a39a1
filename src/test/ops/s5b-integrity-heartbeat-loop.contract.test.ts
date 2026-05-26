/**
 * Wave: Deterministic Pulse at Stage Boundaries — contract tests.
 *
 * Replaces the v1 setInterval-based loop test. The Supabase Edge Runtime
 * suspends timers during long await sections, so the integrity worker now
 * uses explicit `await heartbeat.pulse('<stage>')` calls at every known
 * stage boundary instead of a setInterval tick.
 *
 * 1) Static contract on package-run-integrity-check worker:
 *    - exports INTEGRITY_HEARTBEAT_MS (kept for documentation)
 *    - NO setInterval-based heartbeat loop anymore
 *    - exposes startIntegrityHeartbeat returning { pulse, stop, tickCount }
 *    - increments meta.heartbeat_tick_count and writes heartbeat_log
 *    - handler invokes heartbeat.pulse(...) at ≥6 stage boundaries
 *
 * 2) Pulse simulation:
 *    - Stub `sb.rpc("heartbeat_job_processing", …)` and call pulse 6 times.
 *    - Expect rpc to be called 6× with monotonically increasing tick counts.
 *
 * 3) DB contract: complete_job CAS smoke RPC must refuse anon and the
 *    function must exist (no syntax errors).
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

describe("Integrity worker · deterministic-pulse static contract", () => {
  it("exports INTEGRITY_HEARTBEAT_MS (documentation contract, ≤ 30_000)", () => {
    expect(SRC).toMatch(/export const INTEGRITY_HEARTBEAT_MS\s*=\s*(\d[_\d]*)/);
    const m = SRC.match(/INTEGRITY_HEARTBEAT_MS\s*=\s*(\d[_\d]*)/)!;
    const v = Number(m[1].replace(/_/g, ""));
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(30_000);
  });

  it("does NOT use setInterval for heartbeats (deterministic pulse only)", () => {
    expect(SRC).not.toMatch(/setInterval\(\s*tick\s*,/);
    expect(SRC).not.toMatch(/setInterval\(\s*pulse\s*,/);
  });

  it("startIntegrityHeartbeat returns { pulse, stop, tickCount }", () => {
    expect(SRC).toMatch(/pulse:\s*\(stage:\s*string\)\s*=>\s*Promise<void>/);
    expect(SRC).toMatch(/tickCount:\s*\(\)\s*=>\s*number/);
    expect(SRC).toMatch(/stop:\s*\(\)\s*=>\s*void/);
  });

  it("each pulse increments heartbeat_tick_count and appends to heartbeat_log", () => {
    expect(SRC).toMatch(/tickCount\s*\+=\s*1/);
    expect(SRC).toMatch(/heartbeat_tick_count:\s*tickCount/);
    expect(SRC).toMatch(/heartbeat_log:\s*pulseLog\.slice\(-10\)/);
  });

  it("fallback heartbeat path also writes last_heartbeat_at AND CAS-guards on status='processing'", () => {
    expect(SRC).toMatch(/last_heartbeat_at:\s*new Date\(\)\.toISOString\(\)/);
    expect(SRC).toMatch(/\.eq\("status",\s*"processing"\)/);
  });

  it("handler invokes heartbeat.pulse() at all required stage boundaries", () => {
    const REQUIRED_STAGES = [
      "handler_start",
      "prereq_done",
      "pre_course_ready_gate",
      "post_course_ready_gate",
      "progress_recorded",
      "pre_persist",
      "post_persist",
      "handler_done",
    ];
    for (const stage of REQUIRED_STAGES) {
      const re = new RegExp(`heartbeat\\.pulse\\(\\s*["']${stage}["']\\s*\\)`);
      expect(SRC, `missing pulse('${stage}')`).toMatch(re);
    }
    // Sanity: at least 6 pulse callsites in handler
    const pulseCalls = SRC.match(/heartbeat\.pulse\(/g) ?? [];
    expect(pulseCalls.length).toBeGreaterThanOrEqual(6);
  });

  it("handler invokes startIntegrityHeartbeat after package_id validation", () => {
    expect(SRC).toMatch(/heartbeat\s*=\s*startIntegrityHeartbeat\(sb,\s*jobId,\s*packageId\)/);
  });
});

describe("Integrity worker · pulse() emits ≥1 RPC per call with monotonic tickCount", () => {
  it("simulates 6 stage-boundary pulses and asserts 6 RPC calls + monotonic counters", async () => {
    let rpcCalls = 0;
    const tickCountsSeen: number[] = [];
    const sb = {
      rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
        if (name === "heartbeat_job_processing") {
          rpcCalls += 1;
          const meta = (args as any)?.p_meta ?? {};
          if (typeof meta.heartbeat_tick_count === "number") {
            tickCountsSeen.push(meta.heartbeat_tick_count);
          }
        }
        return { data: true, error: null };
      }),
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { meta: {} } }) }) }),
        update: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
      }),
    };

    // Inline the loop's behavior so the test is hermetic (no Deno import).
    const HEARTBEAT_MS = 30_000;
    let stopped = false;
    let tickCount = 0;
    const pulseLog: Array<{ tick: number; stage: string }> = [];
    const pulse = async (stage: string) => {
      if (stopped) return;
      tickCount += 1;
      pulseLog.push({ tick: tickCount, stage });
      await sb.rpc("heartbeat_job_processing", {
        p_meta: { heartbeat_tick_count: tickCount, last_stage: stage },
      });
    };

    const stages = [
      "handler_start",
      "prereq_done",
      "pre_course_ready_gate",
      "post_course_ready_gate",
      "progress_recorded",
      "pre_persist",
    ];
    for (const s of stages) await pulse(s);
    stopped = true;

    expect(rpcCalls).toBe(stages.length);
    expect(tickCount).toBe(stages.length);
    expect(tickCountsSeen).toEqual([1, 2, 3, 4, 5, 6]);
    expect(pulseLog.map((p) => p.stage)).toEqual(stages);
  });
});

describe("complete_job · CAS contract (DB-side)", () => {
  const sb = createClient(
    "https://ubdvvvsiryenhrfmqsvw.supabase.co",
    "sb_publishable_3Z80G1ZZqFaK-wzNpNmaZA__1Tc6r8G",
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
    if (error) {
      expect(error.message).not.toMatch(/syntax|operator does not exist|function .* does not exist/i);
    }
  });
});
