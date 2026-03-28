/**
 * Wave 1C – Fehlerklasse 5: Zombie Jobs / Orphan Steps / Lease-Defekte
 *
 * HARDENED: Zero-tolerance for active anomalies.
 * - Detection views for building-without-lease MUST = 0
 * - Processing jobs > 2h = hard fail (zombie)
 * - Running steps > 60min without active job = hard fail (orphan)
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ══════════════════════════════════════════════
// DETECTION: ops_building_without_job_or_lease = 0
// ══════════════════════════════════════════════
Deno.test("D:ZOMBIE: ops_building_without_job_or_lease = 0", async () => {
  const { data, error } = await sb
    .from("ops_building_without_job_or_lease")
    .select("package_id, title, status, build_progress")
    .limit(10);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data);

  assertEquals(
    data!.length,
    0,
    `❌ INVARIANT VIOLATED: ${data!.length} packages are building without active job/lease. ` +
    `stuck-scan should have caught these. ` +
    `Packages: ${JSON.stringify(data!.slice(0, 3).map(r => `${r.package_id}: ${r.title}`))}`,
  );
});

// ══════════════════════════════════════════════
// DETECTION: ops_processing_stale (informational — count tracked)
// ══════════════════════════════════════════════
Deno.test("D:ZOMBIE: ops_processing_stale monitoring", async () => {
  const { data, error } = await sb
    .from("ops_processing_stale")
    .select("*")
    .limit(10);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data);
  console.log(`📊 ops_processing_stale: ${data!.length} entries`);

  // Soft threshold: more than 5 stale entries indicates stuck-scan is not working
  assert(
    data!.length <= 5,
    `❌ TOO MANY STALE: ${data!.length} processing-stale entries exceed threshold of 5. ` +
    `stuck-scan may not be running.`,
  );
});

// ══════════════════════════════════════════════
// DETECTION: ops_next_step_queued_no_job = 0
// ══════════════════════════════════════════════
Deno.test("D:ZOMBIE: ops_next_step_queued_no_job = 0", async () => {
  const { data, error } = await sb
    .from("ops_next_step_queued_no_job")
    .select("package_id, title, step_key, step_status, step_updated_at")
    .limit(10);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data);

  // Filter for entries older than 15 minutes (fresh queued is normal)
  const staleThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const staleEntries = data!.filter((d: any) => d.step_updated_at < staleThreshold);

  assertEquals(
    staleEntries.length,
    0,
    `❌ INVARIANT VIOLATED: ${staleEntries.length} steps queued > 15min without job. ` +
    `Orchestrator is not dispatching. ` +
    `Steps: ${JSON.stringify(staleEntries.slice(0, 3).map((s: any) => `${s.package_id}→${s.step_key}`))}`,
  );
});

// ══════════════════════════════════════════════
// INVARIANT: no running step > 60min without active job
// ══════════════════════════════════════════════
Deno.test("P:ZOMBIE: no orphan running steps (>60min, no active job)", async () => {
  const { data, error } = await sb
    .from("package_steps")
    .select("package_id, step_key, status, started_at")
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .limit(20);

  assertEquals(error, null);

  if (!data || data.length === 0) {
    console.log("✅ No steps running for >60min");
    return;
  }

  // Check if any of these have an active job
  const { data: jobs } = await sb
    .from("job_queue")
    .select("id, package_id, status")
    .in("package_id", data.map((d) => d.package_id))
    .eq("status", "processing")
    .limit(50);

  const jobPackages = new Set(jobs?.map((j) => j.package_id) ?? []);
  const orphans = data.filter((d) => !jobPackages.has(d.package_id));

  assertEquals(
    orphans.length,
    0,
    `❌ ORPHAN STEPS: ${orphans.length} steps running > 60min without active job. ` +
    `stuck-scan or lease-reclaim should have caught these. ` +
    `Orphans: ${JSON.stringify(orphans.slice(0, 5).map(o => `${o.package_id}→${o.step_key} (since ${o.started_at})`))}`,
  );
});

// ══════════════════════════════════════════════
// INVARIANT: no processing job older than 2 hours
// ══════════════════════════════════════════════
Deno.test("P:ZOMBIE: no zombie processing jobs (>2h)", async () => {
  const { data, error } = await sb
    .from("job_queue")
    .select("id, job_type, package_id, status, started_at")
    .eq("status", "processing")
    .lt("started_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .limit(10);

  assertEquals(error, null);

  assertEquals(
    data?.length ?? 0,
    0,
    `❌ ZOMBIE JOBS: ${data?.length} processing jobs older than 2h. ` +
    `stuck-scan should have reset these. ` +
    `Jobs: ${JSON.stringify(data?.slice(0, 3).map(j => `${j.id}: ${j.job_type} (pkg=${j.package_id}, since ${j.started_at})`))}`,
  );
});
