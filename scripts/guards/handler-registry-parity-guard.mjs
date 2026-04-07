#!/usr/bin/env node
/**
 * CI Guard: Handler-Registry Parity
 *
 * Hard-fail if any job_type in JOB_DEFINITIONS lacks an edgeFunction,
 * unless it's a known infra job (pipeline_tick, stuck_scan, etc.).
 *
 * Also warns about pool mismatches between runner claim pools and
 * JOB_DEFINITIONS pool assignments.
 *
 * Run: node scripts/guards/handler-registry-parity-guard.mjs
 */

import { readFileSync } from "fs";

const INFRA_JOBS = new Set([
  "pipeline_tick",
  "stuck_scan",
  "expire_store_subscriptions",
  "process_lti_grade_passback",
]);

// ── 1. Parse JOB_DEFINITIONS from job-map.ts ──
const jobMapPath = "supabase/functions/_shared/job-map.ts";
const src = readFileSync(jobMapPath, "utf-8");

const defStart = src.indexOf("export const JOB_DEFINITIONS");
const defEnd = src.indexOf("// ── Backward-compatible derived maps");
if (defStart === -1 || defEnd === -1) {
  console.error("❌ Could not locate JOB_DEFINITIONS block in job-map.ts");
  process.exit(1);
}

const defBlock = src.slice(defStart, defEnd);

// Extract all job type keys
const jobTypes = [...defBlock.matchAll(/^\s*["']?(\w+)["']?\s*:/gm)]
  .map(m => m[1])
  .filter(k => k !== "JOB_DEFINITIONS");

// Extract which ones have edgeFunction
const withEdgeFn = new Set();
const lines = defBlock.split("\n");
let currentKey = null;
for (const line of lines) {
  const keyMatch = line.match(/^\s*["']?(\w+)["']?\s*:\s*\{/);
  if (keyMatch) currentKey = keyMatch[1];
  if (currentKey && line.includes("edgeFunction")) {
    withEdgeFn.add(currentKey);
  }
}

// ── 2. Check for missing handlers ──
const missingHandler = jobTypes.filter(jt => !withEdgeFn.has(jt) && !INFRA_JOBS.has(jt));
let failed = false;

if (missingHandler.length > 0) {
  console.error(`\n❌ JOB TYPES WITHOUT EDGE FUNCTION HANDLER (${missingHandler.length}):`);
  missingHandler.forEach(jt => console.error(`   - ${jt}`));
  console.error("   → Add edgeFunction mapping in JOB_DEFINITIONS or add to INFRA_JOBS exemption.");
  failed = true;
}

// ── 3. Check runner pool alignment ──
const runnerPath = "supabase/functions/content-runner/index.ts";
const runnerSrc = readFileSync(runnerPath, "utf-8");
const poolMatches = [...runnerSrc.matchAll(/p_worker_pool:\s*["'](\w+)["']/g)].map(m => m[1]);
const claimedPools = new Set(poolMatches);

// Extract pools from JOB_DEFINITIONS
const poolEntries = [...defBlock.matchAll(/["']?(\w+)["']?\s*:\s*\{[^}]*pool:\s*["'](\w+)["']/g)];
const definedPools = new Set(poolEntries.map(m => m[2]));

const unclaimedPools = [...definedPools].filter(p => !claimedPools.has(p));
if (unclaimedPools.length > 0) {
  console.warn(`\n⚠️  POOLS IN JOB_DEFINITIONS NOT CLAIMED BY RUNNER: ${unclaimedPools.join(", ")}`);
  console.warn("   → Runner may never pick up jobs in these pools.");
}

// ── 4. Summary ──
console.log(`\n[handler-parity] ${jobTypes.length} job types, ${withEdgeFn.size} with handlers, ${INFRA_JOBS.size} infra exemptions`);
console.log(`[handler-parity] Runner claims pools: ${[...claimedPools].join(", ")}`);
console.log(`[handler-parity] JOB_DEFINITIONS pools: ${[...definedPools].join(", ")}`);

if (!failed) {
  console.log("\n✅ Handler-Registry Parity OK — every dispatchable job type has an edgeFunction.");
}

process.exit(failed ? 1 : 0);
