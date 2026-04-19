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
const REPAIR_ACTION = "enqueue_competency_coverage_repair";
const DEFAULT_TARGET_PER_COMPETENCY = 5;
const FANOUT_GLOBAL_CAP = 12;

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

  // ── Dedup against active fan-out jobs ──
  const { data: activeFanouts } = await sb.from("job_queue")
    .select("id, payload")
    .eq("package_id", packageId)
    .eq("job_type", "package_generate_exam_pool")
    .in("status", ["pending", "processing", "queued", "running"])
    .contains("payload", { _origin: REPAIR_ACTION });
  const activeCompSet = new Set<string>();
  for (const row of (activeFanouts ?? []) as Array<{ payload: Record<string, unknown> | null }>) {
    const cid = row.payload?.competency_filter;
    if (typeof cid === "string") activeCompSet.add(cid);
  }
  if ((activeFanouts?.length ?? 0) >= FANOUT_GLOBAL_CAP) {
    return json({
      status: "skipped",
      reason: "active_fanout_cap_reached",
      count: activeFanouts!.length,
    });
  }

  // ── Dispatch fan-out per deficit competency ──
  const dispatched: Array<{
    competency_id: string;
    code: string;
    deficit: number;
    job_id: string;
  }> = [];
  const skipped: Array<{ competency_id: string; reason: string }> = [];

  for (const d of deficits) {
    if (activeCompSet.has(d.competency_id)) {
      skipped.push({ competency_id: d.competency_id, reason: "active_fanout_for_competency" });
      continue;
    }
    try {
      const result = await enqueueJob(sb, {
        job_type: "package_generate_exam_pool",
        package_id: packageId,
        priority: 30,
        batch_cursor: { comp_repair: d.competency_id, target_per_competency: targetPerCompetency },
        payload: {
          curriculum_id: curriculumId,
          _fan_out: true,
          competency_filter: d.competency_id,
          learning_field_filter: d.learning_field_id,
          competency_target_total: d.target_count,
          _origin: REPAIR_ACTION,
          _origin_job_id: jobId ?? null,
          target_per_competency: targetPerCompetency,
          deficit: d.deficit,
        },
      });
      dispatched.push({
        competency_id: d.competency_id,
        code: d.code,
        deficit: d.deficit,
        job_id: (result as { id: string }).id,
      });
      activeCompSet.add(d.competency_id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[comp-cov-repair] enqueue failed for ${d.code}: ${msg}`);
      skipped.push({ competency_id: d.competency_id, reason: `enqueue_failed: ${msg}` });
    }
  }

  if (dispatched.length === 0) {
    await markBlocked(sb, packageId, "no_jobs_dispatched", {
      deficits_count: deficits.length,
      skipped,
    });
    return json({ status: "blocked", reason: "no_jobs_dispatched", skipped });
  }

  // ── Audit log ──
  await sb.from("auto_heal_log").insert({
    action_type: REPAIR_ACTION,
    result_status: "success",
    result_detail:
      `dispatched ${dispatched.length}/${deficits.length} competency fan-out jobs ` +
      `(skipped ${skipped.length})`,
    metadata: {
      package_id: packageId,
      curriculum_id: curriculumId,
      triggered_by: triggeredBy,
      target_per_competency: targetPerCompetency,
      competencies_total: competencies.length,
      deficits_count: deficits.length,
      dispatched_count: dispatched.length,
      skipped_count: skipped.length,
      dispatched,
      skipped,
    },
  });

  await markDone(sb, packageId, {
    dispatched_count: dispatched.length,
    deficits_count: deficits.length,
    skipped_count: skipped.length,
    target_per_competency: targetPerCompetency,
    pending_followup: "fan_out_completion_triggers_validate_exam_pool",
  });

  return json({
    status: "dispatched",
    competencies_total: competencies.length,
    deficits: deficits.length,
    dispatched: dispatched.length,
    skipped: skipped.length,
    target_per_competency: targetPerCompetency,
    jobs: dispatched,
    next: "fan-out completion will re-trigger validate_exam_pool via job-runner",
  });
});
