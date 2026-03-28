/**
 * Wave 1 – Fehlerklasse 6: DAG / Sequence Violations
 *
 * Tests that pipeline step ordering respects the DAG:
 * - No step should be 'done' while its predecessor is not done
 * - DAG edges in DB must match expected topology
 * - Downstream missing detection works
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
// TEST 1: DAG topology — critical edges exist
// ══════════════════════════════════════════════
const CRITICAL_EDGES = [
  { step: "auto_publish", depends_on: "quality_council" },
  { step: "quality_council", depends_on: "run_integrity_check" },
  { step: "run_integrity_check", depends_on: "elite_harden" },
  { step: "validate_exam_pool", depends_on: "generate_exam_pool" },
  { step: "validate_learning_content", depends_on: "finalize_learning_content" },
  { step: "generate_learning_content", depends_on: "fanout_learning_content" },
  { step: "validate_blueprints", depends_on: "auto_seed_exam_blueprints" },
];

Deno.test("DAG_TOPOLOGY: critical edges exist in pipeline_dag_edges", async () => {
  const { data: edges, error } = await sb
    .from("pipeline_dag_edges")
    .select("step_key, depends_on");

  assertEquals(error, null, `Failed to query DAG: ${error?.message}`);
  assertExists(edges);

  const edgeSet = new Set(edges!.map((e) => `${e.step_key}→${e.depends_on}`));

  for (const ce of CRITICAL_EDGES) {
    const key = `${ce.step}→${ce.depends_on}`;
    assert(edgeSet.has(key), `Missing critical DAG edge: ${key}`);
  }

  console.log(`✅ All ${CRITICAL_EDGES.length} critical DAG edges verified`);
  console.log(`📊 Total DAG edges: ${edges!.length}`);
});

// ══════════════════════════════════════════════
// TEST 2: DAG edge count sanity
// ══════════════════════════════════════════════
Deno.test("DAG_TOPOLOGY: edge count is in expected range", async () => {
  const { data, error } = await sb
    .from("pipeline_dag_edges")
    .select("step_key");

  assertEquals(error, null);
  assert(
    data!.length >= 20 && data!.length <= 50,
    `DAG edge count ${data!.length} outside expected range [20,50]`,
  );
});

// ══════════════════════════════════════════════
// TEST 3: No step done with predecessor not done (spot check)
// ══════════════════════════════════════════════
Deno.test("DAG_SEQUENCE: auto_publish done implies quality_council done", async () => {
  // Find packages where auto_publish is done
  const { data: apDone } = await sb
    .from("package_steps")
    .select("package_id")
    .eq("step_key", "auto_publish")
    .eq("status", "done")
    .limit(20);

  if (!apDone || apDone.length === 0) {
    console.warn("⚠️  No packages with auto_publish=done — skipping");
    return;
  }

  // Check quality_council for those packages
  const { data: qcSteps } = await sb
    .from("package_steps")
    .select("package_id, status")
    .eq("step_key", "quality_council")
    .in("package_id", apDone.map((p) => p.package_id));

  const violations = qcSteps?.filter(
    (s) => s.status !== "done" && s.status !== "skipped",
  );

  assertEquals(
    violations?.length ?? 0,
    0,
    `Found ${violations?.length} packages where auto_publish=done but quality_council≠done: ${JSON.stringify(violations?.slice(0, 3))}`,
  );

  console.log(
    `✅ All ${apDone.length} auto_publish=done packages have quality_council=done`,
  );
});

// ══════════════════════════════════════════════
// TEST 4: validate_exam_pool done implies generate_exam_pool done
// ══════════════════════════════════════════════
Deno.test("DAG_SEQUENCE: validate_exam_pool done implies generate_exam_pool done", async () => {
  const { data: vepDone } = await sb
    .from("package_steps")
    .select("package_id")
    .eq("step_key", "validate_exam_pool")
    .eq("status", "done")
    .limit(50);

  if (!vepDone || vepDone.length === 0) {
    console.warn("⚠️  No packages with validate_exam_pool=done — skipping");
    return;
  }

  const { data: gepSteps } = await sb
    .from("package_steps")
    .select("package_id, status")
    .eq("step_key", "generate_exam_pool")
    .in("package_id", vepDone.map((p) => p.package_id));

  const violations = gepSteps?.filter(
    (s) => s.status !== "done" && s.status !== "skipped",
  );

  assertEquals(
    violations?.length ?? 0,
    0,
    `DAG violation: validate_exam_pool=done but generate_exam_pool not done in ${violations?.length} packages`,
  );

  console.log(
    `✅ All ${vepDone.length} validate_exam_pool=done packages have generate_exam_pool=done`,
  );
});

// ══════════════════════════════════════════════
// TEST 5: Detection — ops_package_downstream_missing
// ══════════════════════════════════════════════
Deno.test("DAG_DETECTION: ops_package_downstream_missing is queryable", async () => {
  const { data, error } = await sb
    .from("ops_package_downstream_missing")
    .select("package_id")
    .limit(10);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data);
  console.log(`📊 ops_package_downstream_missing: ${data!.length} entries`);
});

// ══════════════════════════════════════════════
// TEST 6: Detection — ops_prereq_guard_cancelled
// ══════════════════════════════════════════════
Deno.test("DAG_DETECTION: ops_prereq_guard_cancelled is queryable", async () => {
  const { data, error } = await sb
    .from("ops_prereq_guard_cancelled")
    .select("*")
    .limit(10);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data);
  console.log(`📊 ops_prereq_guard_cancelled: ${data!.length} entries`);
});
