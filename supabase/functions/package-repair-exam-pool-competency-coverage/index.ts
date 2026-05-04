import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { enqueueJob } from "../_shared/enqueue.ts";

/**
 * package-repair-exam-pool-competency-coverage
 * ────────────────────────────────────────────
 *
 * TARGETED competency-deficit repair. Pendant zu lf_coverage, aber granularer:
 * LF-Abdeckung kann grün sein, während einzelne Kompetenzen 0 Fragen haben →
 * Auto-Repair-Limit-Loop, weil quality-repair nichts neues generiert.
 *
 * Flow:
 *   1. Ensure repair step
 *   2. Resolve curriculum_id (SSOT-Join für competencies via learning_fields)
 *   3. Compute deficits: competencies WHERE COUNT(approved questions) < target
 *   4. Dedup against active fan-out jobs (per competency)
 *   5. Per deficit competency: enqueue package_generate_exam_pool fan-out
 *   6. Mark step done; downstream completion re-triggers validate_exam_pool
 *
 * Payload contract:
 *   { package_id: uuid, target_per_competency?: number, _job_id?: string,
 *     triggered_by?: string }
 */

const STEP_KEY = "repair_exam_pool_competency_coverage";
const REPAIR_ACTION = "competency_coverage_repair";
const DEFAULT_TARGET_PER_COMPETENCY = 5;
const COMPETENCY_BATCH_CAP = 60;  // max competencies per single targeted_competency_fill job

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
      console.error(`[comp-cov-repair] ensure step failed: ${insErr.message}`);
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
  const targetPerCompetency: number = Number.isFinite(body.target_per_competency)
    ? Number(body.target_per_competency)
    : DEFAULT_TARGET_PER_COMPETENCY;

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

  // ── Resolve curriculum_id (SSOT — competencies join via learning_fields) ──
  const { data: pkg, error: pkgErr } = await sb.from("course_packages")
    .select("curriculum_id, certification_id")
    .eq("id", packageId)
    .single();
  if (pkgErr || !pkg) {
    return json({ error: `could not resolve package: ${pkgErr?.message ?? "not found"}` }, 500);
  }
  const curriculumId = (pkg as { curriculum_id?: string }).curriculum_id;
  if (!curriculumId) {
    await markBlocked(sb, packageId, "no_curriculum_id", {});
    return json({ status: "blocked", reason: "no_curriculum_id" });
  }

  // ── Compute deficits ──
  // competencies → learning_fields(curriculum_id) → exam_questions(curriculum_id, competency_id, qc_status)
  const { data: comps, error: compErr } = await sb
    .from("competencies")
    .select("id, code, title, learning_field_id, learning_fields!inner(curriculum_id)")
    .eq("learning_fields.curriculum_id", curriculumId);
  if (compErr) {
    return json({ error: `competency query failed: ${compErr.message}` }, 500);
  }
  const competencies = (comps ?? []) as Array<{
    id: string;
    code: string | null;
    title: string | null;
    learning_field_id: string;
  }>;

  if (competencies.length === 0) {
    await markDone(sb, packageId, { skipped: "no_competencies", curriculum_id: curriculumId });
    return json({ status: "skipped", reason: "no_competencies" });
  }

  // Approved-question counts per competency (single batched query)
  const { data: qRows, error: qErr } = await sb
    .from("exam_questions")
    .select("competency_id")
    .eq("curriculum_id", curriculumId)
    .eq("qc_status", "approved")
    .in("competency_id", competencies.map((c) => c.id));
  if (qErr) {
    return json({ error: `exam_questions count failed: ${qErr.message}` }, 500);
  }
  const counts = new Map<string, number>();
  for (const row of (qRows ?? []) as Array<{ competency_id: string | null }>) {
    if (!row.competency_id) continue;
    counts.set(row.competency_id, (counts.get(row.competency_id) ?? 0) + 1);
  }

  const deficits = competencies
    .map((c) => ({
      competency_id: c.id,
      code: c.code ?? "",
      title: c.title ?? "",
      learning_field_id: c.learning_field_id,
      current_count: counts.get(c.id) ?? 0,
      target_count: targetPerCompetency,
      deficit: Math.max(0, targetPerCompetency - (counts.get(c.id) ?? 0)),
    }))
    .filter((d) => d.deficit > 0);

  if (deficits.length === 0) {
    await markDone(sb, packageId, {
      skipped: "no_deficits",
      target_per_competency: targetPerCompetency,
      competencies: competencies.length,
    });
    return json({
      status: "skipped",
      reason: "no_deficits",
      target_per_competency: targetPerCompetency,
    });
  }

  // ── Dedup against active targeted_competency_fill repair jobs ──
  // The generator's targeted_competency_fill mode handles the per-competency loop internally;
  // we enqueue ONE job per repair invocation with the full deficit set.
  const { data: activeRepairs } = await sb.from("job_queue")
    .select("id, payload, status")
    .eq("package_id", packageId)
    .eq("job_type", "package_generate_exam_pool")
    .in("status", ["pending", "processing", "queued", "running", "batch_pending"])
    .contains("payload", { _origin: REPAIR_ACTION });

  if ((activeRepairs?.length ?? 0) > 0) {
    await markDone(sb, packageId, {
      skipped: "active_repair_job_exists",
      active_count: activeRepairs!.length,
      active_ids: activeRepairs!.map(r => (r as any).id),
    });
    return json({
      status: "skipped",
      reason: "active_targeted_competency_fill_job_exists",
      count: activeRepairs!.length,
    });
  }

  // ── Build single targeted_competency_fill payload ──
  // Cap at COMPETENCY_BATCH_CAP per job; the worker handles continuation_depth internally.
  const targetCompetencyIds = deficits
    .slice(0, COMPETENCY_BATCH_CAP)
    .map(d => d.competency_id);
  const truncated = deficits.length > COMPETENCY_BATCH_CAP;

  let dispatchedJobId: string | null = null;
  let dispatchError: string | null = null;
  try {
    const result = await enqueueJob(sb, {
      job_type: "package_generate_exam_pool",
      package_id: packageId,
      priority: 25,
      payload: {
        package_id: packageId,
        curriculum_id: curriculumId,
        // Use the worker's existing P0 SCOPED REPAIR BRANCH (mode='targeted_competency_fill')
        mode: "targeted_competency_fill",
        is_repair: true,
        target_competency_ids: targetCompetencyIds,
        target_per_competency: targetPerCompetency,
        // Identity / SSOT contract
        step_key: "generate_exam_pool",
        enqueue_source: REPAIR_ACTION,
        _origin: REPAIR_ACTION,
        _origin_job_id: jobId ?? null,
        // Continuation lineage
        continuation_depth: 0,
        root_job_id: jobId ?? null,
        parent_job_id: jobId ?? null,
        // Tail-step downstream signal (consumed by trg_competency_repair_completion → resets validate→auto_publish)
        requeue_tail_after_success: true,
        deficit_total: deficits.reduce((s, d) => s + d.deficit, 0),
      },
    });
    dispatchedJobId = (result as { id: string }).id;
  } catch (e) {
    dispatchError = e instanceof Error ? e.message : String(e);
    console.warn(`[comp-cov-repair] enqueue failed: ${dispatchError}`);
  }

  if (!dispatchedJobId) {
    await markBlocked(sb, packageId, "no_job_dispatched", {
      deficits_count: deficits.length,
      target_competency_ids: targetCompetencyIds,
      error: dispatchError,
    });
    return json({ status: "blocked", reason: "no_job_dispatched", error: dispatchError });
  }

  // ── Audit log: competency_filter_generation_started ──
  await sb.from("auto_heal_log").insert({
    action_type: "competency_filter_generation_started",
    target_type: "course_package",
    target_id: packageId,
    result_status: "success",
    result_detail:
      `enqueued targeted_competency_fill job for ${targetCompetencyIds.length}/${deficits.length} deficit competencies`,
    metadata: {
      package_id: packageId,
      curriculum_id: curriculumId,
      triggered_by: triggeredBy,
      target_per_competency: targetPerCompetency,
      competencies_total: competencies.length,
      deficits_count: deficits.length,
      target_competency_ids_count: targetCompetencyIds.length,
      truncated,
      generation_job_id: dispatchedJobId,
      total_deficit: deficits.reduce((s, d) => s + d.deficit, 0),
    },
  });

  await markDone(sb, packageId, {
    generation_job_id: dispatchedJobId,
    target_competency_ids_count: targetCompetencyIds.length,
    deficits_count: deficits.length,
    truncated,
    target_per_competency: targetPerCompetency,
    pending_followup: "targeted_competency_fill_completion_resets_tail_steps",
  });

  return json({
    status: "dispatched",
    mode: "targeted_competency_fill",
    competencies_total: competencies.length,
    deficits: deficits.length,
    target_competency_ids_count: targetCompetencyIds.length,
    truncated,
    target_per_competency: targetPerCompetency,
    generation_job_id: dispatchedJobId,
    next: "generator runs targeted_competency_fill; on completion trigger resets validate_exam_pool→auto_publish",
  });
});
