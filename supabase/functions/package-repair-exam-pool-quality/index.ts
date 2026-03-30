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

  // ═══ P0.3: TARGETED REPAIR instead of blind reseed ═══
  // Step 1: QC Reconciliation — promote promotable, reject true rejects
  // Step 2: LF Coverage check — only fill genuine gaps
  // Step 3: Selective reseed ONLY if pool is structurally empty

  // Heartbeat
  if (jobId) {
    await sb
      .from("job_queue")
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq("id", jobId);
  }

  // Call the DB repair function (promotes tier1_passed→approved, fixes trap_types)
  const { data: result, error } = await sb.rpc("repair_exam_pool_quality", {
    p_curriculum_id: cid,
  });

  if (error) {
    return json({ error: error.message }, 500);
  }

  const repairResult = result as Record<string, unknown>;

  // ── P0.3 Step 1b: Targeted QC Reconciliation ──
  // Auto-reject questions stuck in tier1_failed/needs_revision for >24h
  // These are the "12 unresolved QC" that block the entire pipeline
  const { count: staleFailedCount } = await sb
    .from("exam_questions")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", cid)
    .in("qc_status", ["tier1_failed", "needs_revision"])
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());

  let qcReconciled = 0;
  if ((staleFailedCount ?? 0) > 0) {
    // Check if approved pool is large enough to absorb rejections
    const { count: approvedCount } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", cid)
      .eq("qc_status", "approved");

    // Only auto-reject if we have a healthy approved base (500+)
    if ((approvedCount ?? 0) >= 500) {
      const { data: rejected } = await sb
        .from("exam_questions")
        .update({ qc_status: "rejected", status: "rejected", updated_at: new Date().toISOString() })
        .eq("curriculum_id", cid)
        .in("qc_status", ["tier1_failed", "needs_revision"])
        .lt("updated_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString())
        .select("id");
      qcReconciled = rejected?.length ?? 0;
      console.log(`[repair-exam-pool] QC_RECONCILIATION: rejected ${qcReconciled} stale failed questions (approved base: ${approvedCount})`);
    }
  }

  // ── P0.3 Step 2: Check if pool is now sufficient after reconciliation ──
  const { count: postRepairApproved } = await sb
    .from("exam_questions")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", cid)
    .in("qc_status", ["approved", "tier1_passed"]);

  const { count: postRepairUnresolved } = await sb
    .from("exam_questions")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", cid)
    .in("qc_status", ["tier1_failed", "needs_revision", "pending"]);

  const poolHealthy = (postRepairApproved ?? 0) >= 500 && (postRepairUnresolved ?? 0) === 0;

  // Log repair action
  await sb.from("auto_heal_log").insert({
    action_type: "repair_exam_pool_quality",
    result_status: "applied",
    metadata: {
      package_id: packageId,
      curriculum_id: cid,
      ...repairResult,
      qc_reconciled: qcReconciled,
      post_repair_approved: postRepairApproved,
      post_repair_unresolved: postRepairUnresolved,
      pool_healthy: poolHealthy,
    },
  });

  if (poolHealthy) {
    // Pool is clean — mark validate_exam_pool as queued for a final pass
    await sb
      .from("package_steps")
      .update({
        status: "queued",
        started_at: null,
        finished_at: null,
        last_error: null,
        meta: { repair_cleared: true, repair_at: new Date().toISOString() },
      })
      .eq("package_id", packageId)
      .eq("step_key", "validate_exam_pool")
      .in("status", ["failed", "queued"]);

    // Mark repair step as done
    await sb
      .from("package_steps")
      .update({
        status: "done",
        updated_at: new Date().toISOString(),
        meta: { repair_complete: true, qc_reconciled: qcReconciled, pool_healthy: true },
      })
      .eq("package_id", packageId)
      .eq("step_key", "repair_exam_pool_quality");
  } else {
    // After repair, reset validate_exam_pool step back to queued for retry
    await sb
      .from("package_steps")
      .update({ status: "queued", updated_at: new Date().toISOString() })
      .eq("package_id", packageId)
      .eq("step_key", "validate_exam_pool")
      .in("status", ["failed", "queued"]);

    // Mark this repair step conditionally
    const hasOpenLfGaps = (repairResult.missing_lf_coverage as number) > 0;
    await sb
      .from("package_steps")
      .update({
        status: hasOpenLfGaps ? "running" : "done",
        updated_at: new Date().toISOString(),
        meta: hasOpenLfGaps
          ? { pending_followup: "pool_fill_lf_gaps", lf_gaps: repairResult.missing_lf_coverage }
          : { repair_complete: true, qc_reconciled: qcReconciled },
      })
      .eq("package_id", packageId)
      .eq("step_key", "repair_exam_pool_quality");
  }

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
