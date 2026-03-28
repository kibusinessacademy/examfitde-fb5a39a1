/**
 * Wave 1D – Fehlerklasse 6: DAG / Sequence Violations
 *
 * HARDENED v2: SSOT thresholds, exact counts, skip-audit,
 * + NEW: runtime DAG sequence test (predecessor not done → dispatch blocked).
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SkipAuditTracker } from "./_skip-audit.ts";
import {
  DAG_EDGE_COUNT_MIN,
  DAG_EDGE_COUNT_MAX,
  MAX_DOWNSTREAM_MISSING,
} from "../../_shared/audit-thresholds.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const skipTracker = new SkipAuditTracker(1);

// ── Critical DAG edges that MUST exist ──
const CRITICAL_EDGES = [
  { step: "auto_publish", depends_on: "quality_council" },
  { step: "quality_council", depends_on: "run_integrity_check" },
  { step: "run_integrity_check", depends_on: "elite_harden" },
  { step: "validate_exam_pool", depends_on: "generate_exam_pool" },
  { step: "validate_learning_content", depends_on: "finalize_learning_content" },
  { step: "generate_learning_content", depends_on: "fanout_learning_content" },
  { step: "validate_blueprints", depends_on: "auto_seed_exam_blueprints" },
];

// ══════════════════════════════════════════════
// PREVENTION: critical edges MUST exist
// ══════════════════════════════════════════════
Deno.test("P:DAG: critical edges exist in pipeline_dag_edges", async () => {
  const { data: edges, error } = await sb
    .from("pipeline_dag_edges")
    .select("step_key, depends_on");

  assertEquals(error, null, `Failed to query DAG: ${error?.message}`);
  assertExists(edges);

  const edgeSet = new Set(edges!.map((e) => `${e.step_key}→${e.depends_on}`));

  for (const ce of CRITICAL_EDGES) {
    const key = `${ce.step}→${ce.depends_on}`;
    assert(edgeSet.has(key), `❌ MISSING CRITICAL DAG EDGE: ${key}`);
  }

  console.log(`✅ All ${CRITICAL_EDGES.length} critical DAG edges verified (${edges!.length} total)`);
});

// ══════════════════════════════════════════════
// PREVENTION: edge count sanity (SSOT thresholds)
// ══════════════════════════════════════════════
Deno.test("P:DAG: edge count in expected range", async () => {
  const { count, error } = await sb
    .from("pipeline_dag_edges")
    .select("step_key", { count: "exact", head: true });

  assertEquals(error, null);
  assert(
    (count ?? 0) >= DAG_EDGE_COUNT_MIN && (count ?? 0) <= DAG_EDGE_COUNT_MAX,
    `❌ DAG TOPOLOGY DRIFT: edge count ${count} outside [${DAG_EDGE_COUNT_MIN},${DAG_EDGE_COUNT_MAX}]`,
  );
});

// ══════════════════════════════════════════════
// INVARIANT: auto_publish done → quality_council done
// ══════════════════════════════════════════════
Deno.test("P:DAG: auto_publish done implies quality_council done", async () => {
  const { data: activePkgs } = await sb
    .from("course_packages")
    .select("id")
    .neq("status", "archived")
    .limit(500);

  if (!activePkgs || activePkgs.length === 0) {
    skipTracker.skip("auto_publish→quality_council", "No active packages");
    return;
  }

  const activeIds = activePkgs.map((p) => p.id);
  const { data: apDone } = await sb
    .from("package_steps")
    .select("package_id")
    .eq("step_key", "auto_publish")
    .eq("status", "done")
    .in("package_id", activeIds)
    .limit(100);

  if (!apDone || apDone.length === 0) {
    skipTracker.skip("auto_publish→quality_council", "No packages with auto_publish=done");
    return;
  }

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
    `❌ DAG VIOLATION: ${violations?.length} packages have auto_publish=done but quality_council≠done. ` +
    `Violations: ${JSON.stringify(violations?.slice(0, 3))}`,
  );

  console.log(`✅ All ${apDone.length} auto_publish=done have quality_council=done`);
});

// ══════════════════════════════════════════════
// INVARIANT: validate_exam_pool done → generate_exam_pool done
// ══════════════════════════════════════════════
Deno.test("P:DAG: validate_exam_pool done implies generate_exam_pool done", async () => {
  const { data: activePkgs } = await sb
    .from("course_packages")
    .select("id")
    .neq("status", "archived")
    .limit(500);

  const activeIds = activePkgs?.map((p) => p.id) ?? [];
  const { data: vepDone } = await sb
    .from("package_steps")
    .select("package_id")
    .eq("step_key", "validate_exam_pool")
    .eq("status", "done")
    .in("package_id", activeIds)
    .limit(100);

  if (!vepDone || vepDone.length === 0) {
    skipTracker.skip("validate_exam_pool→generate_exam_pool", "No packages with validate_exam_pool=done");
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
    `❌ DAG VIOLATION: validate_exam_pool=done but generate_exam_pool not done in ${violations?.length} packages`,
  );

  console.log(`✅ All ${vepDone.length} validate_exam_pool=done have generate_exam_pool=done`);
});

// ══════════════════════════════════════════════
// DETECTION: ops_package_downstream_missing within budget
// ══════════════════════════════════════════════
Deno.test("D:DAG: ops_package_downstream_missing within budget", async () => {
  const { count, error } = await sb
    .from("ops_package_downstream_missing")
    .select("package_id", { count: "exact", head: true });

  assertEquals(error, null, `View query failed: ${error?.message}`);

  if ((count ?? 0) > MAX_DOWNSTREAM_MISSING) {
    assertEquals(
      count,
      0,
      `❌ EXCESSIVE DOWNSTREAM MISSING: ${count} packages (>${MAX_DOWNSTREAM_MISSING} threshold). ` +
      `Systematic step scaffolding failure.`,
    );
  } else if ((count ?? 0) > 0) {
    console.warn(`⚠️  Known tech debt: ${count} packages with missing downstream (≤${MAX_DOWNSTREAM_MISSING})`);
  }
});

// ══════════════════════════════════════════════
// DETECTION: ops_prereq_guard_cancelled = 0
// ══════════════════════════════════════════════
Deno.test("D:DAG: ops_prereq_guard_cancelled = 0", async () => {
  const { count, error } = await sb
    .from("ops_prereq_guard_cancelled")
    .select("*", { count: "exact", head: true });

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertEquals(
    count ?? 0,
    0,
    `❌ PREREQ GUARD CANCELLATION: ${count} jobs cancelled due to unmet prerequisites.`,
  );
});

// ══════════════════════════════════════════════
// RUNTIME DAG: predecessor not done → step must not be running
// ══════════════════════════════════════════════
Deno.test("P:DAG_RUNTIME: no step running with predecessor not done", async () => {
  // Get all running steps
  const { data: runningSteps, error: rsErr } = await sb
    .from("package_steps")
    .select("package_id, step_key")
    .eq("status", "running")
    .limit(100);

  assertEquals(rsErr, null);

  if (!runningSteps || runningSteps.length === 0) {
    console.log("✅ No running steps — DAG runtime check trivially passes");
    return;
  }

  // Get all DAG edges
  const { data: edges } = await sb
    .from("pipeline_dag_edges")
    .select("step_key, depends_on");

  if (!edges || edges.length === 0) {
    console.warn("⚠️  No DAG edges — cannot verify runtime ordering");
    return;
  }

  const edgeMap = new Map<string, string[]>();
  for (const e of edges) {
    const deps = edgeMap.get(e.step_key) ?? [];
    deps.push(e.depends_on);
    edgeMap.set(e.step_key, deps);
  }

  // For each running step, check that all predecessors are done/skipped
  const violations: string[] = [];
  const packageIds = [...new Set(runningSteps.map(s => s.package_id))];

  const { data: allSteps } = await sb
    .from("package_steps")
    .select("package_id, step_key, status")
    .in("package_id", packageIds)
    .limit(1000);

  if (!allSteps) return;

  const stepStatus = new Map<string, string>();
  for (const s of allSteps) {
    stepStatus.set(`${s.package_id}:${s.step_key}`, s.status);
  }

  for (const rs of runningSteps) {
    const deps = edgeMap.get(rs.step_key) ?? [];
    for (const dep of deps) {
      const depStatus = stepStatus.get(`${rs.package_id}:${dep}`);
      if (depStatus && depStatus !== "done" && depStatus !== "skipped") {
        violations.push(`${rs.package_id}: ${rs.step_key} running but ${dep}=${depStatus}`);
      }
    }
  }

  assertEquals(
    violations.length,
    0,
    `❌ DAG RUNTIME VIOLATION: ${violations.length} steps running with predecessor not done. ` +
    `Violations: ${JSON.stringify(violations.slice(0, 5))}`,
  );

  console.log(`✅ All ${runningSteps.length} running steps have predecessors done/skipped`);
});

// ══════════════════════════════════════════════
// SKIP AUDIT
// ══════════════════════════════════════════════
Deno.test("SKIP_AUDIT: dag-sequence skip budget", () => {
  skipTracker.assertSkipBudget();
});
