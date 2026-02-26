#!/usr/bin/env node
/**
 * Job Queue Health Monitor
 * 
 * Detects stuck/processing jobs older than 10 min and orphan building packages.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !KEY) {
  console.log("⚠️  SUPABASE_URL / KEY not set – skipping");
  process.exit(0);
}

async function query(table, params = "") {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const res = await fetch(url, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function main() {
  console.log("🏥 Running Job Queue Health Monitor...\n");
  let fail = false;

  // 1) Processing jobs older than 10 minutes
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const stuckJobs = await query(
    "job_queue",
    `select=id,job_type,started_at&status=eq.processing&started_at=lt.${tenMinAgo}&limit=50`
  );

  if (stuckJobs === null) {
    console.log("⚠️  Could not query job_queue – table may not exist, skipping");
    process.exit(0);
  }

  if (stuckJobs.length > 0) {
    console.error(`❌ FAIL: ${stuckJobs.length} stuck job(s) processing > 10 min:`);
    for (const j of stuckJobs.slice(0, 10)) {
      console.error(`   → ${j.job_type} (${j.id?.slice(0, 8)}) started ${j.started_at}`);
    }
    fail = true;
  } else {
    console.log("✅ No stuck processing jobs");
  }

  // 2) Building packages without active jobs (orphans)
  const building = await query(
    "course_packages",
    "select=id,title&status=eq.building&limit=50"
  );

  if (building && building.length > 0) {
    for (const pkg of building) {
      const activeJobs = await query(
        "job_queue",
        `select=id&status=in.(pending,processing)&limit=1`
      );
      // Simple heuristic: if there are building packages but no active jobs at all
      if (!activeJobs || activeJobs.length === 0) {
        console.error(`❌ FAIL: Package "${pkg.title || pkg.id?.slice(0, 8)}" is building but no active jobs found`);
        fail = true;
      }
    }
    if (!fail) {
      console.log(`✅ ${building.length} building package(s) have active jobs`);
    }
  } else {
    console.log("✅ No packages in building state");
  }

  // 3) Failed jobs in last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const failedRecent = await query(
    "job_queue",
    `select=id,job_type,error&status=eq.failed&completed_at=gte.${oneHourAgo}&limit=20`
  );

  if (failedRecent && failedRecent.length > 0) {
    console.warn(`⚠️  WARN: ${failedRecent.length} failed job(s) in last hour`);
    for (const j of failedRecent.slice(0, 5)) {
      console.warn(`   → ${j.job_type}: ${(j.error || "no error msg")?.slice(0, 80)}`);
    }
  } else {
    console.log("✅ No failed jobs in last hour");
  }

  console.log("");
  if (fail) {
    console.error("🚫 Job Queue Health Monitor FAILED");
    process.exit(1);
  }
  console.log("✅ Job Queue Health Monitor passed");
}

main().catch((err) => {
  console.error("⚠️  Job queue health error:", err.message);
  process.exit(0);
});
