import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { enqueueJob } from "../_shared/enqueue.ts";
import {
  isRepairActionEligible,
  captureGateSnapshot,
  hasGateStateChanged,
} from "../_shared/repair-eligibility.ts";

/**
 * package-repair-exam-pool-quality — Pipeline Repair Step
 *
 * P0 HARDENED v2: Eligibility + no-effect guard + correct step semantics.
 *
 * Resolves the three root causes of validate_exam_pool failures:
 * 1. UNRESOLVED_QUALITY_FLAGS: Auto-promotes draft+tier1_passed questions to approved
 * 2. MISSING_LF_COVERAGE: Identifies gaps (actual fill requires LLM via pool-fill-lf-gaps)
 * 3. Missing trap_type on is_trap questions
 *
 * After repair, only re-enqueues validate_exam_pool if gate state actually changed.
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
  const triggeredBy: string = body.triggered_by ?? "unknown";

  if (!packageId) return json({ error: "missing package_id" }, 400);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ═══ P0 GUARD 1: Eligibility Check (fail-closed for automation) ═══
  const eligibility = await isRepairActionEligible(
    sb, packageId, "repair_exam_pool_quality", triggeredBy,
  );
  if (!eligibility.eligible) {
    console.warn(`[repair-exam-pool] ❌ INELIGIBLE: ${eligibility.reason} (pkg ${packageId.slice(0, 8)})`);

    await sb.from("auto_heal_log").insert({
      action_type: "repair_exam_pool_quality",
      result_status: "blocked",
      result_detail: `Repair ineligible: ${eligibility.reason}`,
      metadata: {
        package_id: packageId,
        eligibility_reason: eligibility.reason,
        guard: "repair_eligibility_matrix",
        triggered_by: triggeredBy,
      },
    });

    // FIX 1: Ineligible = 'blocked' (not 'skipped'/'done') — prevents orchestration
    // from treating this as terminal/complete. Can be re-evaluated if blocker changes.
    await sb.from("package_steps").update({
      status: "blocked",
      updated_at: new Date().toISOString(),
      meta: {
        repair_ineligible: true,
        eligibility_reason: eligibility.reason,
        guard: "repair_eligibility_matrix",
        blocked_at: new Date().toISOString(),
      },
    }).eq("package_id", packageId).eq("step_key", "repair_exam_pool_quality");

    return json({
      status: "skipped",
      reason: eligibility.reason,
      guard: "repair_eligibility_matrix",
    });
  }

  // ═══ P0 GUARD 2: Capture pre-repair gate snapshot ═══
  const preSnapshot = await captureGateSnapshot(sb, packageId);

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

  // Call the DB repair function (promotes tier1_passed→approved, fixes trap_types)
  const { data: result, error } = await sb.rpc("repair_exam_pool_quality", {
    p_curriculum_id: cid,
  });

  if (error) {
    return json({ error: error.message }, 500);
  }

  const repairResult = result as Record<string, unknown>;
  console.log(`[repair-exam-pool] RPC result: reconciled=${repairResult.qc_status_reconciled}, promoted=${repairResult.promoted_to_approved}, traps=${repairResult.trap_types_fixed}, missing_lf=${repairResult.missing_lf_coverage}`);

  // ── QC Reconciliation: Auto-reject stale failed questions ──
  const qcReconciled = await reconcileStaleQuestions(sb, cid);

  // ── Post-repair pool health check ──
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

  // ═══ P0 GUARD 3: Post-repair gate snapshot + no-effect detection ═══
  const postSnapshot = await captureGateSnapshot(sb, packageId);
  const gateChange = await hasGateStateChanged(sb, preSnapshot, postSnapshot);

  console.log(`[repair-exam-pool] Gate delta: changed=${gateChange.changed}, deltas=${JSON.stringify(gateChange.deltas)} (pkg ${packageId.slice(0, 8)})`);

  // Determine effective status:
  // - Pool healthy OR gate changed → success
  // - Neither → blocked_no_effect (prevents reentry loop)
  const effectiveStatus = (gateChange.changed || poolHealthy) ? "success" : "blocked_no_effect";

  await sb.from("auto_heal_log").insert({
    action_type: "repair_exam_pool_quality",
    result_status: effectiveStatus,
    metadata: {
      package_id: packageId,
      curriculum_id: cid,
      ...repairResult,
      qc_reconciled: qcReconciled,
      post_repair_approved: postRepairApproved,
      post_repair_unresolved: postRepairUnresolved,
      pool_healthy: poolHealthy,
      gate_change: gateChange,
      pre_snapshot: preSnapshot,
      post_snapshot: postSnapshot,
      gate_delta_verified: gateChange.changed,
    },
  });

  if (poolHealthy) {
    await handlePoolHealthy(sb, packageId, qcReconciled);
  } else if (gateChange.changed) {
    // Gate state changed — safe to re-queue validate_exam_pool
    await handleGateChanged(sb, packageId, repairResult, qcReconciled);
  } else {
    // ═══ NO-EFFECT: Don't re-queue, preserve blocked_reason ═══
    console.warn(`[repair-exam-pool] ⚠️ NO-EFFECT: repair completed but gate state unchanged (pkg ${packageId.slice(0, 8)})`);
    await handleNoEffect(sb, packageId, qcReconciled, preSnapshot);
  }

  // If there are still missing LF gaps AND repair had effect, enqueue LF gap filler
  if ((repairResult.missing_lf_coverage as number) > 0 && effectiveStatus === "success") {
    await enqueueJob(sb, {
      job_type: "pool_fill_lf_gaps",
      package_id: packageId,
      priority: 25,
      payload: { curriculum_id: cid, triggered_by: "repair_exam_pool_quality" },
    });
  }

  return json({
    status: effectiveStatus === "blocked_no_effect" ? "no_effect" : "repaired",
    ...repairResult,
    gate_change: gateChange,
    gate_delta_verified: gateChange.changed,
    next: effectiveStatus === "blocked_no_effect"
      ? "blocked — no gate state change after repair"
      : "validate_exam_pool re-queued for retry",
  });
});

// ── Helper: Reconcile stale failed questions ──
async function reconcileStaleQuestions(sb: ReturnType<typeof createClient>, cid: string): Promise<number> {
  const { count: staleFailedCount } = await sb
    .from("exam_questions")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", cid)
    .in("qc_status", ["tier1_failed", "needs_revision"])
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());

  if ((staleFailedCount ?? 0) <= 0) return 0;

  const { count: approvedCount } = await sb
    .from("exam_questions")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", cid)
    .eq("qc_status", "approved");

  if ((approvedCount ?? 0) < 500) return 0;

  const { data: rejected } = await sb
    .from("exam_questions")
    .update({ qc_status: "rejected", status: "rejected" })
    .eq("curriculum_id", cid)
    .in("qc_status", ["tier1_failed", "needs_revision"])
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString())
    .select("id");

  const count = rejected?.length ?? 0;
  console.log(`[repair-exam-pool] QC_RECONCILIATION: rejected ${count} stale failed questions (approved base: ${approvedCount})`);
  return count;
}

// ── Helper: Pool is healthy → mark steps done ──
async function handlePoolHealthy(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  qcReconciled: number,
) {
  const { data: existingStep } = await sb
    .from("package_steps")
    .select("meta")
    .eq("package_id", packageId)
    .eq("step_key", "validate_exam_pool")
    .maybeSingle();
  const existingMeta = (existingStep?.meta ?? {}) as Record<string, unknown>;

  await sb.from("package_steps").update({
    status: "queued",
    started_at: null,
    finished_at: null,
    last_error: null,
    meta: {
      ...existingMeta,
      repair_cleared: true,
      repair_at: new Date().toISOString(),
      last_repair_completed_at: new Date().toISOString(),
    },
  }).eq("package_id", packageId).eq("step_key", "validate_exam_pool").in("status", ["failed", "queued"]);

  await sb.from("package_steps").update({
    status: "done",
    updated_at: new Date().toISOString(),
    meta: { repair_complete: true, qc_reconciled: qcReconciled, pool_healthy: true, gate_delta_verified: true },
  }).eq("package_id", packageId).eq("step_key", "repair_exam_pool_quality");
}

// ── Helper: Gate state changed → re-queue validate ──
async function handleGateChanged(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  repairResult: Record<string, unknown>,
  qcReconciled: number,
) {
  await sb.from("package_steps").update({
    status: "queued",
    updated_at: new Date().toISOString(),
  }).eq("package_id", packageId).eq("step_key", "validate_exam_pool").in("status", ["failed", "queued"]);

  const hasOpenLfGaps = (repairResult.missing_lf_coverage as number) > 0;
  await sb.from("package_steps").update({
    status: hasOpenLfGaps ? "running" : "done",
    updated_at: new Date().toISOString(),
    meta: hasOpenLfGaps
      ? { pending_followup: "pool_fill_lf_gaps", lf_gaps: repairResult.missing_lf_coverage, gate_delta_verified: true }
      : { repair_complete: true, qc_reconciled: qcReconciled, gate_delta_verified: true },
  }).eq("package_id", packageId).eq("step_key", "repair_exam_pool_quality");
}

// ── Helper: No effect → DON'T re-queue, preserve blocked_reason ──
async function handleNoEffect(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  qcReconciled: number,
  preSnapshot: Record<string, unknown>,
) {
  // FIX: Mark repair step as 'blocked' (not 'done') — no-effect is NOT success
  await sb.from("package_steps").update({
    status: "blocked",
    updated_at: new Date().toISOString(),
    meta: {
      repair_complete: false,
      qc_reconciled: qcReconciled,
      no_effect_repair: true,
      no_effect_repair_at: new Date().toISOString(),
      no_effect_reason: "repair_did_not_change_blocking_gate",
      gate_delta_verified: false,
      pre_gate_snapshot: preSnapshot,
    },
  }).eq("package_id", packageId).eq("step_key", "repair_exam_pool_quality");

  // FIX D: Do NOT clear blocked_reason — preserve the diagnostic trail.
  // Instead, append a stuck_reason to signal what happened.
  const existingBlockedReason = preSnapshot.blocked_reason as string | null;
  if (existingBlockedReason) {
    await sb.from("course_packages").update({
      stuck_reason: `REPAIR_NO_EFFECT: exam_pool repair completed without gate delta. Active blocker: ${existingBlockedReason.slice(0, 120)}`,
    }).eq("id", packageId);
  }

  // Do NOT re-queue validate_exam_pool — that's the whole point of this guard
}
