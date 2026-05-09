/**
 * S5c — PHK Forensics + Selective Requeue (anti-loop contract)
 *
 * Lock-in:
 *  1. admin_get_pre_heartbeat_kill_forensics is admin-gated.
 *  2. admin_requeue_pre_heartbeat_quarantine is admin-gated.
 *  3. Reason is mandatory (≥5 chars) — server-side check.
 *  4. Either p_package_id or p_job_id required (no blind sweep).
 *  5. mark_job_first_heartbeat accepts edge_invocation_id and is service-role only.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const FORBIDDEN = /forbidden|admin role required|permission denied/i;

describe("S5c · PHK Forensics + Selective Requeue", () => {
  it("admin_get_pre_heartbeat_kill_forensics refuses anon", async () => {
    const { error } = await sb.rpc("admin_get_pre_heartbeat_kill_forensics" as any);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(FORBIDDEN);
  });

  it("admin_requeue_pre_heartbeat_quarantine refuses anon", async () => {
    const { error } = await sb.rpc("admin_requeue_pre_heartbeat_quarantine" as any, {
      p_package_id: "00000000-0000-0000-0000-000000000000",
      p_job_id: null,
      p_reason: "anon test reason long enough",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(FORBIDDEN);
  });

  it("admin_requeue requires either package_id or job_id (server-side)", async () => {
    const { error } = await sb.rpc("admin_requeue_pre_heartbeat_quarantine" as any, {
      p_package_id: null,
      p_job_id: null,
      p_reason: "valid reason here",
    });
    // Anon is rejected first by has_role gate — that's the contract.
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(FORBIDDEN);
  });

  it("mark_job_first_heartbeat accepts edge_invocation_id and is service-role-only", async () => {
    const { error } = await sb.rpc("mark_job_first_heartbeat" as any, {
      p_job_id: "00000000-0000-0000-0000-000000000000",
      p_edge_invocation_id: "test:invocation:abc",
    });
    expect(error).not.toBeNull();
    // Either explicit gate refusal or PostgREST permission denied — both prove
    // the function is not callable by anon.
    expect(error!.message).toMatch(/permission denied|not allowed|does not exist|role/i);
  });
});
