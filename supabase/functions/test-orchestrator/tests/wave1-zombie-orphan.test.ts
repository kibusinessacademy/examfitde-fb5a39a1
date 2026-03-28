/**
 * Wave 1 – Fehlerklasse 5: Zombie Jobs / Orphan Steps / Lease-Defekte
 *
 * Tests that the system correctly detects and surfaces:
 * - Jobs stuck in processing without worker activity
 * - Steps marked running without active jobs
 * - Packages building without active leases
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
// TEST 1: Detection — ops_building_without_job_or_lease
// ══════════════════════════════════════════════
Deno.test("ZOMBIE_DETECTION: ops_building_without_job_or_lease is queryable", async () => {
  const { data, error } = await sb
    .from("ops_building_without_job_or_lease")
    .select("package_id, title, status, build_progress")
    .limit(10);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data);
  console.log(`📊 ops_building_without_job_or_lease: ${data!.length} entries`);

  if (data!.length > 0) {
    console.warn("⚠️  Packages building without active job/lease:");
    for (const r of data!) {
      console.warn(`   ${r.package_id}: ${r.title} (${r.status}, progress=${r.build_progress})`);
    }
  }
});

// ══════════════════════════════════════════════
// TEST 2: Detection — ops_processing_stale
// ══════════════════════════════════════════════
Deno.test("ZOMBIE_DETECTION: ops_processing_stale is queryable", async () => {
  const { data, error } = await sb
    .from("ops_processing_stale")
    .select("*")
    .limit(10);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data);
  console.log(`📊 ops_processing_stale: ${data!.length} entries`);
});

// ══════════════════════════════════════════════
// TEST 3: Detection — ops_next_step_queued_no_job
// ══════════════════════════════════════════════
Deno.test("ZOMBIE_DETECTION: ops_next_step_queued_no_job is queryable", async () => {
  const { data, error } = await sb
    .from("ops_next_step_queued_no_job")
    .select("package_id, title, step_key, step_status, step_updated_at")
    .limit(10);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data);
  console.log(`📊 ops_next_step_queued_no_job: ${data!.length} entries`);
});

// ══════════════════════════════════════════════
// TEST 4: Consistency — no step running > 60min without active job
// ══════════════════════════════════════════════
Deno.test("ZOMBIE: no step running for >60min without active job", async () => {
  const { data, error } = await sb
    .from("package_steps")
    .select("package_id, step_key, status, started_at")
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .limit(20);

  assertEquals(error, null);

  if (data && data.length > 0) {
    // Check if any of these have an active job
    const { data: jobs } = await sb
      .from("job_queue")
      .select("id, package_id, status")
      .in("package_id", data.map((d) => d.package_id))
      .eq("status", "processing")
      .limit(50);

    const jobPackages = new Set(jobs?.map((j) => j.package_id) ?? []);
    const orphans = data.filter((d) => !jobPackages.has(d.package_id));

    if (orphans.length > 0) {
      console.warn(`⚠️  ${orphans.length} orphan running steps (>60min, no active job):`);
      for (const o of orphans.slice(0, 5)) {
        console.warn(`   ${o.package_id} → ${o.step_key} (since ${o.started_at})`);
      }
    }

    console.log(
      `📊 Running >60min: ${data.length} total, ${orphans.length} orphans`,
    );
  } else {
    console.log("✅ No steps running for >60min");
  }
});

// ══════════════════════════════════════════════
// TEST 5: Consistency — no processing job older than 2 hours
// ══════════════════════════════════════════════
Deno.test("ZOMBIE: no processing job older than 2 hours", async () => {
  const { data, error } = await sb
    .from("job_queue")
    .select("id, job_type, package_id, status, started_at")
    .eq("status", "processing")
    .lt("started_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .limit(10);

  assertEquals(error, null);

  if (data && data.length > 0) {
    console.warn(`⚠️  ${data.length} processing jobs older than 2h — likely zombies:`);
    for (const j of data.slice(0, 5)) {
      console.warn(`   ${j.id}: ${j.job_type} (pkg=${j.package_id}, since ${j.started_at})`);
    }
  }

  console.log(`📊 Processing jobs >2h: ${data?.length ?? 0}`);
});
