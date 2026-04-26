/**
 * exam-pool-loop-breaker
 * ──────────────────────
 * Fokussierter Watchdog für exam_pool Generation/Repair-Loops:
 *
 *  1. EMPTY/TIMEOUT/503-LOOP DETECTOR
 *     - findet package_generate_exam_pool Jobs mit ≥3 Versuchen und
 *       last_error matched (TRANSIENT|HTTP 503|empty/timeout|gen=0)
 *     - cancelt sie sauber, schreibt Audit + ops_alert (severity high)
 *     - blockiert Neu-Enqueue für 10 min (cooldown via meta.loop_breaker_cooldown_until)
 *
 *  2. MISSING ARTIFACT REPAIR
 *     - findet package_repair_exam_pool_quality Jobs mit
 *       last_error 'Artifact missing: exam_questions%'
 *     - cancelt + enqueued saubere package_generate_exam_pool Jobs
 *
 *  3. LF-COVERAGE FAIL CHAIN
 *     - findet package_validate_exam_pool mit QG FAIL%REPAIR_LF_COVERAGE
 *     - falls Repair-Job nicht aktiv → einen frischen anstoßen
 *
 *  Idempotent, max 50 Pakete pro Lauf, schreibt Audit-Trail.
 *  Cron empfohlen: alle 5 Minuten.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOOP_THRESHOLD_ATTEMPTS = 3;
const LOOP_COOLDOWN_MIN = 10;
const MAX_PACKAGES_PER_RUN = 50;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function isLoopError(err: string | null | undefined): boolean {
  if (!err) return false;
  return /TRANSIENT|HTTP 503|empty\/timeout|gen=0|SUPABASE_EDGE_RUNTIME_ERROR/i.test(err);
}

async function audit(
  sb: ReturnType<typeof createClient>,
  action: string,
  payload: unknown,
) {
  await sb.from("admin_actions").insert({
    action,
    scope: "pipeline.exam_pool.loop_breaker",
    payload: payload as never,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const result = {
    loops_broken: 0,
    missing_artifacts_fixed: 0,
    coverage_repairs_enqueued: 0,
    cooldowns_set: 0,
    errors: [] as string[],
  };

  try {
    // ─── 1. EMPTY/TIMEOUT/503-LOOP DETECTOR ─────────────────────────
    const { data: loopJobs } = await sb
      .from("job_queue")
      .select("id, package_id, attempts, last_error, meta, created_at")
      .eq("job_type", "package_generate_exam_pool")
      .in("status", ["pending", "processing"])
      .gte("attempts", LOOP_THRESHOLD_ATTEMPTS)
      .limit(MAX_PACKAGES_PER_RUN);

    const cooldownUntil = new Date(Date.now() + LOOP_COOLDOWN_MIN * 60_000).toISOString();
    const brokenPackageIds: string[] = [];

    for (const job of loopJobs ?? []) {
      if (!isLoopError(job.last_error as string | null)) continue;

      // Cancel job
      await sb
        .from("job_queue")
        .update({
          status: "cancelled",
          last_error:
            (job.last_error ?? "") +
            ` || LOOP_BREAKER_${LOOP_THRESHOLD_ATTEMPTS}x_${LOOP_COOLDOWN_MIN}min_cooldown`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      // Cooldown auf Paket
      const meta = (job.meta ?? {}) as Record<string, unknown>;
      meta.loop_breaker_cooldown_until = cooldownUntil;
      meta.loop_breaker_last_at = new Date().toISOString();
      await sb
        .from("course_packages")
        .update({
          last_error: `LOOP_BREAKER: generate_exam_pool 503/empty-loop nach ${job.attempts} Versuchen, Cooldown ${LOOP_COOLDOWN_MIN}min`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.package_id);

      // ops_alert
      await sb.from("ops_alerts").insert({
        severity: "high",
        source: "exam_pool_loop_breaker",
        message: `generate_exam_pool 503/empty Loop (${job.attempts} Versuche) auf Paket ${job.package_id} unterbrochen`,
        meta: {
          package_id: job.package_id,
          job_id: job.id,
          last_error: job.last_error,
          cooldown_until: cooldownUntil,
        },
      });

      brokenPackageIds.push(job.package_id as string);
      result.loops_broken++;
      result.cooldowns_set++;
    }

    // ─── 2. MISSING ARTIFACT REPAIR ─────────────────────────────────
    const { data: missingArtifactJobs } = await sb
      .from("job_queue")
      .select("id, package_id, last_error")
      .eq("job_type", "package_repair_exam_pool_quality")
      .in("status", ["pending", "processing"])
      .ilike("last_error", "Artifact missing: exam_questions%")
      .limit(MAX_PACKAGES_PER_RUN);

    for (const job of missingArtifactJobs ?? []) {
      // Skip wenn schon im Cooldown
      if (brokenPackageIds.includes(job.package_id as string)) continue;

      // Cancel den falschen Repair-Job
      await sb
        .from("job_queue")
        .update({
          status: "cancelled",
          last_error:
            (job.last_error ?? "") +
            " || LOOP_BREAKER: repair gecancelled, generate_exam_pool wird neu eingereiht",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      // Curriculum für Payload holen
      const { data: pkg } = await sb
        .from("course_packages")
        .select("curriculum_id, status")
        .eq("id", job.package_id)
        .maybeSingle();

      if (!pkg || pkg.status !== "building") continue;

      // Prüfen, ob schon ein generate_exam_pool aktiv ist
      const { count: activeCount } = await sb
        .from("job_queue")
        .select("id", { count: "exact", head: true })
        .eq("package_id", job.package_id)
        .eq("job_type", "package_generate_exam_pool")
        .in("status", ["pending", "processing"]);

      if ((activeCount ?? 0) > 0) continue;

      // Frischen Generate-Job einreihen
      await sb.from("job_queue").insert({
        job_type: "package_generate_exam_pool",
        status: "pending",
        package_id: job.package_id,
        worker_pool: "default",
        priority: 5,
        payload: {
          package_id: job.package_id,
          curriculum_id: pkg.curriculum_id,
          step_key: "generate_exam_pool",
        },
        meta: {
          loop_breaker_origin: "missing_artifact_recovery",
          enqueued_at: new Date().toISOString(),
        },
      });

      result.missing_artifacts_fixed++;
    }

    // ─── 3. LF-COVERAGE FAIL CHAIN ──────────────────────────────────
    const { data: covFailJobs } = await sb
      .from("job_queue")
      .select("id, package_id, last_error")
      .eq("job_type", "package_validate_exam_pool")
      .in("status", ["pending", "processing"])
      .ilike("last_error", "%REPAIR_LF_COVERAGE%")
      .limit(MAX_PACKAGES_PER_RUN);

    for (const job of covFailJobs ?? []) {
      // Skip wenn Cooldown
      if (brokenPackageIds.includes(job.package_id as string)) continue;

      // Prüfen ob LF-Coverage-Repair schon aktiv ist
      const { count: activeRepair } = await sb
        .from("job_queue")
        .select("id", { count: "exact", head: true })
        .eq("package_id", job.package_id)
        .eq("job_type", "package_repair_exam_pool_lf_coverage")
        .in("status", ["pending", "processing"]);

      if ((activeRepair ?? 0) > 0) continue;

      const { data: pkg } = await sb
        .from("course_packages")
        .select("curriculum_id, status")
        .eq("id", job.package_id)
        .maybeSingle();

      if (!pkg || pkg.status !== "building") continue;

      await sb.from("job_queue").insert({
        job_type: "package_repair_exam_pool_lf_coverage",
        status: "pending",
        package_id: job.package_id,
        worker_pool: "default",
        priority: 5,
        payload: {
          package_id: job.package_id,
          curriculum_id: pkg.curriculum_id,
          step_key: "repair_exam_pool_lf_coverage",
        },
        meta: {
          loop_breaker_origin: "lf_coverage_repair_chain",
          source_validate_job_id: job.id,
          enqueued_at: new Date().toISOString(),
        },
      });

      result.coverage_repairs_enqueued++;
    }

    // ─── AUDIT ───────────────────────────────────────────────────────
    if (
      result.loops_broken > 0 ||
      result.missing_artifacts_fixed > 0 ||
      result.coverage_repairs_enqueued > 0
    ) {
      await audit(sb, "exam_pool_loop_breaker_run", result);
    }

    return json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);
    await audit(sb, "exam_pool_loop_breaker_error", { ...result, msg });
    return json({ ok: false, ...result, error: msg }, 500);
  }
});
