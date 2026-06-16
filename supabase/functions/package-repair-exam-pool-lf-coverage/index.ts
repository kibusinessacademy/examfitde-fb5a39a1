import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { enqueueJob } from "../_shared/enqueue.ts";
import {
  isRepairActionEligible,
  captureGateSnapshot,
  hasGateStateChanged,
} from "../_shared/repair-eligibility.ts";

/**
 * package-repair-exam-pool-lf-coverage — D+ Phase 2
 *
 * TARGETED LF deficit repair. NEVER full regen, NEVER state hack.
 *
 * Flow:
 *   1. Eligibility (fail-closed for automation)
 *   2. Classify gate via fn_classify_exam_pool_gate
 *      - bail unless recommended_action == 'enqueue_lf_coverage_repair'
 *   3. Compute deficits via fn_get_lf_coverage_deficit(target_per_lf)
 *      - bail if no deficits
 *   4. Dedup: bail if active LF-repair fan-out jobs already exist
 *   5. Per-deficit-LF: enqueue package_generate_exam_pool fan-out
 *      payload: { _fan_out: true, learning_field_filter, lf_target_total, … }
 *   6. Mark repair step done with snapshot + dispatched LFs
 *   7. Re-validate is automatic via downstream job-runner completion path
 */

const STEP_KEY = "repair_exam_pool_lf_coverage";
// Fix A (2026-05-09): Aligned with fn_classify_exam_pool_gate which returns 'repair_lf_coverage'.
// Drift between classifier and edge had blocked all LF-coverage repairs system-wide.
const REPAIR_ACTION = "repair_lf_coverage";
const DEFAULT_TARGET_PER_LF = 15;
const RECENT_REPAIR_WINDOW_MIN = 30;

