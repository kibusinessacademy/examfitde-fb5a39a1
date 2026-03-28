/**
 * Wave 1C – Fehlerklasse 5: Zombie Jobs / Orphan Steps / Lease-Defekte
 *
 * HARDENED v2: SSOT thresholds from audit-thresholds.ts, exact counts,
 * skip-audit tracking.
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  STALE_QUEUED_MINUTES,
  ORPHAN_RUNNING_MINUTES,
  ZOMBIE_PROCESSING_HOURS,
  MAX_STALE_PROCESSING_ENTRIES,
} from "../../_shared/audit-thresholds.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ══════════════════════════════════════════════
// DETECTION: ops_building_without_job_or_lease = 0
// ══════════════════════════════════════════════
Deno.test("D:ZOMBIE: ops_building_without_job_or_lease = 0", async () => {
  const { count, error } = await sb
    .from("ops_building_without_job_or_lease")
    .select("package_id", { count: "exact", head: true });

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertEquals(
    count ?? 0,
    0,
    `❌ INVARIANT VIOLATED: ${count} packages are building without active job/lease. ` +
    `stuck-scan should have caught these.`,
  );
});

// ══════════════════════════════════════════════
// DETECTION: ops_processing_stale (threshold from SSOT)
// ══════════════════════════════════════════════
Deno.test("D:ZOMBIE: ops_processing_stale within budget", async () => {
  const { count, error } = await sb
    .from("ops_processing_stale")
    .select("*", { count: "exact", head: true });

  assertEquals(error, null, `View query failed: ${error?.message}`);
  console.log(`📊 ops_processing_stale: ${count} entries (budget: ${MAX_STALE_PROCESSING_ENTRIES})`);

  assert(
    (count ?? 0) <= MAX_STALE_PROCESSING_ENTRIES,
    `❌ TOO MANY STALE: ${count} processing-stale entries exceed threshold of ${MAX_STALE_PROCESSING_ENTRIES}. ` +
    `stuck-scan may not be running.`,
  );
});

// ══════════════════════════════════════════════
// DETECTION: ops_next_step_queued_no_job = 0 (stale > SSOT threshold)
// ══════════════════════════════════════════════
Deno.test("D:ZOMBIE: ops_next_step_queued_no_job = 0 (stale)", async () => {
  const { data, error } = await sb
    .from("ops_next_step_queued_no_job")
    .select("package_id, title, step_key, step_status, step_updated_at")
    .limit(100);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data);

  const staleThreshold = new Date(Date.now() - STALE_QUEUED_MINUTES * 60 * 1000).toISOString();
  const staleEntries = data!.filter((d: any) => d.step_updated_at < staleThreshold);

  assertEquals(
    staleEntries.length,
    0,
    `❌ INVARIANT VIOLATED: ${staleEntries.length} steps queued > ${STALE_QUEUED_MINUTES}min without job. ` +
    `Steps: ${JSON.stringify(staleEntries.slice(0, 5).map((s: any) => `${s.package_id}→${s.step_key}`))}`,
  );
});

// ══════════════════════════════════════════════
// INVARIANT: no running step > ORPHAN_RUNNING_MINUTES without active job
// ══════════════════════════════════════════════
Deno.test("P:ZOMBIE: no orphan running steps", async () => {
  const cutoff = new Date(Date.now() - ORPHAN_RUNNING_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("package_steps")
    .select("package_id, step_key, status, started_at")
    .eq("status", "running")
    .lt("started_at", cutoff)
    .limit(50);

  assertEquals(error, null);

  if (!data || data.length === 0) {
    console.log(`✅ No steps running for >${ORPHAN_RUNNING_MINUTES}min`);
    return;
  }

  const { data: jobs } = await sb
    .from("job_queue")
    .select("id, package_id, status")
    .in("package_id", data.map((d) => d.package_id))
    .eq("status", "processing")
    .limit(200);

  const jobPackages = new Set(jobs?.map((j) => j.package_id) ?? []);
  const orphans = data.filter((d) => !jobPackages.has(d.package_id));

  assertEquals(
    orphans.length,
    0,
    `❌ ORPHAN STEPS: ${orphans.length} steps running > ${ORPHAN_RUNNING_MINUTES}min without active job. ` +
    `Orphans: ${JSON.stringify(orphans.slice(0, 5).map(o => `${o.package_id}→${o.step_key}`))}`,
  );
});

// ══════════════════════════════════════════════
// INVARIANT: no processing job older than ZOMBIE_PROCESSING_HOURS
// ══════════════════════════════════════════════
Deno.test("P:ZOMBIE: no zombie processing jobs", async () => {
  const cutoff = new Date(Date.now() - ZOMBIE_PROCESSING_HOURS * 60 * 60 * 1000).toISOString();
  const { count, error } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .lt("started_at", cutoff);

  assertEquals(error, null);
  assertEquals(
    count ?? 0,
    0,
    `❌ ZOMBIE JOBS: ${count} processing jobs older than ${ZOMBIE_PROCESSING_HOURS}h. ` +
    `stuck-scan should have reset these.`,
  );
});
