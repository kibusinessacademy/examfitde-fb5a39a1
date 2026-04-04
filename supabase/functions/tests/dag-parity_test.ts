/**
 * Pre-Deploy Guard: Pipeline DAG Parity
 *
 * Validates that FULL_STEP_ORDER, PIPELINE_GRAPH, STEP_TO_JOB_TYPE,
 * PipelineStepKey, and JOB_DEFINITIONS are all in sync.
 *
 * This test runs BEFORE edge functions deploy to catch exactly the class
 * of bug that crashed content-runner (phantom steps in FULL_STEP_ORDER
 * missing from PIPELINE_GRAPH).
 *
 * Run: deno test --allow-read supabase/functions/tests/dag-parity_test.ts
 */

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  FULL_STEP_ORDER,
  PIPELINE_GRAPH,
  STEP_TO_JOB_TYPE,
  JOB_DEFINITIONS,
  validatePipelineGraph,
} from "../_shared/job-map.ts";

// ── 1. validatePipelineGraph must not throw ──

Deno.test("DAG: validatePipelineGraph() passes without error", () => {
  // This is the exact check that crashed content-runner at boot.
  // If this throws, the deploy MUST be blocked.
  validatePipelineGraph(PIPELINE_GRAPH);
});

// ── 2. Bidirectional: FULL_STEP_ORDER ↔ PIPELINE_GRAPH ──

Deno.test("DAG: every FULL_STEP_ORDER entry exists in PIPELINE_GRAPH", () => {
  const graphKeys = new Set(PIPELINE_GRAPH.map((n) => n.key));
  const missing = FULL_STEP_ORDER.filter((s) => !graphKeys.has(s));
  assertEquals(
    missing,
    [],
    `FULL_STEP_ORDER contains steps missing from PIPELINE_GRAPH: ${missing.join(", ")}`,
  );
});

Deno.test("DAG: every PIPELINE_GRAPH entry exists in FULL_STEP_ORDER", () => {
  const orderSet = new Set(FULL_STEP_ORDER);
  const missing = PIPELINE_GRAPH.map((n) => n.key).filter((k) => !orderSet.has(k));
  assertEquals(
    missing,
    [],
    `PIPELINE_GRAPH contains steps missing from FULL_STEP_ORDER: ${missing.join(", ")}`,
  );
});

// ── 3. Bidirectional: FULL_STEP_ORDER ↔ STEP_TO_JOB_TYPE ──

Deno.test("DAG: every FULL_STEP_ORDER entry has a STEP_TO_JOB_TYPE mapping", () => {
  const mapKeys = new Set(Object.keys(STEP_TO_JOB_TYPE));
  const missing = FULL_STEP_ORDER.filter((s) => !mapKeys.has(s));
  assertEquals(
    missing,
    [],
    `Steps in FULL_STEP_ORDER without job-type mapping: ${missing.join(", ")}`,
  );
});

Deno.test("DAG: every STEP_TO_JOB_TYPE key exists in FULL_STEP_ORDER", () => {
  const orderSet = new Set(FULL_STEP_ORDER);
  const orphans = Object.keys(STEP_TO_JOB_TYPE).filter((k) => !orderSet.has(k));
  assertEquals(
    orphans,
    [],
    `STEP_TO_JOB_TYPE contains orphan mappings: ${orphans.join(", ")}`,
  );
});

// ── 4. Every job_type from STEP_TO_JOB_TYPE exists in JOB_DEFINITIONS ──

Deno.test("DAG: every mapped job_type exists in JOB_DEFINITIONS", () => {
  const defKeys = new Set(Object.keys(JOB_DEFINITIONS));
  const missing = Object.entries(STEP_TO_JOB_TYPE)
    .filter(([, jt]) => !defKeys.has(jt))
    .map(([step, jt]) => `${step} → ${jt}`);
  assertEquals(
    missing,
    [],
    `Job types referenced but not defined: ${missing.join("; ")}`,
  );
});

// ── 5. No duplicates in FULL_STEP_ORDER ──

Deno.test("DAG: FULL_STEP_ORDER has no duplicate entries", () => {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const s of FULL_STEP_ORDER) {
    if (seen.has(s)) dupes.push(s);
    seen.add(s);
  }
  assertEquals(dupes, [], `Duplicate steps in FULL_STEP_ORDER: ${dupes.join(", ")}`);
});

// ── 6. Topological validity: every dependency must appear before its dependent ──

Deno.test("DAG: FULL_STEP_ORDER is topologically valid", () => {
  const posMap = new Map(FULL_STEP_ORDER.map((s, i) => [s, i]));
  const violations: string[] = [];
  for (const node of PIPELINE_GRAPH) {
    const nodePos = posMap.get(node.key);
    if (nodePos === undefined) continue; // caught by other tests
    for (const dep of node.dependsOn ?? []) {
      const depPos = posMap.get(dep);
      if (depPos === undefined) continue;
      if (depPos >= nodePos) {
        violations.push(`"${node.key}" (pos ${nodePos}) depends on "${dep}" (pos ${depPos})`);
      }
    }
  }
  assertEquals(violations, [], `Topological order violations:\n${violations.join("\n")}`);
});

// ── 7. Sanity: at least 20 steps exist (prevents accidental wipe) ──

Deno.test("DAG: minimum step count sanity check", () => {
  assertNotEquals(
    FULL_STEP_ORDER.length < 20,
    true,
    `Only ${FULL_STEP_ORDER.length} steps — suspicious, expected ≥20`,
  );
});
