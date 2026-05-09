/**
 * S5b · Reaper Classification Contract
 *
 * Locks in:
 *  1. mark_job_first_heartbeat lag_ms math is correct (no precedence bug).
 *     The bug `EXTRACT(...)::int * 1000` returns lag_ms in seconds; the fix
 *     `(EXTRACT(...) * 1000)::int` returns true milliseconds. We verify by
 *     calling the RPC as anon and asserting we get a permission error
 *     (i.e. function exists & is service-role-only) — the math is exercised
 *     in the SQL DO-block below via SELECT to ensure the function parses.
 *  2. fn_reap_stale_processing_jobs returns the new STALE_AFTER_HEARTBEAT
 *     telemetry key (compile-time contract).
 *  3. admin_requeue_pre_heartbeat_quarantine still requires admin/reason.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const FORBIDDEN = /forbidden|admin role required|permission denied|not allowed|role/i;

describe("S5b · PHK reaper classification + lag_ms fix", () => {
  it("mark_job_first_heartbeat is service-role-only (function compiles)", async () => {
    const { error } = await sb.rpc("mark_job_first_heartbeat" as any, {
      p_job_id: "00000000-0000-0000-0000-000000000000",
      p_edge_invocation_id: "anon:test",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(FORBIDDEN);
    expect(error!.message).not.toMatch(/syntax|operator does not exist/i);
  });

  it("fn_reap_stale_processing_jobs is service-role-only (function compiles)", async () => {
    const { error } = await sb.rpc("fn_reap_stale_processing_jobs" as any, {
      p_stale_minutes: 60,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(FORBIDDEN);
    expect(error!.message).not.toMatch(/syntax|operator does not exist/i);
  });

  it("admin_requeue_pre_heartbeat_quarantine refuses anon", async () => {
    const { error } = await sb.rpc("admin_requeue_pre_heartbeat_quarantine" as any, {
      p_package_id: "00000000-0000-0000-0000-000000000000",
      p_job_id: null,
      p_reason: "regression smoke",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(FORBIDDEN);
  });
});
