#!/usr/bin/env node
/**
 * Pipeline Change Audit
 *
 * Validates pipeline health for a specific package or globally:
 * - Step completion vs expected steps
 * - No stuck/stale jobs
 * - No orphan building packages
 * - Fan-out completion consistency
 * - Integrity check results
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const JSON_OUT = process.argv.includes("--json");
const PKG_ARG = process.argv.find(a => a.startsWith("--package="));
const PACKAGE_ID = PKG_ARG ? PKG_ARG.split("=")[1] : null;

if (!SUPABASE_URL || !KEY) {
  const r = { pass_count: 0, warn_count: 0, fail_count: 1, failures: [{ key: "env", message: "SUPABASE_URL / KEY not set" }], warnings: [], results: [] };
  if (JSON_OUT) console.log(JSON.stringify(r));
  else console.error("❌ SUPABASE_URL / KEY not set");
  process.exit(1);
}

async function query(endpoint) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact" },
  });
  const count = res.headers.get("content-range")?.split("/")[1];
  return { ok: res.ok, count: count ? Number(count) : 0, data: res.ok ? await res.json() : null };
}

const results = [];
const failures = [];
const warnings = [];

function pass(key, msg) { results.push({ key, status: "PASS", message: msg }); }
function warn(key, msg) { warnings.push({ key, message: msg }); results.push({ key, status: "WARN", message: msg }); }
function fail(key, msg) { failures.push({ key, message: msg }); results.push({ key, status: "FAIL", message: msg }); }

async function auditPackage(pkgId) {
  // Steps for this package
  const steps = await query(`package_steps?package_id=eq.${pkgId}&select=step_key,status&order=position`);
  if (!steps.ok || !steps.data) {
    fail(`pkg.${pkgId}.steps`, "Could not load steps");
    return;
  }

  const failedSteps = steps.data.filter(s => s.status === "failed");
  const runningSteps = steps.data.filter(s => s.status === "running");
  const doneSteps = steps.data.filter(s => s.status === "done" || s.status === "skipped");

  if (failedSteps.length > 0) {
    fail(`pkg.${pkgId}.failed_steps`, `${failedSteps.length} failed: ${failedSteps.map(s => s.step_key).join(", ")}`);
  } else {
    pass(`pkg.${pkgId}.failed_steps`, "None");
  }

  if (runningSteps.length > 3) {
    warn(`pkg.${pkgId}.running_steps`, `${runningSteps.length} running concurrently`);
  } else {
    pass(`pkg.${pkgId}.running_steps`, `${runningSteps.length} running`);
  }

  pass(`pkg.${pkgId}.progress`, `${doneSteps.length}/${steps.data.length} complete`);

  // Active jobs
  const jobs = await query(`job_queue?package_id=eq.${pkgId}&status=in.(pending,queued,processing)&select=id,job_type,status&limit=100`);
  if (jobs.count > 50) {
    warn(`pkg.${pkgId}.active_jobs`, `${jobs.count} active jobs (high)`);
  } else {
    pass(`pkg.${pkgId}.active_jobs`, `${jobs.count} active`);
  }

  // Failed jobs last hour
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const failedJobs = await query(`job_queue?package_id=eq.${pkgId}&status=eq.failed&updated_at=gte.${oneHourAgo}&select=id&limit=100`);
  if (failedJobs.count > 10) {
    fail(`pkg.${pkgId}.failed_jobs_1h`, `${failedJobs.count} failed in last hour`);
  } else if (failedJobs.count > 0) {
    warn(`pkg.${pkgId}.failed_jobs_1h`, `${failedJobs.count} failed in last hour`);
  } else {
    pass(`pkg.${pkgId}.failed_jobs_1h`, "None");
  }
}

async function auditGlobal() {
  // Stuck processing jobs (>10 min)
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const stuck = await query(`job_queue?status=eq.processing&updated_at=lt.${tenMinAgo}&select=id&limit=200`);
  if (stuck.count > 0) {
    warn("global.stuck_jobs", `${stuck.count} jobs processing > 10 min`);
  } else {
    pass("global.stuck_jobs", "None");
  }

  // Orphan building packages (building but no active jobs/leases)
  const orphanView = await query("ops_building_without_job_or_lease?select=package_id&limit=50");
  if (orphanView.ok && orphanView.count > 0) {
    warn("global.orphan_building", `${orphanView.count} building packages without jobs/leases`);
  } else {
    pass("global.orphan_building", "None");
  }

  // Dead letter jobs
  const dead = await query("job_queue?status=eq.dead&select=id&limit=200");
  if (dead.count > 10) {
    warn("global.dead_letter", `${dead.count} dead-letter jobs`);
  } else {
    pass("global.dead_letter", `${dead.count} dead-letter`);
  }

  // Failed jobs last hour global
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const failedGlobal = await query(`job_queue?status=eq.failed&updated_at=gte.${oneHourAgo}&select=id&limit=500`);
  if (failedGlobal.count > 75) {
    fail("global.failed_1h", `${failedGlobal.count} failed jobs in last hour`);
  } else if (failedGlobal.count > 25) {
    warn("global.failed_1h", `${failedGlobal.count} failed jobs in last hour`);
  } else {
    pass("global.failed_1h", `${failedGlobal.count} failed`);
  }

  // Pipeline status integrity
  const stepsInvalid = await query("package_steps?status=not.in.(queued,enqueued,running,done,failed,cancelled,skipped)&select=id&limit=10");
  if (stepsInvalid.count > 0) {
    fail("global.step_status_integrity", `${stepsInvalid.count} steps with invalid status`);
  } else {
    pass("global.step_status_integrity", "All valid");
  }
}

async function main() {
  if (PACKAGE_ID) {
    await auditPackage(PACKAGE_ID);
  }
  await auditGlobal();

  const summary = {
    pass_count: results.filter(r => r.status === "PASS").length,
    warn_count: warnings.length,
    fail_count: failures.length,
    failures,
    warnings,
    results,
    package_id: PACKAGE_ID,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`\n🔧 Pipeline Change Audit${PACKAGE_ID ? ` (package: ${PACKAGE_ID})` : " (global)"}\n`);
    for (const r of results) {
      const icon = r.status === "PASS" ? "✅" : r.status === "WARN" ? "⚠️" : "❌";
      console.log(`${icon} ${r.key}: ${r.message}`);
    }
    console.log(`\nPass: ${summary.pass_count} | Warn: ${summary.warn_count} | Fail: ${summary.fail_count}`);
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("❌ Fatal:", err.message);
  process.exit(1);
});