function serializeErr(e: unknown): Record<string, unknown> {
  if (!e) return { message: "unknown" };
  if (typeof e === "string") return { message: e };
  if (e instanceof Error) return { message: e.message, stack: e.stack };
  try {
    const anyE = e as Record<string, unknown>;
    return {
      message: (anyE?.message as string) ?? String(e),
      code: anyE?.code,
      details: anyE?.details,
      hint: anyE?.hint,
      status: anyE?.status,
      raw: JSON.stringify(e),
    };
  } catch {
    return { message: String(e) };
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function ensureRepairStep(
  sb: ReturnType<typeof createClient>,
  packageId: string,
): Promise<boolean> {
  const { error: rpcErr } = await sb.rpc("ensure_package_step", {
    p_package_id: packageId,
    p_step_key: STEP_KEY,
  });
  if (rpcErr) {
    const { error: insErr } = await sb.from("package_steps").insert({
      package_id: packageId,
      step_key: STEP_KEY,
      status: "running",
      started_at: new Date().toISOString(),
    });
    if (insErr && insErr.code !== "23505") {
      console.error(`[lf-cov-repair] ensure step failed: ${insErr.message}`);
    }
  }
  await sb.from("package_steps").update({
    status: "running",
    started_at: new Date().toISOString(),
  }).eq("package_id", packageId).eq("step_key", STEP_KEY).is("started_at", null);

  const { data: check } = await sb.from("package_steps")
    .select("step_key").eq("package_id", packageId).eq("step_key", STEP_KEY).maybeSingle();
  return !!check;
}

async function markBlocked(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  reason: string,
  meta: Record<string, unknown>,
) {
  const exists = await ensureRepairStep(sb, packageId);
  if (!exists) return;
  await sb.from("package_steps").update({
    status: "blocked",
    updated_at: new Date().toISOString(),
    meta: { ok: false, blocked_reason: reason, blocked_at: new Date().toISOString(), ...meta },
  }).eq("package_id", packageId).eq("step_key", STEP_KEY);
}

async function markDone(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  meta: Record<string, unknown>,
) {
  const exists = await ensureRepairStep(sb, packageId);
  if (!exists) return;
  // Direct update (not markStepDone) — repair step is not part of canonical 29-step pipeline
  await sb.from("package_steps").update({
    status: "done",
    updated_at: new Date().toISOString(),
    meta: { ok: true, repair_complete: true, completed_at: new Date().toISOString(), ...meta },
  }).eq("package_id", packageId).eq("step_key", STEP_KEY);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const body = await req.json().catch(() => ({}));
  const packageId: string | undefined = body.package_id;
  const jobId: string | undefined = body.job_id ?? body._job_id;
  const triggeredBy: string = body.triggered_by ?? "unknown";
  const targetPerLf: number = Number.isFinite(body.target_per_lf)
    ? Number(body.target_per_lf)
    : DEFAULT_TARGET_PER_LF;

  if (!packageId) return json({ error: "missing package_id" }, 400);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Heartbeat ──
  if (jobId) {
    await sb.from("job_queue")
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq("id", jobId);
  }

  // ── C1 ENTRY DEDUP (2026-05-20): Reschedule-Lock ──
  // Prevent multiple parent jobs from running in parallel for the same package.
  // If another lf_repair parent is already parked/processing, self-cancel.
  {
    const { data: siblings } = await sb.from("job_queue")
      .select("id, status, meta, created_at")
      .eq("package_id", packageId)
      .eq("job_type", "package_repair_exam_pool_lf_coverage")
      .in("status", ["pending", "processing", "queued", "running"])
      .order("created_at", { ascending: true });
    const others = (siblings ?? []).filter((s: { id: string }) => s.id !== jobId);
    if (others.length > 0 && jobId) {
      const olderActive = others.find((s: { created_at: string }) =>
        new Date(s.created_at).getTime() < Date.now() - 5_000,
      );
      if (olderActive) {
        await sb.from("job_queue").update({
          status: "cancelled",
          completed_at: new Date().toISOString(),
          last_error_code: "LF_REPAIR_RESCHEDULE_LOCK",
          last_error: `older parent ${(olderActive as { id: string }).id.slice(0,8)} already active for this package`,
          meta: { phase: "self_cancel_reschedule_lock", older_parent_id: (olderActive as { id: string }).id },
        }).eq("id", jobId);
        await sb.from("auto_heal_log").insert({
          action_type: "lf_repair_reschedule_lock_self_cancel",
          target_type: "job",
          target_id: jobId,
          result_status: "cancelled",
          metadata: { package_id: packageId, older_parent_id: (olderActive as { id: string }).id, sibling_count: others.length },
        });
        return json({ status: "cancelled", reason: "LF_REPAIR_RESCHEDULE_LOCK", older_parent_id: (olderActive as { id: string }).id }, 200);
      }
    }
  }

  // ── Load parent job row for reconciler phase detection ──
  let parentRow: { meta: Record<string, unknown> | null } | null = null;
  if (jobId) {
    const { data: prRaw } = await sb.from("job_queue")
      .select("meta")
      .eq("id", jobId)
      .maybeSingle();
    parentRow = (prRaw ?? null) as { meta: Record<string, unknown> | null } | null;
  }

    const parentMeta = (parentRow?.meta ?? {}) as Record<string, unknown>;

    const phase = parentMeta.phase as string | undefined;
    const childIds = Array.isArray(parentMeta.child_job_ids)
      ? (parentMeta.child_job_ids as string[]).filter((x) => typeof x === "string")
      : [];

    if (phase === "parked_awaiting_children" && childIds.length > 0) {
      console.log(`[lf-cov-repair] RECONCILER: parent ${jobId.slice(0,8)} → ${childIds.length} children`);

      const { data: childrenRaw, error: childErr } = await sb.from("job_queue")
        .select("id, status, last_error_code, last_error")
        .in("id", childIds);
      if (childErr) {
        console.error(`[lf-cov-repair] child fetch failed: ${childErr.message}`);
        return json({ error: `child fetch failed: ${childErr.message}` }, 500);
      }
      const children = (childrenRaw ?? []) as Array<{ id: string; status: string; last_error_code: string | null; last_error: string | null }>;
      const byStatus: Record<string, number> = {};
      for (const c of children) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      const pendingLike = children.filter((c) => ["pending", "processing", "queued", "running"].includes(c.status));
      const failedLike = children.filter((c) => ["failed", "cancelled"].includes(c.status));
      const completed = children.filter((c) => c.status === "completed");

      // Branch 1: still working → re-park
      if (pendingLike.length > 0) {
        const reparkAfter = new Date(Date.now() + 90_000).toISOString();
        // C1: reset attempts so awaiting-children cycles don't burn MAX_ATTEMPTS budget.
        await sb.from("job_queue").update({
          status: "pending",
          attempts: 0,
          started_at: null,
          last_heartbeat_at: null,
          run_after: reparkAfter,
          last_error_code: "PARKED_AWAITING_CHILDREN",
          last_error: `awaiting ${pendingLike.length}/${children.length} children`,
          meta: { ...parentMeta, phase: "parked_awaiting_children", reconciler_last_check_at: new Date().toISOString(), child_status_breakdown: byStatus, attempts_reset_for_park: true },
        }).eq("id", jobId).in("status", ["processing", "pending"]);

        await sb.from("auto_heal_log").insert({
          action_type: "lf_repair_parent_waiting_children",
          target_type: "job",
          target_id: jobId,
          result_status: "info",
          metadata: { package_id: packageId, child_status_breakdown: byStatus, total: children.length, pending_like: pendingLike.length },
        });
        return json({
          status: "parked_awaiting_children",
          parent_job_id: jobId,
          parent_status: "pending",
          waiting_for: pendingLike.length,
          child_status_breakdown: byStatus,
          run_after: reparkAfter,
        }, 202);
      }

      // Branch 2: at least one child failed/cancelled → parent failed
      if (failedLike.length > 0) {
        await sb.from("job_queue").update({
          status: "failed",
          last_error_code: "CHILD_JOB_FAILED",
          last_error: `${failedLike.length} child(ren) failed/cancelled (completed=${completed.length})`,
          meta: { ...parentMeta, phase: "child_job_failed", failed_at: new Date().toISOString(), child_status_breakdown: byStatus, failed_child_ids: failedLike.map((c) => c.id) },
        }).eq("id", jobId);
        await markBlocked(sb, packageId, "child_job_failed", { child_status_breakdown: byStatus, failed_children: failedLike.length });
        await sb.from("auto_heal_log").insert({
          action_type: "lf_repair_parent_failed_child",
          target_type: "job",
          target_id: jobId,
          result_status: "failed",
          metadata: { package_id: packageId, child_status_breakdown: byStatus, failed_child_ids: failedLike.map((c) => c.id) },
        });
        return json({
          status: "failed",
          last_error_code: "CHILD_JOB_FAILED",
          parent_job_id: jobId,
          child_status_breakdown: byStatus,
        }, 422);
      }

      // Branch 3: all children completed → coverage recheck
      // STRICT RULE: only gate_status === 'PASS' completes the parent.
      // Reason-code matching is NOT used as primary success/no-effect decision —
      // any non-PASS gate after dispatched children counts as NO_EFFECT_LF_REPAIR.
      const { data: gateRecheckRaw, error: gateRecheckErr } = await sb.rpc("fn_classify_exam_pool_gate", {
        p_package_id: packageId,
      });
      if (gateRecheckErr) {
        console.error(`[lf-cov-repair] reconciler gate recheck failed: ${gateRecheckErr.message}`);
        return json({ error: `gate recheck failed: ${gateRecheckErr.message}` }, 500);
      }
      const gateRecheck = (gateRecheckRaw ?? {}) as Record<string, unknown>;
      const recheckStatus = String(gateRecheck.gate_status ?? "");
      const recheckReasons = Array.isArray(gateRecheck.reason_codes) ? gateRecheck.reason_codes as string[] : [];
      const dispatchedChildren = typeof parentMeta.dispatched_children === "number"
        ? parentMeta.dispatched_children as number
        : childIds.length;
      const previousPhase = typeof parentMeta.phase === "string" ? parentMeta.phase as string : null;
      const gatePassed = recheckStatus === "PASS";

      // 3a: gate PASS → parent completed + enqueue validate_exam_pool
      if (gatePassed) {
        await markDone(sb, packageId, {
          repair_complete: true,
          children_completed: completed.length,
          gate_after: gateRecheck,
          reconciler: true,
        });
        await sb.from("job_queue").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          last_error_code: null,
          last_error: null,
          meta: { ...parentMeta, phase: "completed_after_children", completed_at: new Date().toISOString(), child_status_breakdown: byStatus, gate_after: gateRecheck },
        }).eq("id", jobId);
        try {
          await enqueueJob(sb, {
            job_type: "package_validate_exam_pool",
            package_id: packageId,
            priority: 25,
            payload: { _origin: "lf_repair_post_children_recheck", _origin_job_id: jobId },
          });
        } catch (e) {
          console.warn(`[lf-cov-repair] validate_exam_pool re-enqueue failed: ${(e as Error).message}`);
        }
        await sb.from("auto_heal_log").insert({
          action_type: "lf_repair_parent_completed_after_children",
          target_type: "job",
          target_id: jobId,
          result_status: "success",
          metadata: {
            parent_job_id: jobId,
            package_id: packageId,
            dispatched_children: dispatchedChildren,
            children_completed: completed.length,
            gate_status_after: recheckStatus,
            gate_reasons_after: recheckReasons,
            previous_phase: previousPhase,
            decision: "completed_after_children",
          },
        });
        return json({
          status: "completed",
          parent_job_id: jobId,
          dispatched_children: dispatchedChildren,
          children_completed: completed.length,
          gate_status_after: recheckStatus,
          decision: "completed_after_children",
        }, 200);
      }

      // 3b: gate not PASS after dispatched children → NO_EFFECT_LF_REPAIR (hard surface, no re-loop)
      // Decision is gate-status-driven, NOT reason-code-driven, to prevent NEEDS_REPAIR
      // from masquerading as success when reason-code shapes change.
      await sb.from("job_queue").update({
        status: "failed",
        last_error_code: "NO_EFFECT_LF_REPAIR",
        last_error: `Gate not PASS after ${completed.length}/${dispatchedChildren} child completions (status=${recheckStatus}, reasons=${recheckReasons.join(",")})`,
        meta: { ...parentMeta, phase: "no_effect_after_children", failed_at: new Date().toISOString(), child_status_breakdown: byStatus, gate_after: gateRecheck },
      }).eq("id", jobId);
      await markBlocked(sb, packageId, "no_effect_after_children", {
        dispatched_children: dispatchedChildren,
        children_completed: completed.length,
        gate_status_after: recheckStatus,
        gate_reasons_after: recheckReasons,
      });
      await sb.from("auto_heal_log").insert({
        action_type: "lf_repair_parent_no_effect_after_children",
        target_type: "job",
        target_id: jobId,
        result_status: "blocked_no_effect",
        metadata: {
          parent_job_id: jobId,
          package_id: packageId,
          dispatched_children: dispatchedChildren,
          children_completed: completed.length,
          gate_status_after: recheckStatus,
          gate_reasons_after: recheckReasons,
          previous_phase: previousPhase,
          decision: "no_effect_after_children",
          gate_after: gateRecheck,
        },
      });
      return json({
        status: "failed",
        last_error_code: "NO_EFFECT_LF_REPAIR",
        parent_job_id: jobId,
        dispatched_children: dispatchedChildren,
        children_completed: completed.length,
        gate_status_after: recheckStatus,
        gate_reasons_after: recheckReasons,
        decision: "no_effect_after_children",
      }, 422);
    }


  // ── GUARD 1: Eligibility (fail-closed for automation) ──
  const eligibility = await isRepairActionEligible(
    sb, packageId, REPAIR_ACTION, triggeredBy,
  );
  if (!eligibility.eligible) {
    console.warn(`[lf-cov-repair] INELIGIBLE: ${eligibility.reason} (pkg ${packageId.slice(0, 8)})`);
    await sb.from("auto_heal_log").insert({
      action_type: REPAIR_ACTION,
      result_status: "blocked",
      result_detail: `ineligible: ${eligibility.reason}`,
      metadata: { package_id: packageId, triggered_by: triggeredBy, guard: "eligibility" },
    });
    await markBlocked(sb, packageId, "eligibility_failed", { eligibility_reason: eligibility.reason });
    return json({ status: "blocked", guard: "eligibility", reason: eligibility.reason });
  }

  // ── GUARD 2: Classify gate ──
  const { data: gateRaw, error: gateErr } = await sb.rpc("fn_classify_exam_pool_gate", {
    p_package_id: packageId,
  });
  if (gateErr) {
    console.error(`[lf-cov-repair] classify failed: ${gateErr.message}`);
    return json({ error: `classify failed: ${gateErr.message}` }, 500);
  }
  const gate = (gateRaw ?? {}) as Record<string, unknown>;
  const gateStatus = String(gate.gate_status ?? "");
  const recommended = String(gate.recommended_action ?? "");
  const reasonCodes = Array.isArray(gate.reason_codes) ? gate.reason_codes as string[] : [];

  // GUARD 2a: PASS → nothing to repair
  if (gateStatus === "PASS") {
    await markDone(sb, packageId, { skipped: "gate_status_pass", gate });
    return json({ status: "skipped", reason: "gate_status_pass", gate_status: gateStatus });
  }

  // GUARD 2b: HARD_FAIL with non-coverage cause → manual review, not our job
  const isHardFail = gate.hard_fail === true || gateStatus === "HARD_FAIL";
  const isCoverageCause = reasonCodes.some((c) =>
    c === "REPAIR_LF_COVERAGE" ||
    c === "REPAIR_LF_COVERAGE_SKEWED" ||
    c === "REPAIR_LF_COVERAGE_MISSING"
  );
  if (isHardFail && !isCoverageCause) {
    await markBlocked(sb, packageId, "hard_fail_non_coverage", { gate_status: gateStatus, reason_codes: reasonCodes });
    return json({ status: "blocked", reason: "hard_fail_non_coverage", reason_codes: reasonCodes });
  }

  // GUARD 2c: recommended action mismatch → don't run wrong remediation
  if (recommended !== REPAIR_ACTION) {
    await markBlocked(sb, packageId, "recommended_action_mismatch", {
      expected: REPAIR_ACTION, actual: recommended, gate_status: gateStatus, reason_codes: reasonCodes,
    });
    return json({ status: "blocked", reason: "recommended_action_mismatch", expected: REPAIR_ACTION, actual: recommended });
  }

  // ── GUARD 3: Dedup — active LF-repair fan-out jobs (overall) ──
  const { data: activeFanouts } = await sb.from("job_queue")
    .select("id, payload")
    .eq("package_id", packageId)
    .eq("job_type", "package_generate_exam_pool")
    .in("status", ["pending", "processing", "queued", "running"])
    .contains("payload", { _origin: REPAIR_ACTION });
  // Build set of LF ids already in-flight for this package
  const activeLfSet = new Set<string>();
  for (const row of (activeFanouts ?? []) as Array<{ payload: Record<string, unknown> | null }>) {
    const lf = row.payload?.learning_field_filter;
    if (typeof lf === "string") activeLfSet.add(lf);
  }
  // If a global cap of active LF-repair waves exists (e.g. >= 12), bail to avoid pile-up
  if ((activeFanouts?.length ?? 0) >= 12) {
    console.log(`[lf-cov-repair] global dedup hit: ${activeFanouts!.length} active LF-repair fan-out jobs`);
    return json({ status: "skipped", reason: "active_fanout_cap_reached", count: activeFanouts!.length });
  }

  // ── GUARD 4: No-progress / repeat without delta ──
  const windowAgo = new Date(Date.now() - RECENT_REPAIR_WINDOW_MIN * 60_000).toISOString();
  const { data: recent } = await sb.from("auto_heal_log")
    .select("created_at, result_status, metadata")
    .eq("action_type", REPAIR_ACTION)
    .eq("metadata->>package_id", packageId)
    .gte("created_at", windowAgo)
    .order("created_at", { ascending: false })
    .limit(5);
  const recentNoEffect = (recent ?? []).filter((r) =>
    r.result_status === "no_effect" || r.result_status === "blocked_no_effect"
  );
  if (recentNoEffect.length >= 2) {
    console.warn(`[lf-cov-repair] recent no-effect runs: ${recentNoEffect.length} in last ${RECENT_REPAIR_WINDOW_MIN}min`);
    await markBlocked(sb, packageId, "recent_no_effect_throttle", {
      recent_no_effect: recentNoEffect.length, window_min: RECENT_REPAIR_WINDOW_MIN,
    });
    return json({ status: "blocked", reason: "recent_no_effect_throttle", count: recentNoEffect.length });
  }

  // ── GUARD 5: Capture pre-snapshot ──
  const preSnapshot = await captureGateSnapshot(sb, packageId);

  // ── GUARD 6: SSOT gap classification per LF (Phase c router) ──
  // Replaces blind fn_get_lf_coverage_deficit. Reads v_exam_pool_lf_repair_gap_classification
  // and routes per LF by gap_class: BLUEPRINT_GAP / VARIANT_GAP / QUESTION_GAP_ONLY / OK.
  const { data: gapsRaw, error: gapErr } = await sb
    .from("v_exam_pool_lf_repair_gap_classification")
    .select("learning_field_id, lf_code, approved_bp_count, usable_variant_count, approved_question_count, target_per_lf, question_deficit, gap_class")
    .eq("package_id", packageId);
  if (gapErr) {
    console.error(`[lf-cov-repair] gap classification failed: ${gapErr.message}`);
    return json({ error: `gap classification failed: ${gapErr.message}` }, 500);
  }
  type GapRow = {
    learning_field_id: string;
    lf_code: string;
    approved_bp_count: number;
    usable_variant_count: number;
    approved_question_count: number;
    target_per_lf: number;
    question_deficit: number;
    gap_class: "OK" | "BLUEPRINT_GAP" | "VARIANT_GAP" | "QUESTION_GAP_ONLY" | string;
  };
  const gaps = ((gapsRaw ?? []) as GapRow[]).filter((g) => g.gap_class !== "OK");
  if (gaps.length === 0) {
    console.log(`[lf-cov-repair] no gaps — all LFs OK`);
    await markDone(sb, packageId, { skipped: "no_gaps", target_per_lf: targetPerLf, gate });
    return json({ status: "skipped", reason: "no_gaps", target_per_lf: targetPerLf });
  }

  // Resolve curriculum_id for fan-out payload
  const { data: pkg } = await sb.from("course_packages")
    .select("curriculum_id, certification_id").eq("id", packageId).single();
  const curriculumId = (pkg as { curriculum_id?: string } | null)?.curriculum_id;
  if (!curriculumId) {
    return json({ error: "could not resolve curriculum_id" }, 500);
  }

  // ── ROUTER: per-LF dispatch by gap_class ──
  const ROUTE: Record<string, { job_type: string; reason: string }> = {
    BLUEPRINT_GAP: { job_type: "package_auto_seed_exam_blueprints", reason: "no_approved_blueprints" },
    VARIANT_GAP:   { job_type: "package_generate_blueprint_variants", reason: "no_usable_variants" },
    QUESTION_GAP_ONLY: { job_type: "package_generate_exam_pool", reason: "question_deficit" },
  };

  type Dispatched = { lf_code: string; gap_class: string; job_type: string; job_id: string; deficit: number };
  const dispatched: Dispatched[] = [];
  const skippedLfs: Array<{ lf_code: string; gap_class: string; reason: string }> = [];

  for (const g of gaps) {
    const route = ROUTE[g.gap_class];
    if (!route) {
      skippedLfs.push({ lf_code: g.lf_code, gap_class: g.gap_class, reason: "unknown_gap_class" });
      continue;
    }
    // Per-LF dedup only meaningful for question-gen path (others are coarse-grained)
    if (route.job_type === "package_generate_exam_pool" && activeLfSet.has(g.learning_field_id)) {
      skippedLfs.push({ lf_code: g.lf_code, gap_class: g.gap_class, reason: "active_fanout_for_lf" });
      continue;
    }
    try {
      const payload: Record<string, unknown> = {
        curriculum_id: curriculumId,
        _origin: REPAIR_ACTION,
        _origin_job_id: jobId ?? null,
        _gap_class: g.gap_class,
        learning_field_filter: g.learning_field_id,
        lf_code: g.lf_code,
      };
      if (route.job_type === "package_generate_exam_pool") {
        payload._fan_out = true;
        payload.lf_target_total = g.target_per_lf;
        payload.target_per_lf = targetPerLf;
        payload.deficit = g.question_deficit;
      }
      const result = await enqueueJob(sb, {
        job_type: route.job_type,
        package_id: packageId,
        priority: 30,
        batch_cursor: { lf_repair_router: g.learning_field_id, gap_class: g.gap_class },
        payload,
      });
      dispatched.push({
        lf_code: g.lf_code,
        gap_class: g.gap_class,
        job_type: route.job_type,
        job_id: (result as { id: string }).id,
        deficit: g.question_deficit,
      });
      if (route.job_type === "package_generate_exam_pool") {
        activeLfSet.add(g.learning_field_id);
      }
    } catch (e) {
      const err = serializeErr(e);
      console.error("[lf-cov-repair] enqueue failed", { lf: g.lf_code, gap_class: g.gap_class, ...err });
      skippedLfs.push({ lf_code: g.lf_code, gap_class: g.gap_class, reason: `enqueue_failed: ${err.message ?? "unknown"}` });
    }
  }

  // Counts by class for audit/visibility
  const byClass = dispatched.reduce<Record<string, number>>((acc, d) => {
    acc[d.gap_class] = (acc[d.gap_class] ?? 0) + 1;
    return acc;
  }, {});

  if (dispatched.length === 0) {
    // Bug C: parent must NOT complete when no children were dispatched.
    // Self-update parent job to failed with explicit last_error_code, return 422.
    await markBlocked(sb, packageId, "no_jobs_dispatched", {
      gaps_count: gaps.length, target_per_lf: targetPerLf, skipped_lfs: skippedLfs,
    });
    if (jobId) {
      await sb.from("job_queue").update({
        status: "failed",
        last_error_code: "NO_CHILDREN_DISPATCHED",
        last_error: `no_jobs_dispatched: ${skippedLfs.length} LFs skipped (gaps=${gaps.length})`,
        meta: {
          phase: "no_children_dispatched",
          gaps_count: gaps.length,
          skipped_lfs: skippedLfs,
          failed_at: new Date().toISOString(),
        },
      }).eq("id", jobId);
    }
    await sb.from("auto_heal_log").insert({
      action_type: REPAIR_ACTION,
      target_type: "package",
      target_id: packageId,
      result_status: "blocked_no_effect",
      metadata: {
        package_id: packageId,
        triggered_by: triggeredBy,
        guard: "no_children_dispatched",
        gaps_count: gaps.length,
        skipped_lfs: skippedLfs,
      },
    });
    return json({
      status: "failed",
      reason: "no_jobs_dispatched",
      last_error_code: "NO_CHILDREN_DISPATCHED",
      skipped_lfs: skippedLfs,
    }, 422);
  }

  const postSnapshot = await captureGateSnapshot(sb, packageId);
  const gateChange = await hasGateStateChanged(sb, preSnapshot, postSnapshot);

  await sb.from("auto_heal_log").insert({
    action_type: REPAIR_ACTION,
    target_type: "package",
    target_id: packageId,
    result_status: "success",
    metadata: {
      package_id: packageId,
      curriculum_id: curriculumId,
      triggered_by: triggeredBy,
      target_per_lf: targetPerLf,
      gaps_count: gaps.length,
      dispatched_count: dispatched.length,
      skipped_count: skippedLfs.length,
      dispatched_by_class: byClass,
      dispatched,
      skipped_lfs: skippedLfs,
      pre_snapshot: preSnapshot,
      post_snapshot: postSnapshot,
      gate_change: gateChange,
      gate_status_before: gateStatus,
      reason_codes: reasonCodes,
      router_version: "phase_c_v1",
    },
  });

  // ── PARK parent — do NOT mark done while children are still working ──
  // Re-validation is triggered by downstream completion (job-runner re-evaluates step DAG).
  const childJobIds = dispatched.map((d) => d.job_id);
  const stepExists = await ensureRepairStep(sb, packageId);
  if (stepExists) {
    await sb.from("package_steps").update({
      status: "queued",
      updated_at: new Date().toISOString(),
      meta: {
        ok: false,
        phase: "parked_awaiting_children",
        parked_at: new Date().toISOString(),
        dispatched_count: dispatched.length,
        dispatched_children: dispatched.length,
        dispatched_by_class: byClass,
        child_job_ids: childJobIds,
        target_per_lf: targetPerLf,
        pre_snapshot: preSnapshot,
        router_version: "phase_c_v1",
      },
    }).eq("package_id", packageId).eq("step_key", STEP_KEY);
  }

  // Bug C: park the PARENT job_queue row itself so the job-runner does not
  // flip it to completed while the dispatched LF children are still working.
  // Status=queued + run_after = now + 90s → reaped/re-claimed for coverage recheck.
  if (jobId) {
    const { error: parkErr } = await sb.from("job_queue").update({
      status: "pending",
      attempts: 0, // C1: don't burn retry budget while waiting for children
      started_at: null,
      last_heartbeat_at: null,
      run_after: new Date(Date.now() + 90_000).toISOString(),
      last_error_code: "PARKED_AWAITING_CHILDREN",
      last_error: `parked: ${dispatched.length} children dispatched (${Object.entries(byClass).map(([k,v]) => `${k}=${v}`).join(",")})`,
      meta: {
        phase: "parked_awaiting_children",
        parked_at: new Date().toISOString(),
        dispatched_children: dispatched.length,
        dispatched_by_class: byClass,
        child_job_ids: childJobIds,
        target_per_lf: targetPerLf,
        gate_status_before: gateStatus,
        router_version: "phase_c_v1",
        attempts_reset_for_park: true,
      },
    }).eq("id", jobId).in("status", ["processing", "pending"]);

    if (parkErr) {
      console.error(`[lf-cov-repair] parent park failed: ${parkErr.message}`);
      await sb.from("auto_heal_log").insert({
        action_type: "lf_cov_repair_parent_park_failed",
        target_type: "job",
        target_id: jobId,
        result_status: "warn",
        metadata: { package_id: packageId, error: parkErr.message, dispatched: dispatched.length },
      });
    }
  }

  return json({
    status: "parked_awaiting_children",
    parent_job_id: jobId ?? null,
    parent_status: "pending",
    gaps: gaps.length,
    dispatched: dispatched.length,
    dispatched_children: dispatched.length,
    dispatched_by_class: byClass,
    child_job_ids: childJobIds,
    skipped: skippedLfs.length,
    target_per_lf: targetPerLf,
    jobs: dispatched,
    skipped_lfs: skippedLfs,
    next: "child completions re-trigger validate_exam_pool via job-runner; parent re-claims after 90s for coverage recheck",
  }, 202);
});
