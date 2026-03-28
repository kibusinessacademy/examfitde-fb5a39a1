/**
 * Integration Test: auto_publish false-success trigger rejection
 *
 * Verifies that trg_guard_auto_publish_done prevents marking auto_publish
 * as 'done' when the package is NOT in 'published' status.
 *
 * Expected: The trigger rewrites status to 'failed' with POST_CONDITION_FAILED.
 *
 * Strategy: Pick any package whose status is 'building' or 'done' (not published),
 * temporarily set its auto_publish step to 'pending', then try setting it to 'done'.
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ||
  Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.test("trg_guard_auto_publish_done rejects done on non-published package", async () => {
  // Find ANY non-published package that has an auto_publish step
  const { data: candidates } = await sb
    .from("package_steps")
    .select("package_id, step_key, status, last_error, started_at, finished_at")
    .eq("step_key", "auto_publish")
    .limit(10);

  if (!candidates || candidates.length === 0) {
    console.warn("⚠️  No auto_publish steps found — skipping");
    return;
  }

  // Check which packages are NOT published
  const { data: packages } = await sb
    .from("course_packages")
    .select("id, status")
    .in("id", candidates.map((c) => c.package_id));

  const nonPublished = packages?.filter((p) => p.status !== "published");
  if (!nonPublished || nonPublished.length === 0) {
    console.warn("⚠️  All packages with auto_publish are already published — skipping");
    return;
  }

  const targetPkg = nonPublished[0];
  const originalStep = candidates.find((c) => c.package_id === targetPkg.id)!;

  console.log(`Testing with package ${targetPkg.id} (status: ${targetPkg.status})`);
  console.log(`Original step state: status=${originalStep.status}, last_error=${originalStep.last_error}`);

  try {
    // Force step to a known baseline before test
    await sb
      .from("package_steps")
      .update({ status: "pending", last_error: null })
      .eq("package_id", targetPkg.id)
      .eq("step_key", "auto_publish");

    // Now attempt the forbidden transition: pending → done on non-published package
    const { error: updateErr } = await sb
      .from("package_steps")
      .update({
        status: "done",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq("package_id", targetPkg.id)
      .eq("step_key", "auto_publish");

    assertEquals(updateErr, null, "Update should not throw — trigger rewrites silently");

    // Read back: trigger should have rewritten to failed + POST_CONDITION_FAILED
    const { data: after } = await sb
      .from("package_steps")
      .select("status, last_error")
      .eq("package_id", targetPkg.id)
      .eq("step_key", "auto_publish")
      .single();

    assertExists(after, "Step must still exist after update");

    assertEquals(
      after!.status,
      "failed",
      `Trigger must rewrite status to 'failed', got '${after!.status}'`
    );

    const lastError = after!.last_error as string;
    assertEquals(
      lastError.startsWith("POST_CONDITION_FAILED"),
      true,
      `last_error must start with POST_CONDITION_FAILED, got '${lastError}'`
    );

    console.log("✅ Trigger correctly rejected false-success: status=failed, last_error=POST_CONDITION_FAILED");
  } finally {
    // Rollback to original state
    await sb
      .from("package_steps")
      .update({
        status: originalStep.status,
        last_error: originalStep.last_error ?? null,
        started_at: originalStep.started_at,
        finished_at: originalStep.finished_at,
      })
      .eq("package_id", targetPkg.id)
      .eq("step_key", "auto_publish");

    console.log("🔄 Rolled back step to original state");
  }
});
