#!/usr/bin/env node
/**
 * CI Guard: Pipeline DAG Parity (Node.js version)
 *
 * Statically parses job-map.ts and validates that FULL_STEP_ORDER,
 * PIPELINE_GRAPH, STEP_TO_JOB_TYPE, and JOB_DEFINITIONS are all in sync.
 *
 * This catches phantom steps that would crash content-runner at boot.
 *
 * Parity target: supabase/functions/tests/dag-parity_test.ts
 * Both guards must cover the same logical assertions.
 *
 * Run: node scripts/guards/dag-parity-guard.mjs
 * Exit 0 = OK, Exit 1 = drift detected
 */

import { readFileSync } from "fs";

const JOB_MAP = "supabase/functions/_shared/job-map.ts";
const src = readFileSync(JOB_MAP, "utf-8");

// ── Extract arrays/objects via regex ──

function extractArrayKeys(name) {
  const re = new RegExp(`(?:export\\s+)?const\\s+${name}[^=]*=\\s*\\[([\\s\\S]*?)\\];`);
  const m = src.match(re);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function extractObjectKeys(name) {
  const re = new RegExp(`(?:export\\s+)?const\\s+${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`);
  const m = src.match(re);
  if (!m) return null;
  return [...m[1].matchAll(/^\s*["']?(\w+)["']?\s*:/gm)]
    .map((x) => x[1])
    .filter((k) => k !== name);
}

/**
 * Parses STEP_TO_JOB_TYPE as a key→value map.
 * Returns Map<stepKey, jobType> or null.
 */
function extractStepToJobTypeMap() {
  const re = /(?:export\s+)?const\s+STEP_TO_JOB_TYPE[^=]*=\s*\{([\s\S]*?)\n\}(?:\s*(?:as\s+const|satisfies))?;/;
  const m = src.match(re);
  if (!m) return null;
  const map = new Map();
  for (const line of m[1].matchAll(/^\s*["']?(\w+)["']?\s*:\s*["'](\w+)["']/gm)) {
    map.set(line[1], line[2]);
  }
  return map.size > 0 ? map : null;
}

function extractGraphKeys() {
  const re = /(?:export\s+)?const\s+PIPELINE_GRAPH[^=]*=\s*\[([\s\S]*?)\n\](?:\s*as\s+const)?;/;
  const m = src.match(re);
  if (!m) return null;
  return [...m[1].matchAll(/key:\s*"([^"]+)"/g)].map((x) => x[1]);
}

/**
 * Parses PIPELINE_GRAPH nodes with their dependsOn arrays.
 * Returns Array<{ key: string, dependsOn: string[] }> or null.
 */
function extractGraphNodes() {
  const re = /(?:export\s+)?const\s+PIPELINE_GRAPH[^=]*=\s*\[([\s\S]*?)\n\](?:\s*as\s+const)?;/;
  const m = src.match(re);
  if (!m) return null;

  const nodes = [];
  // Match each node block: { key: "...", ... }
  const nodeBlocks = [...m[1].matchAll(/\{\s*key:\s*"([^"]+)"[\s\S]*?(?:dependsOn:\s*\[([\s\S]*?)\])?[\s\S]*?\}/g)];
  for (const block of nodeBlocks) {
    const key = block[1];
    const deps = block[2]
      ? [...block[2].matchAll(/"([^"]+)"/g)].map((d) => d[1])
      : [];
    nodes.push({ key, dependsOn: deps });
  }
  return nodes.length > 0 ? nodes : null;
}

// ── Parse ──

const fullStepOrder = extractArrayKeys("FULL_STEP_ORDER");
const stepToJobTypeMap = extractStepToJobTypeMap();
const stepToJobTypeKeys = stepToJobTypeMap ? [...stepToJobTypeMap.keys()] : null;
const graphKeys = extractGraphKeys();
const graphNodes = extractGraphNodes();
const jobDefinitions = extractObjectKeys("JOB_DEFINITIONS");

const violations = [];

if (!fullStepOrder) violations.push("Could not parse FULL_STEP_ORDER");
if (!stepToJobTypeMap) violations.push("Could not parse STEP_TO_JOB_TYPE");
if (!graphKeys) violations.push("Could not parse PIPELINE_GRAPH");
if (!graphNodes) violations.push("Could not parse PIPELINE_GRAPH nodes");
if (!jobDefinitions) violations.push("Could not parse JOB_DEFINITIONS");

if (violations.length > 0) {
  console.error("❌ DAG PARITY: Parse failures");
  violations.forEach((v) => console.error(`   - ${v}`));
  process.exit(1);
}

const orderSet = new Set(fullStepOrder);
const graphSet = new Set(graphKeys);
const mapSet = new Set(stepToJobTypeKeys);
const jobDefSet = new Set(jobDefinitions);

// ── 1. FULL_STEP_ORDER ↔ PIPELINE_GRAPH ──

for (const s of fullStepOrder) {
  if (!graphSet.has(s))
    violations.push(`FULL_STEP_ORDER → PIPELINE_GRAPH missing: "${s}"`);
}
for (const k of graphKeys) {
  if (!orderSet.has(k))
    violations.push(`PIPELINE_GRAPH → FULL_STEP_ORDER missing: "${k}"`);
}

// ── 2. FULL_STEP_ORDER ↔ STEP_TO_JOB_TYPE ──

for (const s of fullStepOrder) {
  if (!mapSet.has(s))
    violations.push(`FULL_STEP_ORDER → STEP_TO_JOB_TYPE missing: "${s}"`);
}
for (const k of stepToJobTypeKeys) {
  if (!orderSet.has(k))
    violations.push(`STEP_TO_JOB_TYPE → FULL_STEP_ORDER orphan: "${k}"`);
}

// ── 3. Every STEP_TO_JOB_TYPE value exists in JOB_DEFINITIONS ──

for (const [step, jt] of stepToJobTypeMap) {
  if (!jobDefSet.has(jt)) {
    violations.push(
      `STEP_TO_JOB_TYPE references undefined job_type: "${step}" → "${jt}"`,
    );
  }
}

// ── 4. Duplicates ──

const seen = new Set();
for (const s of fullStepOrder) {
  if (seen.has(s)) violations.push(`Duplicate in FULL_STEP_ORDER: "${s}"`);
  seen.add(s);
}

// ── 5. Topological validity ──
// Every dependency must appear before its dependent in FULL_STEP_ORDER.

const posMap = new Map(fullStepOrder.map((s, i) => [s, i]));
for (const node of graphNodes) {
  const nodePos = posMap.get(node.key);
  if (nodePos === undefined) continue; // caught by check 1
  for (const dep of node.dependsOn) {
    const depPos = posMap.get(dep);
    if (depPos === undefined) continue;
    if (depPos >= nodePos) {
      violations.push(
        `Topological violation: "${node.key}" (pos ${nodePos}) depends on "${dep}" (pos ${depPos})`,
      );
    }
  }
}

// ── 6. Minimum step count ──

if (fullStepOrder.length < 20) {
  violations.push(`Only ${fullStepOrder.length} steps — suspicious wipe?`);
}

// ── Report ──

if (violations.length > 0) {
  console.error(`\n❌ DAG PARITY GUARD: ${violations.length} violation(s)\n`);
  violations.forEach((v) => console.error(`   - ${v}`));
  console.error(
    "\n   → Fix supabase/functions/_shared/job-map.ts before deploying.\n",
  );
  process.exit(1);
}

console.log(
  `✅ DAG parity OK — ${fullStepOrder.length} steps, all maps in sync (incl. job_type→defs + topo check).`,
);
process.exit(0);
