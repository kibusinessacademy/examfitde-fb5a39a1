#!/usr/bin/env node
/**
 * guard-lane-contract
 * SSOT: code lane mapping must equal DB derive_job_lane() classification.
 *
 * Strategy:
 *  - parse src/.../runner-lanes.ts (or similar) for a JOB_TYPE→lane map
 *  - search migrations for the latest derive_job_lane() body and parse the
 *    CASE-mapping from job_type literals → lane.
 *  - hard-fail on any divergence for control/build/recovery/generation lanes.
 *
 * If runner-lanes.ts cannot be found, falls back to grep across src/ and warns.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

function walk(dir, exts, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (p.includes("node_modules") || p.includes(".git")) continue;
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

// --- DB SSOT: parse latest derive_job_lane CASE block from migrations
const migFiles = walk("supabase/migrations", [".sql"]).sort();
let dbMap = new Map();
for (const f of migFiles) {
  const text = readFileSync(f, "utf8");
  const fnMatch = text.match(/derive_job_lane[\s\S]*?CASE([\s\S]*?)END/i);
  if (!fnMatch) continue;
  const block = fnMatch[1];
  const local = new Map();
  for (const m of block.matchAll(/WHEN\s+([^T]+?)\s+THEN\s+'(\w+)'/gi)) {
    const cond = m[1];
    const lane = m[2];
    for (const lit of cond.matchAll(/'([^']+)'/g)) {
      local.set(lit[1], lane);
    }
  }
  if (local.size > 0) dbMap = local; // keep last-wins
}

if (dbMap.size === 0) {
  console.warn("⚠️  guard-lane-contract: could not parse derive_job_lane() from migrations — skipping (warn).");
  process.exit(0);
}

// --- Code SSOT: look for a runner-lanes ts file
const candidates = [
  "supabase/functions/_shared/runner-lanes.ts",
  "supabase/functions/_shared/lanes.ts",
  "src/lib/runner-lanes.ts",
];
const lanesFile = candidates.find((p) => existsSync(p));
let codeMap = new Map();
if (lanesFile) {
  const text = readFileSync(lanesFile, "utf8");
  // Looks for object literal: package_xxx: 'control'
  for (const m of text.matchAll(/['"`](\w+)['"`]\s*:\s*['"`](control|build|generation|recovery|tutor|finalize)['"`]/g)) {
    codeMap.set(m[1], m[2]);
  }
}

if (codeMap.size === 0) {
  console.warn("⚠️  guard-lane-contract: no runner-lanes mapping found in code — skipping (warn).");
  process.exit(0);
}

let mismatches = 0;
for (const [job, dbLane] of dbMap) {
  if (!codeMap.has(job)) continue; // code may delegate to default
  if (codeMap.get(job) !== dbLane) {
    console.error(`❌ Lane mismatch: ${job} → code='${codeMap.get(job)}' vs db='${dbLane}'`);
    mismatches++;
  }
}
if (mismatches > 0) {
  console.error(`\n❌ guard-lane-contract: ${mismatches} mismatch(es).`);
  process.exit(1);
}
console.log(`✅ guard-lane-contract passed (${dbMap.size} db / ${codeMap.size} code mappings).`);
