/**
 * Integration Test: auto_publish false-success trigger rejection
 *
 * Verifies that trg_guard_auto_publish_done prevents marking auto_publish
 * as 'done' when the package is NOT in 'published' status.
 *
 * Expected: The trigger rewrites status to 'failed' with POST_CONDITION_FAILED.
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ||
  Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Helper: find a non-published package with an auto_publish step ──
async function findTestCandidate() {
  const { data } = await sb
    .from("package_steps")
    .select("package_id, step_key, status, course_packages!inner(status)")
    .eq("step_key", "auto_publish")
    .neq("course_packages.status", "published")
    .limit(1)
    .single();
  return data;
}

// ── Helper: snapshot current step state for rollback ──
async function snapshotStep(packageId: string) {
  const { data } = await sb
    .from("package_steps")
    .select("status, last_error, started_at, finished_at")
    .eq("package_id", packageId)
    .eq("step_key", "auto_publish")
    .single();
  return data;
}

Deno.test("trg_guard_auto_publish_done rejects done on non-published package", async () => {
  const candidate = await findTestCandidate();

  if (!candidate) {
    console.warn(
      "⚠️  No non-published package with auto_publish step found — skipping test."
    );
    return;
  }

  const packageId = candidate.package_id;
  const original = await snapshotStep(packageId);
  assertExists(original, "Step snapshot must exist");

  try {
    // Attempt to set auto_publish to 'done' — trigger should block this
    const { error: updateErr } = await sb
      .from("package_steps")
      .update({
        status: "done",
        finished_at: new Date().toISOString(),
      })
      .eq("package_id", packageId)
      .eq("step_key", "auto_publish");

    // The trigger does NOT raise an exception — it rewrites the row.
    // So the update itself should succeed.
    assertEquals(updateErr, null, "Update should not throw (trigger rewrites silently)");

    // Read back the step — it should be 'failed', not 'done'
    const after = await snapshotStep(packageId);
    assertExists(after, "Step must still exist after update");

    assertEquals(
      after!.status,
      "failed",
      `Trigger must rewrite status to 'failed', got '${after!.status}'`
    );

    assertEquals(
      after!.last_error,
      "POST_CONDITION_FAILED",
      `Trigger must set last_error to POST_CONDITION_FAILED, got '${after!.last_error}'`
    );

    console.log("✅ Trigger correctly rejected false-success: status=failed, last_error=POST_CONDITION_FAILED");
  } finally {
    // Rollback: restore original step state
    await sb
      .from("package_steps")
      .update({
        status: original!.status,
        last_error: original!.last_error ?? null,
        started_at: original!.started_at,
        finished_at: original!.finished_at,
      })
      .eq("package_id", packageId)
      .eq("step_key", "auto_publish");

    console.log("🔄 Rolled back step to original state");
  }
});
