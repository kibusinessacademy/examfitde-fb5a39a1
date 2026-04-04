#!/usr/bin/env node
/**
 * CI Guard: Pipeline DAG Parity (Node.js version)
 *
 * Statically parses job-map.ts and validates that FULL_STEP_ORDER,
 * PIPELINE_GRAPH, and STEP_TO_JOB_TYPE are all in sync.
 *
 * This catches phantom steps that would crash content-runner at boot.
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

function extractGraphKeys() {
  const re = /(?:export\s+)?const\s+PIPELINE_GRAPH[^=]*=\s*\[([\s\S]*?)\n\](?:\s*as\s+const)?;/;
  const m = src.match(re);
  if (!m) return null;
  return [...m[1].matchAll(/key:\s*"([^"]+)"/g)].map((x) => x[1]);
}

// ── Parse ──

const fullStepOrder = extractArrayKeys("FULL_STEP_ORDER");
const stepToJobType = extractObjectKeys("STEP_TO_JOB_TYPE");
const graphKeys = extractGraphKeys();
const jobDefinitions = extractObjectKeys("JOB_DEFINITIONS");

const violations = [];

if (!fullStepOrder) violations.push("Could not parse FULL_STEP_ORDER");
if (!stepToJobType) violations.push("Could not parse STEP_TO_JOB_TYPE");
if (!graphKeys) violations.push("Could not parse PIPELINE_GRAPH");
if (!jobDefinitions) violations.push("Could not parse JOB_DEFINITIONS");

if (violations.length > 0) {
  console.error("❌ DAG PARITY: Parse failures");
  violations.forEach((v) => console.error(`   - ${v}`));
  process.exit(1);
}

const orderSet = new Set(fullStepOrder);
const graphSet = new Set(graphKeys);
const mapSet = new Set(stepToJobType);

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
for (const k of stepToJobType) {
  if (!orderSet.has(k))
    violations.push(`STEP_TO_JOB_TYPE → FULL_STEP_ORDER orphan: "${k}"`);
}

// ── 3. Duplicates ──

const seen = new Set();
for (const s of fullStepOrder) {
  if (seen.has(s)) violations.push(`Duplicate in FULL_STEP_ORDER: "${s}"`);
  seen.add(s);
}

// ── 4. Minimum step count ──

if (fullStepOrder.length < 20) {
  violations.push(`Only ${fullStepOrder.length} steps — suspicious wipe?`);
}

// ── Report ──

if (violations.length > 0) {
  console.error(`\n❌ DAG PARITY GUARD: ${violations.length} violation(s)\n`);
  violations.forEach((v) => console.error(`   - ${v}`));
  console.error(
    "\n   → Fix supabase/functions/_shared/job-map.ts before deploying.\n"
  );
  process.exit(1);
}

console.log(
  `✅ DAG parity OK — ${fullStepOrder.length} steps, all 4 maps in sync.`
);
process.exit(0);
