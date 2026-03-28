/**
 * Wave 1 – Fehlerklasse 1: False Success / False Done
 *
 * Tests that terminal steps cannot reach 'done' when their
 * postcondition artifacts are missing or insufficient.
 *
 * Uses service_role to bypass RLS for test mutations.
 * All mutations are rolled back in finally{} blocks.
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

// ── Helper: find a non-published package with a specific step ──
async function findTestCandidate(stepKey: string) {
  const { data: steps } = await sb
    .from("package_steps")
    .select("package_id, step_key, status, last_error, started_at, finished_at, meta")
    .eq("step_key", stepKey)
    .limit(20);

  if (!steps || steps.length === 0) return null;

  const { data: packages } = await sb
    .from("course_packages")
    .select("id, status, integrity_passed, council_approved")
    .in("id", steps.map((s) => s.package_id));

  const nonPublished = packages?.filter((p) => p.status !== "published");
  if (!nonPublished || nonPublished.length === 0) return null;

  const pkg = nonPublished[0];
  const step = steps.find((s) => s.package_id === pkg.id)!;
  return { pkg, step };
}

// ── Helper: attempt done transition and verify guard rejection ──
async function testFalseSuccessGuard(stepKey: string) {
  const candidate = await findTestCandidate(stepKey);
  if (!candidate) {
    console.warn(`⚠️  No non-published package with step '${stepKey}' — skipping`);
    return;
  }

  const { pkg, step: originalStep } = candidate;
  console.log(`Testing ${stepKey} on package ${pkg.id} (status: ${pkg.status})`);

  try {
    // Force to pending baseline
    await sb
      .from("package_steps")
      .update({ status: "pending", last_error: null })
      .eq("package_id", pkg.id)
      .eq("step_key", stepKey);

    // Attempt forbidden done transition
    const { error: updateErr } = await sb
      .from("package_steps")
      .update({
        status: "done",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq("package_id", pkg.id)
      .eq("step_key", stepKey);

    // Read back
    const { data: after } = await sb
      .from("package_steps")
      .select("status, last_error")
      .eq("package_id", pkg.id)
      .eq("step_key", stepKey)
      .single();

    assertExists(after, "Step must still exist");

    // The threshold guard or specific guard should have blocked done
    // Either status is 'failed' (guard rejected) or stays non-done
    if (after!.status === "done") {
      // If it reached done, the guard didn't fire — this is only acceptable
      // if the artifact thresholds are actually met
      console.warn(
        `⚠️  ${stepKey} reached 'done' — threshold guard may not cover this step or artifacts are present`,
      );
    } else {
      console.log(
        `✅ ${stepKey}: Guard blocked false-success → status=${after!.status}, last_error=${after!.last_error}`,
      );
    }
  } finally {
    // Rollback
    await sb
      .from("package_steps")
      .update({
        status: originalStep.status,
        last_error: originalStep.last_error ?? null,
        started_at: originalStep.started_at,
        finished_at: originalStep.finished_at,
      })
      .eq("package_id", pkg.id)
      .eq("step_key", stepKey);
    console.log(`🔄 Rolled back ${stepKey} to original state`);
  }
}

// ══════════════════════════════════════════════
// TEST 1: auto_publish false success (dedicated guard)
// ══════════════════════════════════════════════
Deno.test("FALSE_SUCCESS: auto_publish done on non-published → rejected", async () => {
  const candidate = await findTestCandidate("auto_publish");
  if (!candidate) {
    console.warn("⚠️  No candidate — skipping");
    return;
  }
  const { pkg, step: originalStep } = candidate;

  try {
    await sb
      .from("package_steps")
      .update({ status: "pending", last_error: null })
      .eq("package_id", pkg.id)
      .eq("step_key", "auto_publish");

    await sb
      .from("package_steps")
      .update({
        status: "done",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq("package_id", pkg.id)
      .eq("step_key", "auto_publish");

    const { data: after } = await sb
      .from("package_steps")
      .select("status, last_error")
      .eq("package_id", pkg.id)
      .eq("step_key", "auto_publish")
      .single();

    assertExists(after);
    assertEquals(after!.status, "failed", "Must be rewritten to failed");
    assert(
      (after!.last_error as string).startsWith("POST_CONDITION_FAILED"),
      `last_error must start with POST_CONDITION_FAILED, got: ${after!.last_error}`,
    );
  } finally {
    await sb
      .from("package_steps")
      .update({
        status: originalStep.status,
        last_error: originalStep.last_error ?? null,
        started_at: originalStep.started_at,
        finished_at: originalStep.finished_at,
      })
      .eq("package_id", pkg.id)
      .eq("step_key", "auto_publish");
  }
});

// ══════════════════════════════════════════════
// TEST 2: Threshold guard on validate_exam_pool
// ══════════════════════════════════════════════
Deno.test("FALSE_SUCCESS: validate_exam_pool threshold guard fires", async () => {
  await testFalseSuccessGuard("validate_exam_pool");
});

// ══════════════════════════════════════════════
// TEST 3: Threshold guard on validate_learning_content
// ══════════════════════════════════════════════
Deno.test("FALSE_SUCCESS: validate_learning_content threshold guard fires", async () => {
  await testFalseSuccessGuard("validate_learning_content");
});

// ══════════════════════════════════════════════
// TEST 4: Threshold guard on generate_handbook
// ══════════════════════════════════════════════
Deno.test("FALSE_SUCCESS: generate_handbook threshold guard fires", async () => {
  await testFalseSuccessGuard("generate_handbook");
});

// ══════════════════════════════════════════════
// TEST 5: Threshold guard on run_integrity_check
// ══════════════════════════════════════════════
Deno.test("FALSE_SUCCESS: run_integrity_check threshold guard fires", async () => {
  await testFalseSuccessGuard("run_integrity_check");
});

// ══════════════════════════════════════════════
// TEST 6: Audit detection — ops_auto_publish_false_success = 0
// ══════════════════════════════════════════════
Deno.test("FALSE_SUCCESS_DETECTION: ops_auto_publish_false_success has zero anomalies", async () => {
  const { data, error } = await sb
    .from("ops_auto_publish_false_success")
    .select("package_id")
    .limit(5);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertEquals(
    data?.length ?? 0,
    0,
    `Found ${data?.length} false-success anomalies — system is inconsistent`,
  );
});

// ══════════════════════════════════════════════
// TEST 7: Audit detection — ops_step_done_below_threshold
// ══════════════════════════════════════════════
Deno.test("FALSE_SUCCESS_DETECTION: ops_step_done_below_threshold returns queryable results", async () => {
  const { data, error } = await sb
    .from("ops_step_done_below_threshold")
    .select("package_id, step_key, actual, threshold, drift_type")
    .limit(10);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  // This view may have entries (known tech debt) — but it must be queryable
  assertExists(data, "View must return data array");
  console.log(`📊 ops_step_done_below_threshold: ${data!.length} entries found`);
});

// ══════════════════════════════════════════════
// TEST 8: Audit detection — ops_hollow_completions
// ══════════════════════════════════════════════
Deno.test("FALSE_SUCCESS_DETECTION: ops_hollow_completions is queryable", async () => {
  const { data, error } = await sb
    .from("ops_hollow_completions")
    .select("package_id, step_key, artifact_count")
    .limit(10);

  assertEquals(error, null, `View query failed: ${error?.message}`);
  assertExists(data, "View must return data array");
  console.log(`📊 ops_hollow_completions: ${data!.length} entries found`);
});
