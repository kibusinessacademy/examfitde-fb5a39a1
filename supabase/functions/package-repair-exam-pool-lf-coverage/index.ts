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
const REPAIR_ACTION = "enqueue_lf_coverage_repair";
const DEFAULT_TARGET_PER_LF = 15;
const RECENT_REPAIR_WINDOW_MIN = 30;

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

  // ── GUARD 3: Dedup — active LF-repair fan-out jobs ──
  const { data: activeFanouts } = await sb.from("job_queue")
    .select("id")
    .eq("package_id", packageId)
    .eq("job_type", "package_generate_exam_pool")
    .in("status", ["pending", "processing", "queued", "running"])
    .contains("payload", { _origin: REPAIR_ACTION });
  if ((activeFanouts?.length ?? 0) > 0) {
    console.log(`[lf-cov-repair] dedup hit: ${activeFanouts!.length} active LF-repair fan-out jobs`);
    return json({ status: "skipped", reason: "active_fanout_jobs_exist", count: activeFanouts!.length });
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

  // ── GUARD 6: Compute deficits ──
  const { data: deficitsRaw, error: defErr } = await sb.rpc("fn_get_lf_coverage_deficit", {
    p_package_id: packageId,
    p_target_per_lf: targetPerLf,
  });
  if (defErr) {
    console.error(`[lf-cov-repair] deficit computation failed: ${defErr.message}`);
    return json({ error: `deficit failed: ${defErr.message}` }, 500);
  }
  const deficits = (deficitsRaw ?? []) as Array<{
    learning_field_id: string;
    lf_code: string;
    lf_title: string;
    current_count: number;
    target_count: number;
    deficit: number;
  }>;
  if (deficits.length === 0) {
    console.log(`[lf-cov-repair] no deficits at target_per_lf=${targetPerLf} — gate may have moved`);
    await markDone(sb, packageId, { skipped: "no_deficits", target_per_lf: targetPerLf, gate });
    return json({ status: "skipped", reason: "no_deficits", target_per_lf: targetPerLf });
  }

  // Resolve curriculum_id for fan-out payload
  const { data: pkg } = await sb.from("course_packages")
    .select("curriculum_id, certification_id").eq("id", packageId).single();
  const curriculumId = (pkg as { curriculum_id?: string } | null)?.curriculum_id;
  if (!curriculumId) {
    return json({ error: "could not resolve curriculum_id" }, 500);
  }

  // ── DISPATCH: targeted fan-out per deficit LF ──
  const dispatched: Array<{ lf_code: string; deficit: number; lf_target_total: number; job_id: string }> = [];
  for (const d of deficits) {
    try {
      const result = await enqueueJob(sb, {
        job_type: "package_generate_exam_pool",
        package_id: packageId,
        priority: 30,
        payload: {
          curriculum_id: curriculumId,
          _fan_out: true,
          learning_field_filter: d.learning_field_id,
          lf_target_total: d.target_count,
          _origin: REPAIR_ACTION,
          _origin_job_id: jobId ?? null,
          target_per_lf: targetPerLf,
          deficit: d.deficit,
        },
      });
      dispatched.push({
        lf_code: d.lf_code,
        deficit: d.deficit,
        lf_target_total: d.target_count,
        job_id: (result as { id: string }).id,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[lf-cov-repair] enqueue failed for lf=${d.lf_code}: ${msg}`);
    }
  }

  if (dispatched.length === 0) {
    await markBlocked(sb, packageId, "no_jobs_dispatched", {
      deficits_count: deficits.length, target_per_lf: targetPerLf,
    });
    return json({ status: "blocked", reason: "no_jobs_dispatched" });
  }

  // ── Heartbeat / progress meta ──
  const postSnapshot = await captureGateSnapshot(sb, packageId);
  const gateChange = await hasGateStateChanged(sb, preSnapshot, postSnapshot);

  await sb.from("auto_heal_log").insert({
    action_type: REPAIR_ACTION,
    result_status: "success",
    result_detail: `dispatched ${dispatched.length}/${deficits.length} LF fan-out jobs`,
    metadata: {
      package_id: packageId,
      curriculum_id: curriculumId,
      triggered_by: triggeredBy,
      target_per_lf: targetPerLf,
      deficits_count: deficits.length,
      dispatched_count: dispatched.length,
      dispatched,
      pre_snapshot: preSnapshot,
      post_snapshot: postSnapshot,
      gate_change: gateChange,
      gate_status_before: gateStatus,
      reason_codes: reasonCodes,
    },
  });

  await markDone(sb, packageId, {
    dispatched_count: dispatched.length,
    deficits_count: deficits.length,
    target_per_lf: targetPerLf,
    pending_followup: "fan_out_completion_triggers_validate_exam_pool",
    pre_snapshot: preSnapshot,
  });

  return json({
    status: "dispatched",
    deficits: deficits.length,
    dispatched: dispatched.length,
    target_per_lf: targetPerLf,
    jobs: dispatched,
    next: "fan-out completion will re-trigger validate_exam_pool via job-runner",
  });
});
