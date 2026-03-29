import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * package-repair-exam-pool-quality — Pipeline Repair Step
 *
 * Resolves the three root causes of validate_exam_pool failures:
 * 1. UNRESOLVED_QUALITY_FLAGS: Auto-promotes draft+tier1_passed questions to approved
 * 2. MISSING_LF_COVERAGE: Identifies gaps (actual fill requires LLM via pool-fill-lf-gaps)
 * 3. Missing trap_type on is_trap questions
 *
 * After repair, the orchestrator re-enqueues validate_exam_pool for retry.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const body = await req.json().catch(() => ({}));
  const packageId: string | undefined = body.package_id;
  const curriculumId: string | undefined = body.curriculum_id;
  const jobId: string | undefined = body.job_id;

  if (!packageId) return json({ error: "missing package_id" }, 400);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve curriculum_id if not provided
  let cid = curriculumId;
  if (!cid) {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", packageId)
      .single();
    cid = pkg?.curriculum_id;
  }

  if (!cid) {
    return json({ error: "could not resolve curriculum_id" }, 400);
  }

  // Heartbeat
  if (jobId) {
    await sb
      .from("job_queue")
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq("id", jobId);
  }

  // Call the DB repair function
  const { data: result, error } = await sb.rpc("repair_exam_pool_quality", {
    p_curriculum_id: cid,
  });

  if (error) {
    return json({ error: error.message }, 500);
  }

  const repairResult = result as Record<string, unknown>;

  // Log repair action
  await sb.from("auto_heal_log").insert({
    action_type: "repair_exam_pool_quality",
    result_status: "applied",
    metadata: {
      package_id: packageId,
      curriculum_id: cid,
      ...repairResult,
    },
  });

  // After repair, reset validate_exam_pool step back to queued for retry
  await sb
    .from("package_steps")
    .update({ status: "queued", updated_at: new Date().toISOString() })
    .eq("package_id", packageId)
    .eq("step_key", "validate_exam_pool")
    .in("status", ["failed", "queued"]);

  // Mark this repair step conditionally:
  // - "done" only if no LF gaps remain
  // - "running" if LF filler was enqueued (will be resolved by filler completion)
  const hasOpenLfGaps = (repairResult.missing_lf_coverage as number) > 0;
  await sb
    .from("package_steps")
    .update({
      status: hasOpenLfGaps ? "running" : "done",
      updated_at: new Date().toISOString(),
      meta: hasOpenLfGaps
        ? { pending_followup: "pool_fill_lf_gaps", lf_gaps: repairResult.missing_lf_coverage }
        : { repair_complete: true },
    })
    .eq("package_id", packageId)
    .eq("step_key", "repair_exam_pool_quality");

  // If there are still missing LF gaps, enqueue LF gap filler
  if ((repairResult.missing_lf_coverage as number) > 0) {
    // Enqueue pool-fill-lf-gaps job (already registered)
    await sb.from("job_queue").insert({
      job_type: "pool_fill_lf_gaps",
      package_id: packageId,
      status: "queued",
      priority: 25,
      payload: { curriculum_id: cid, triggered_by: "repair_exam_pool_quality" },
    });
  }

  return json({
    status: "repaired",
    ...repairResult,
    next: "validate_exam_pool re-queued for retry",
  });
});
