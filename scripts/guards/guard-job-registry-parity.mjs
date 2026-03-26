#!/usr/bin/env node
/**
 * CI Guard: Job-Type Registry Parity
 * 
 * Ensures every job type in _shared/job-map.ts JOB_DEFINITIONS
 * is also present in the DB table ops_job_type_registry, and vice versa.
 *
 * Run: node scripts/guards/guard-job-registry-parity.mjs
 * 
 * Exit 0 = parity OK
 * Exit 1 = drift detected
 */

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// ── 1. Extract job types from job-map.ts ──

const jobMapPath = "supabase/functions/_shared/job-map.ts";
const src = readFileSync(jobMapPath, "utf-8");

// Parse JOB_DEFINITIONS keys from source
const defBlock = src.slice(
  src.indexOf("export const JOB_DEFINITIONS"),
  src.indexOf("// ── Backward-compatible derived maps")
);

const codeTypes = new Set(
  [...defBlock.matchAll(/^\s*["']?(\w+)["']?\s*:/gm)].map(m => m[1])
);

// Remove the object name itself
codeTypes.delete("JOB_DEFINITIONS");

console.log(`[registry-parity] Found ${codeTypes.size} job types in ${jobMapPath}`);

// ── 2. Fetch DB registry ──

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("[registry-parity] SKIP: No Supabase credentials available (CI-only guard).");
  process.exit(0);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const { data: dbRows, error } = await sb
  .from("ops_job_type_registry")
  .select("job_type")
  .limit(500);

if (error) {
  console.error("[registry-parity] DB query failed:", error.message);
  process.exit(1);
}

const dbTypes = new Set(dbRows.map(r => r.job_type));
console.log(`[registry-parity] Found ${dbTypes.size} job types in ops_job_type_registry`);

// ── 3. Compare ──

const inCodeOnly = [...codeTypes].filter(t => !dbTypes.has(t));
const inDbOnly = [...dbTypes].filter(t => !codeTypes.has(t));

let failed = false;

if (inCodeOnly.length > 0) {
  console.error(`\n❌ IN CODE BUT NOT IN DB (${inCodeOnly.length}):`);
  inCodeOnly.forEach(t => console.error(`   - ${t}`));
  console.error("   → Add these to ops_job_type_registry via migration.");
  failed = true;
}

if (inDbOnly.length > 0) {
  console.error(`\n❌ IN DB BUT NOT IN CODE (${inDbOnly.length}):`);
  inDbOnly.forEach(t => console.error(`   - ${t}`));
  console.error("   → Add these to JOB_DEFINITIONS in _shared/job-map.ts or remove from DB.");
  failed = true;
}

if (!failed) {
  console.log("\n✅ Registry parity OK — code and DB are in sync.");
}

process.exit(failed ? 1 : 0);
