import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200, origin?: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

interface GapPlan {
  round: number;
  actions: Array<{ job_type: string; count: number; scope: string; payload_extra?: Record<string, unknown> }>;
  estimated_jobs: number;
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;
  const courseId = p.course_id;
  const targetScore = p.target_score || 85;
  const maxRounds = p.max_rounds || 3;
  const budgetEur = p.budget_eur || 2.0;
  const dryRun = p.dry_run === true;
  const autofixRunId = p.autofix_run_id; // if continuing an existing run

  if (!packageId || !curriculumId) {
    return json({ error: "package_id and curriculum_id required" }, 400, origin);
  }

  try {
    // 1) Load or create autofix_run
    let run: any;
    if (autofixRunId) {
      const { data, error } = await sb.from("autofix_runs").select("*").eq("id", autofixRunId).single();
      if (error || !data) return json({ error: "Autofix run not found" }, 404, origin);
      run = data;
      if (run.status !== "running") {
        return json({ error: `Autofix run is ${run.status}, not running` }, 409, origin);
      }
    } else {
      // Check for existing running autofix for this package
      const { data: existing } = await sb.from("autofix_runs")
        .select("id").eq("package_id", packageId).eq("status", "running").maybeSingle();
      if (existing) {
        return json({ error: "Autofix already running", autofix_run_id: existing.id }, 409, origin);
      }
      const { data: newRun, error: insertErr } = await sb.from("autofix_runs").insert({
        package_id: packageId,
        curriculum_id: curriculumId,
        course_id: courseId,
        target_score: targetScore,
        max_rounds: maxRounds,
        budget_eur: budgetEur,
      }).select("*").single();
      if (insertErr) throw insertErr;
      run = newRun;
    }

    // 2) Run integrity check
    const { data: report, error: rpcErr } = await sb.rpc("validate_course_integrity_v2", {
      p_course_id: courseId,
      p_package_id: packageId,
      p_options: { exam_target: 1000, oral_target: 20, handbook_chapter_target: 5 },
    });
    if (rpcErr) throw rpcErr;

    const score = Number((report as any)?.score ?? 0);
    const passed = Boolean((report as any)?.passed);

    // Update run with latest score
    await sb.from("autofix_runs").update({
      last_score: score,
      last_report: report as any,
      current_round: run.current_round + 1,
    }).eq("id", run.id);

    // 3) Check termination conditions
    // Stagnation guard: stop if score didn't improve from last round
    if (run.last_score !== null && score <= run.last_score && run.current_round > 1) {
      await sb.from("autofix_runs").update({
        status: "stopped",
        stop_reason: `No progress: score stayed at ${score} (was ${run.last_score})`,
        last_score: score,
        last_report: report as any,
      }).eq("id", run.id);
      return json({ ok: false, status: "stopped", score, reason: "no_progress", autofix_run_id: run.id }, 200, origin);
    }

    if (score >= targetScore || passed) {
      await sb.from("autofix_runs").update({
        status: "succeeded",
        stop_reason: `Score ${score} >= target ${targetScore}`,
      }).eq("id", run.id);

      // Trigger auto_publish
      if (!dryRun) {
        await sb.from("course_package_build_steps")
          .update({ status: "pending", error_message: null, log: null })
          .eq("package_id", packageId).eq("step_key", "auto_publish");

        await sb.from("job_queue").insert({
          job_type: "package_auto_publish",
          status: "pending",
          payload: { package_id: packageId, course_id: courseId, curriculum_id: curriculumId, job_version: "auto_gap_close" },
          max_attempts: 3,
        });
      }

      return json({ ok: true, status: "succeeded", score, autofix_run_id: run.id }, 200, origin);
    }

    if (run.current_round + 1 > maxRounds) {
      await sb.from("autofix_runs").update({
        status: "stopped",
        stop_reason: `Max rounds reached (${maxRounds})`,
      }).eq("id", run.id);
      return json({ ok: false, status: "stopped", score, reason: "max_rounds", autofix_run_id: run.id }, 200, origin);
    }

    // 4) Build gap-close plan
    const plan = buildPlan(report as any, run.current_round + 1, curriculumId, courseId, packageId);

    await sb.from("autofix_runs").update({ last_plan: plan as any }).eq("id", run.id);

    if (dryRun) {
      return json({ ok: true, status: "dry_run", score, plan, autofix_run_id: run.id }, 200, origin);
    }

    // 5) Enqueue gap-closing jobs (with dedup)
    let enqueued = 0;
    for (const action of plan.actions) {
      // Dedup: check if same job_type is already queued/running for this package
      const { data: existing } = await sb.from("job_queue")
        .select("id")
        .eq("job_type", action.job_type)
        .in("status", ["pending", "processing"])
        .contains("payload", { package_id: packageId } as any)
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`[AutoGap] Skipping ${action.job_type} – already queued`);
        continue;
      }

