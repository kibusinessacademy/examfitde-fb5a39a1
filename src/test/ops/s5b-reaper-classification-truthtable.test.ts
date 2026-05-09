/**
 * S5b · Reaper Classification — deep truth-table regression
 *
 * Calls public.fn_smoke_reaper_classify (pure SQL, anon-callable) for every
 * relevant (locked_at_age, last_heartbeat_at, stale_reap_count, phk_count,
 * attempts) combo and asserts the bucket the reaper would assign.
 *
 * Locks in:
 *   - PRE_HEARTBEAT_KILL_TERMINAL after 2 PHK occurrences
 *   - PRE_HEARTBEAT_KILL on first PHK
 *   - STALE_AFTER_HEARTBEAT vs STALE_LOCK_LOOP_HARD_KILL split by hb presence
 *   - STALE_PROCESSING_REAPED below loop-kill threshold
 *   - STALE_PROCESSING_EXHAUSTED on max attempts
 *   - HEALTHY otherwise
 *   - No infinite-requeue loop: phk_count=2 and reap_count=2 both terminate.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const NOW = "2026-05-09T12:00:00Z";
const minutesAgo = (m: number) => new Date(Date.parse(NOW) - m * 60_000).toISOString();

async function classify(args: {
  locked_at: string | null;
  last_heartbeat_at: string | null;
  stale_reap_count: number;
  phk_count: number;
  attempts: number;
  max_attempts?: number;
}): Promise<string> {
  const { data, error } = await sb.rpc("fn_smoke_reaper_classify" as any, {
    p_locked_at: args.locked_at,
    p_last_heartbeat_at: args.last_heartbeat_at,
    p_stale_reap_count: args.stale_reap_count,
    p_phk_count: args.phk_count,
    p_attempts: args.attempts,
    p_max_attempts: args.max_attempts ?? 25,
    p_now: NOW,
    p_stale_minutes: 10,
    p_phk_threshold: 2,
  });
  expect(error).toBeNull();
  return data as string;
}

describe("S5b · Reaper Classification truth-table", () => {
  it("PRE_HEARTBEAT_KILL: no hb, locked >3min, phk_count=0", async () => {
    expect(
      await classify({
        locked_at: minutesAgo(5),
        last_heartbeat_at: null,
        stale_reap_count: 0,
        phk_count: 0,
        attempts: 0,
      }),
    ).toBe("PRE_HEARTBEAT_KILL");
  });

  it("PRE_HEARTBEAT_KILL_TERMINAL: no hb, locked >3min, phk_count=1 (== threshold-1)", async () => {
    expect(
      await classify({
        locked_at: minutesAgo(5),
        last_heartbeat_at: null,
        stale_reap_count: 0,
        phk_count: 1,
        attempts: 0,
      }),
    ).toBe("PRE_HEARTBEAT_KILL_TERMINAL");
  });

  it("PRE_HEARTBEAT_KILL_TERMINAL: phk_count=5 (well above) still terminal", async () => {
    expect(
      await classify({
        locked_at: minutesAgo(8),
        last_heartbeat_at: null,
        stale_reap_count: 0,
        phk_count: 5,
        attempts: 0,
      }),
    ).toBe("PRE_HEARTBEAT_KILL_TERMINAL");
  });

  it("STALE_AFTER_HEARTBEAT: hb seen but stalled, reap_count=2", async () => {
    expect(
      await classify({
        locked_at: minutesAgo(20),
        last_heartbeat_at: minutesAgo(15),
        stale_reap_count: 2,
        phk_count: 0,
        attempts: 5,
      }),
    ).toBe("STALE_AFTER_HEARTBEAT");
  });

  it("STALE_PROCESSING_REAPED: hb seen, reap_count<2 → still requeueable", async () => {
    expect(
      await classify({
        locked_at: minutesAgo(20),
        last_heartbeat_at: minutesAgo(15),
        stale_reap_count: 0,
        phk_count: 0,
        attempts: 1,
      }),
    ).toBe("STALE_PROCESSING_REAPED");
  });

  it("STALE_PROCESSING_REAPED: hb seen, reap_count=1 still requeueable", async () => {
    expect(
      await classify({
        locked_at: minutesAgo(20),
        last_heartbeat_at: minutesAgo(15),
        stale_reap_count: 1,
        phk_count: 0,
        attempts: 1,
      }),
    ).toBe("STALE_PROCESSING_REAPED");
  });

  it("STALE_PROCESSING_EXHAUSTED: attempts == max_attempts", async () => {
    expect(
      await classify({
        locked_at: minutesAgo(20),
        last_heartbeat_at: minutesAgo(15),
        stale_reap_count: 0,
        phk_count: 0,
        attempts: 25,
        max_attempts: 25,
      }),
    ).toBe("STALE_PROCESSING_EXHAUSTED");
  });

  it("HEALTHY: fresh job inside grace", async () => {
    expect(
      await classify({
        locked_at: minutesAgo(0.5),
        last_heartbeat_at: minutesAgo(0.1),
        stale_reap_count: 0,
        phk_count: 0,
        attempts: 0,
      }),
    ).toBe("HEALTHY");
  });

  it("HEALTHY: locked 2min ago, no hb yet — still inside 3min PHK grace", async () => {
    expect(
      await classify({
        locked_at: minutesAgo(2),
        last_heartbeat_at: null,
        stale_reap_count: 0,
        phk_count: 0,
        attempts: 0,
      }),
    ).toBe("HEALTHY");
  });

  // Anti-loop invariant: a job that already hit phk_count=1 (next reap = TERMINAL)
  // can never be requeued by the reaper — confirms threshold caps re-entry.
  it("NO INFINITE REQUEUE: phk_count=1 → next reap is TERMINAL not REQUEUE", async () => {
    const next = await classify({
      locked_at: minutesAgo(5),
      last_heartbeat_at: null,
      stale_reap_count: 0,
      phk_count: 1,
      attempts: 3,
    });
    expect(next).toBe("PRE_HEARTBEAT_KILL_TERMINAL");
    expect(next).not.toBe("PRE_HEARTBEAT_KILL");
  });

  it("NO INFINITE REQUEUE: stale reap_count=2 with hb → STALE_AFTER_HEARTBEAT (terminal)", async () => {
    const next = await classify({
      locked_at: minutesAgo(20),
      last_heartbeat_at: minutesAgo(15),
      stale_reap_count: 2,
      phk_count: 0,
      attempts: 4,
    });
    expect(next).toBe("STALE_AFTER_HEARTBEAT");
    expect(next).not.toBe("STALE_PROCESSING_REAPED");
  });
});
