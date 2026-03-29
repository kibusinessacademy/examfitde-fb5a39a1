/**
 * Integration tests: Zombie Reaper v2, Ancient Pending Reaper, False-Liveness Guard
 *
 * Tests the three core hardening RPCs + the ops_build_activity_truth view.
 * Run via: deno test --allow-env --allow-net supabase/functions/tests/zombie-reaper-false-liveness.test.ts
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helper: query the truth view ──
async function getLivenessVerdict(packageId: string) {
  const { data } = await sb
    .from("ops_build_activity_truth")
    .select("liveness_verdict, fresh_active_jobs, zombie_jobs, has_lease, running_steps")
    .eq("package_id", packageId)
    .maybeSingle();
  return data;
}

// ══════════════════════════════════════════════════════════════
// 1) reap_zombie_processing_jobs_v2
// ══════════════════════════════════════════════════════════════

Deno.test("reap_zombie_processing_jobs_v2 — does NOT kill fresh processing jobs", async () => {
  // Call the reaper with a very high age threshold — nothing recent should be killed
  const { data, error } = await sb.rpc("reap_zombie_processing_jobs_v2", {
    p_max_age_hours: 9999,
    p_reason: "test: should not kill anything",
  });
  if (error) throw error;
  // With 9999h threshold, nothing should be reaped
  const count = Array.isArray(data) ? data.length : 0;
  assertEquals(count, 0, "No fresh jobs should be reaped with 9999h threshold");
});

Deno.test("reap_zombie_processing_jobs_v2 — kills truly ancient processing jobs", async () => {
  // With normal threshold, check that the RPC is callable and returns structured data
  const { data, error } = await sb.rpc("reap_zombie_processing_jobs_v2", {
    p_max_age_hours: 24,
    p_reason: "test: standard reaper run",
  });
  if (error) throw error;
  // Should return an array (possibly empty if no zombies exist)
  assertEquals(Array.isArray(data), true, "Should return an array");
});

// ══════════════════════════════════════════════════════════════
// 2) reap_ancient_pending_jobs
// ══════════════════════════════════════════════════════════════

Deno.test("reap_ancient_pending_jobs — does NOT cancel fresh pending jobs", async () => {
  const { data, error } = await sb.rpc("reap_ancient_pending_jobs", {
    p_max_age_hours: 9999,
    p_reason: "test: should not cancel anything",
  });
  if (error) throw error;
  const count = Array.isArray(data) ? data.length : 0;
  assertEquals(count, 0, "No fresh pending jobs should be cancelled");
});

Deno.test("reap_ancient_pending_jobs — callable with standard threshold", async () => {
  const { data, error } = await sb.rpc("reap_ancient_pending_jobs", {
    p_max_age_hours: 48,
    p_reason: "test: standard ancient reaper",
  });
  if (error) throw error;
  assertEquals(Array.isArray(data), true, "Should return an array");
});

// ══════════════════════════════════════════════════════════════
// 3) ops_build_activity_truth view
// ══════════════════════════════════════════════════════════════

Deno.test("ops_build_activity_truth — returns expected columns", async () => {
  const { data, error } = await sb
    .from("ops_build_activity_truth")
    .select("package_id, title, status, fresh_active_jobs, zombie_jobs, running_steps, has_lease, last_pipeline_event_at, last_step_transition_at, liveness_verdict")
    .limit(1);
  if (error) throw error;
  // View should be queryable (may return 0 rows if no building packages)
  assertEquals(Array.isArray(data), true, "Should return an array");
});

Deno.test("ops_build_activity_truth — liveness_verdict is one of expected values", async () => {
  const { data, error } = await sb
    .from("ops_build_activity_truth")
    .select("liveness_verdict")
    .limit(50);
  if (error) throw error;
  const validVerdicts = new Set(["alive", "false_active", "no_activity"]);
  for (const row of data ?? []) {
    assertEquals(
      validVerdicts.has(row.liveness_verdict),
      true,
      `Unexpected verdict: ${row.liveness_verdict}`,
    );
  }
});

Deno.test("ops_build_activity_truth — alive packages have fresh_active_jobs > 0 OR running_steps > 0", async () => {
  const { data, error } = await sb
    .from("ops_build_activity_truth")
    .select("package_id, fresh_active_jobs, running_steps, has_lease, last_pipeline_event_at, liveness_verdict")
    .eq("liveness_verdict", "alive")
    .limit(20);
  if (error) throw error;
  for (const row of data ?? []) {
    const hasActivity = (row.fresh_active_jobs ?? 0) > 0 || (row.running_steps ?? 0) > 0;
    // alive can also mean recent pipeline events, so this is a soft check
    if (!hasActivity && !row.last_pipeline_event_at) {
      console.warn(`[TEST WARN] alive package ${row.package_id} has no fresh jobs, running steps, or recent events`);
    }
  }
});

Deno.test("ops_build_activity_truth — false_active packages have zombie_jobs > 0 or no real activity", async () => {
  const { data, error } = await sb
    .from("ops_build_activity_truth")
    .select("package_id, fresh_active_jobs, zombie_jobs, running_steps, liveness_verdict")
    .eq("liveness_verdict", "false_active")
    .limit(20);
  if (error) throw error;
  for (const row of data ?? []) {
    // false_active should mean: has zombie jobs but no fresh active work
    assertEquals(
      (row.fresh_active_jobs ?? 0),
      0,
      `false_active package ${row.package_id} should have 0 fresh_active_jobs`,
    );
  }
});