      for (let i = 0; i < action.count; i++) {
        await sb.from("job_queue").insert({
          job_type: action.job_type,
          status: "pending",
          payload: {
            package_id: packageId,
            course_id: courseId,
            curriculum_id: curriculumId,
            job_version: "auto_gap_close",
            autofix_run_id: run.id,
            ...(action.payload_extra || {}),
          },
          max_attempts: 3,
        });
        enqueued++;
      }
    }

    // 6) Schedule self-check after workers finish (~3 min)
    const recheckAfter = new Date(Date.now() + 180_000).toISOString();
    await sb.from("job_queue").insert({
      job_type: "auto_gap_close",
      status: "pending",
      run_after: recheckAfter,
      payload: {
        package_id: packageId,
        course_id: courseId,
        curriculum_id: curriculumId,
        autofix_run_id: run.id,
        target_score: targetScore,
        max_rounds: maxRounds,
        budget_eur: budgetEur,
      },
      max_attempts: 1,
    });

    // Reset integrity check step for next round
    await sb.from("course_package_build_steps")
      .update({ status: "pending", error_message: null, log: null, started_at: null, finished_at: null })
      .eq("package_id", packageId).eq("step_key", "run_integrity_check");

    return json({
      ok: true,
      status: "running",
      score,
      round: run.current_round + 1,
      plan,
      enqueued,
      autofix_run_id: run.id,
      next_check: recheckAfter,
    }, 200, origin);

  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[AutoGapClose] Error:", msg);

    // Mark run as failed if we have an ID
    if (autofixRunId) {
      await sb.from("autofix_runs").update({
        status: "failed",
        stop_reason: msg.slice(0, 500),
      }).eq("id", autofixRunId).catch(() => {});
    }

    return json({ error: msg }, 500, origin);
  }
});

/**
 * Deterministic planner: translates integrity report deficits into concrete jobs.
 */
function buildPlan(
  report: any,
  round: number,
  curriculumId: string,
  courseId: string,
  packageId: string,
): GapPlan {
  const actions: GapPlan["actions"] = [];

  // Exam questions gap
  const examActual = report?.exam?.total || 0;
  const examTarget = report?.exam?.target || 1000;
  if (examActual < examTarget) {
    // Generate more exam questions via blueprint system
    // Each run of generate-blueprint-questions creates ~30-50 questions
    const missing = examTarget - examActual;
    const batchCount = Math.min(5, Math.ceil(missing / 50)); // max 5 batches per round
    actions.push({
      job_type: "package_generate_exam_pool",
      count: batchCount,
      scope: "per_curriculum",
      payload_extra: { step_key: "generate_exam_pool", batch_mode: true },
    });
  }

  // Oral exam gap
  const oralActual = report?.oral?.total || 0;
  const oralTarget = report?.oral?.target || 20;
  if (oralActual < oralTarget) {
    actions.push({
      job_type: "package_generate_oral_exam",
      count: 1,
      scope: "full",
      payload_extra: { step_key: "generate_oral_exam" },
    });
  }

  // Handbook gap
  const handbookActual = report?.handbook?.chapters || 0;
  const handbookTarget = report?.handbook?.target || 5;
  if (handbookActual < handbookTarget) {
    actions.push({
      job_type: "package_generate_handbook",
      count: 1,
      scope: "missing_only",
      payload_extra: { step_key: "generate_handbook", fill_gaps: true },
    });
  }

  // AI Tutor Index
  if (!report?.tutor_index) {
    actions.push({
      job_type: "package_build_ai_tutor_index",
      count: 1,
      scope: "full",
      payload_extra: { step_key: "build_ai_tutor_index" },
    });
  }

  return {
    round,
    actions,
    estimated_jobs: actions.reduce((sum, a) => sum + a.count, 0),
  };
}
