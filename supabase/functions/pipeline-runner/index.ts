import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * pipeline-runner — Pure Orchestrator (v2: Runner ↔ Worker Marriage)
 *
 * The Runner NEVER executes steps directly. It only:
 * 1. Acquires package lease (slots/concurrency)
 * 2. Determines next step via state machine
 * 3. Enqueues a worker job into job_queue
 * 4. Polls enqueued job status and propagates results
 *
 * All "real work" (LLM, H5P, DB writes) flows through the job-runner/worker,
 * which provides governance: budget, provider autopilot, retry/backoff, cost tracking.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Step ordering ──
type StepKey =
  | "scaffold_learning_course"
  | "auto_seed_exam_blueprints"
  | "generate_exam_pool"
  | "generate_oral_exam"
  | "build_ai_tutor_index"
  | "generate_handbook"
  | "run_integrity_check"
  | "quality_council"
  | "auto_publish";

const STEP_ORDER: StepKey[] = [
  "scaffold_learning_course",
  "auto_seed_exam_blueprints",
  "generate_exam_pool",
  "generate_oral_exam",
  "build_ai_tutor_index",
  "generate_handbook",
  "run_integrity_check",
  "quality_council",
  "auto_publish",
];

/** Maps step_key → job_type in job_queue (matches job-runner's JOB_TYPE_MAP) */
const STEP_TO_JOB_TYPE: Record<StepKey, string> = {
  scaffold_learning_course: "package_scaffold_learning_course",
  auto_seed_exam_blueprints: "package_auto_seed_exam_blueprints",
  generate_exam_pool: "package_generate_exam_pool",
  generate_oral_exam: "package_generate_oral_exam",
  build_ai_tutor_index: "package_build_ai_tutor_index",
  generate_handbook: "package_generate_handbook",
  run_integrity_check: "package_run_integrity_check",
  quality_council: "package_quality_council",
  auto_publish: "package_auto_publish",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function safeRpc(
  sb: ReturnType<typeof createClient>,
  fn: string,
  params: Record<string, unknown>,
) {
  try {
    return await sb.rpc(fn, params);
  } catch (_) {
    return { data: null, error: _ };
  }
}

async function safeQuery(promise: PromiseLike<unknown>) {
  try {
    return await promise;
  } catch (_) {
    return null;
  }
}

interface StepRow {
  step_key: string;
  status: string;
  attempts: number;
  max_attempts: number;
  timeout_seconds?: number;
  started_at?: string;
  meta?: Record<string, unknown> | null;
  job_id?: string | null;
}

// ── State machine: pick next actionable step ──
type StepAction =
  | { action: "enqueue"; stepKey: StepKey }
  | { action: "poll"; stepKey: StepKey; jobId: string }
  | { action: "exhausted"; stepKey: StepKey }
  | { action: "timed_out"; stepKey: StepKey }
  | null; // all done or blocked

function pickNextAction(steps: StepRow[]): StepAction {
  const byKey = new Map<string, StepRow>();
  for (const s of steps) byKey.set(s.step_key, s);

  for (const k of STEP_ORDER) {
    const s = byKey.get(k);
    if (!s) continue;

    if (s.status === "done" || s.status === "skipped") continue;
    if (s.status === "blocked") continue;

    // Step is enqueued → poll the worker job
    if (s.status === "enqueued" && s.job_id) {
      return { action: "poll", stepKey: k, jobId: s.job_id };
    }

    // Step is running (legacy / edge case) → check timeout
    if (s.status === "running") {
      const timeout = s.timeout_seconds || 600;
      if (s.started_at) {
        const elapsed = (Date.now() - new Date(s.started_at).getTime()) / 1000;
        if (elapsed > timeout) {
          return { action: "timed_out", stepKey: k };
        }
      }
      // Still running, don't interfere
      return null;
    }

    // Retryable states
    const retryable = s.status === "queued" || s.status === "failed" || s.status === "timeout";
    if (retryable && s.attempts < s.max_attempts) {
      return { action: "enqueue", stepKey: k };
    }
    if (retryable && s.attempts >= s.max_attempts) {
      return { action: "exhausted", stepKey: k };
    }
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const runnerId = `runner_${crypto.randomUUID().slice(0, 8)}`;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // ── 1) Acquire lease (atomic: purge expired + claim queued/orphaned) ──
    const { data: pkgId, error: acquireErr } = await sb.rpc(
      "acquire_next_package_lease",
      { p_runner_id: runnerId, p_lease_seconds: 600 },
    );

    if (acquireErr) {
      console.error("[runner] acquire error:", acquireErr.message);
      return json({ ok: false, error: acquireErr.message }, 500);
    }

    if (!pkgId) {
      return json({ ok: true, idle: true, reason: "no_claimable_packages_or_slots_full" });
    }

    const packageId = String(pkgId);
    console.log(`[runner] Acquired lease for package ${packageId.slice(0, 8)}`);

    // ── 2) Load package metadata ──
    const { data: pkg, error: pkgErr } = await sb
      .from("course_packages")
      .select("id,pipeline_mode,course_id,curriculum_id,certification_id,feature_flags")
      .eq("id", packageId)
      .single();

    if (pkgErr || !pkg) {
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return json({ ok: false, error: pkgErr?.message ?? "package not found" }, 500);
    }

    // ── Auto-resolve missing curriculum_id from course ──
    if (!pkg.curriculum_id && pkg.course_id) {
      const { data: course } = await sb
        .from("courses")
        .select("curriculum_id")
        .eq("id", pkg.course_id)
        .single();

      if (course?.curriculum_id) {
        await safeQuery(
          sb.from("course_packages")
            .update({ curriculum_id: course.curriculum_id })
            .eq("id", packageId),
        );
        pkg.curriculum_id = course.curriculum_id;
        console.log(`[runner] Auto-resolved curriculum_id for ${packageId.slice(0, 8)}`);
      }
    }

    // ── Block if still missing required IDs ──
    if (!pkg.curriculum_id || !pkg.course_id) {
      await safeQuery(
        sb.from("course_packages")
          .update({ status: "blocked", blocked_reason: "missing_curriculum_or_course_id" })
          .eq("id", packageId),
      );
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return json({ ok: true, packageId, blocked: true, reason: "missing_curriculum_or_course_id" });
    }

    const mode = (pkg.pipeline_mode ?? "factory") as "factory" | "production";

    // ── 3) Load steps & determine next action ──
    const { data: steps, error: stepsErr } = await sb
      .from("package_steps")
      .select("step_key,status,attempts,max_attempts,timeout_seconds,started_at,meta,job_id")
      .eq("package_id", packageId);

    if (stepsErr) {
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return json({ ok: false, error: stepsErr.message }, 500);
    }

    const nextAction = pickNextAction((steps ?? []) as StepRow[]);

    // ── All steps done / no actionable step ──
    if (!nextAction) {
      const statuses = (steps ?? []).map((s: StepRow) => s.status);
      const allDone = statuses.length > 0 && statuses.every((s: string) => s === "done" || s === "skipped");

      if (allDone) {
        await safeQuery(sb.from("course_packages").update({ status: "done" }).eq("id", packageId));
        console.log(`[runner] Package ${packageId.slice(0, 8)} → done`);
      } else {
        // Check if there's an enqueued step without a job_id (shouldn't happen, but safety)
        const hasEnqueued = statuses.includes("enqueued");
        if (!hasEnqueued) {
          await safeQuery(
            sb.from("course_packages")
              .update({ status: "blocked", blocked_reason: "no_runnable_steps" })
              .eq("id", packageId),
          );
        }
        // If enqueued, just wait — job-runner will process it
      }

      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return json({ ok: true, packageId, finished: statuses.every((s: string) => s === "done" || s === "skipped") });
    }

    // ── Handle: exhausted retries ──
    if (nextAction.action === "exhausted") {
      await safeQuery(
        sb.from("course_packages")
          .update({ status: "failed", last_error: `Attempts exhausted on step ${nextAction.stepKey}` })
          .eq("id", packageId),
      );
      await safeQuery(
        sb.from("ops_alerts").insert({
          source: "pipeline-runner",
          severity: "error",
          message: `STEP_EXHAUSTED: ${nextAction.stepKey} pkg ${packageId.slice(0, 8)}`,
          payload: { packageId, stepKey: nextAction.stepKey },
        }),
      );
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return json({ ok: true, packageId, stepKey: nextAction.stepKey, exhausted: true });
    }

    // ── Handle: step timed out → reset to failed for retry ──
    if (nextAction.action === "timed_out") {
      console.warn(`[runner] Step ${nextAction.stepKey} timed out for ${packageId.slice(0, 8)}`);
      await safeRpc(sb, "step_fail", {
        p_package_id: packageId,
        p_step_key: nextAction.stepKey,
        p_error: "STEP_TIMEOUT",
      });
      await safeQuery(
        sb.from("course_packages")
          .update({ status: "building", last_error: `Step ${nextAction.stepKey}: TIMEOUT` })
          .eq("id", packageId),
      );
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return json({ ok: true, packageId, stepKey: nextAction.stepKey, timeout_reset: true });
    }

    // ══════════════════════════════════════════════════════════════
    // ACTION: POLL — Check status of an enqueued worker job
    // ══════════════════════════════════════════════════════════════
    if (nextAction.action === "poll") {
      const { stepKey, jobId } = nextAction;
      console.log(`[runner] Polling job ${jobId.slice(0, 8)} for step ${stepKey}`);

      const { data: job } = await sb
        .from("job_queue")
        .select("status,result,error,last_error,batch_cursor")
        .eq("id", jobId)
        .single();

      if (!job) {
        // Job disappeared — reset step to queued for re-enqueue
        console.warn(`[runner] Job ${jobId.slice(0, 8)} not found — resetting step`);
        await safeQuery(
          sb.from("package_steps")
            .update({ status: "queued", job_id: null, runner_id: null })
            .eq("package_id", packageId)
            .eq("step_key", stepKey),
        );
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return json({ ok: true, packageId, stepKey, job_reset: true });
      }

      // ── Job still pending or processing → keep lease (don't release!) ──
      if (job.status === "pending" || job.status === "processing") {
        // Renew lease so package doesn't get orphaned while job runs
        // IMPORTANT: Do NOT release the lease here — keeping it ensures
        // the next runner invocation picks a DIFFERENT package to fill another slot.
        await safeRpc(sb, "renew_package_lease", {
          p_package_id: packageId,
          p_runner_id: runnerId,
          p_lease_seconds: 600,
        });
        return json({ ok: true, packageId, stepKey, waiting: true, jobStatus: job.status });
      }

      // ── Job completed successfully ──
      if (job.status === "completed") {
        const result = (job.result ?? {}) as Record<string, unknown>;

        // Handle batch continuation
        if (result.batch_complete === false && result.batch_cursor) {
          // Re-enqueue: reset step to queued so next tick creates a new job
          await safeQuery(
            sb.from("package_steps")
              .update({
                status: "queued",
                job_id: null,
                runner_id: null,
                meta: { batch_cursor: result.batch_cursor },
              })
              .eq("package_id", packageId)
              .eq("step_key", stepKey),
          );
          console.log(`[runner] 🔄 Step ${stepKey} batch incomplete — re-queued`);
          await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
          return json({ ok: true, packageId, stepKey, batch_continue: true });
        }

        // Step done!
        await sb.rpc("step_done", {
          p_package_id: packageId,
          p_step_key: stepKey,
          p_meta: result,
        });

        // Update build_progress
        const doneCount = (steps ?? []).filter(
          (s: StepRow) => s.status === "done" || s.status === "skipped",
        ).length + 1;
        const progress = Math.round((doneCount / STEP_ORDER.length) * 100);
        await safeQuery(
          sb.from("course_packages")
            .update({ build_progress: progress })
            .eq("id", packageId),
        );

        // If last step → package done
        if (stepKey === "auto_publish") {
          await safeQuery(
            sb.from("course_packages")
              .update({ status: "done" })
              .eq("id", packageId),
          );
        }

        console.log(`[runner] ✅ Step ${stepKey} done for ${packageId.slice(0, 8)} (progress ${progress}%)`);
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return json({ ok: true, packageId, stepKey, mode, progress });
      }

      // ── Job failed ──
      if (job.status === "failed") {
        const errorMsg = job.last_error || job.error || "Worker job failed";
        console.error(`[runner] ❌ Step ${stepKey} job failed: ${errorMsg}`);

        await safeRpc(sb, "step_fail", {
          p_package_id: packageId,
          p_step_key: stepKey,
          p_error: errorMsg,
        });

        // Clear job_id so it can be re-enqueued on retry
        await safeQuery(
          sb.from("package_steps")
            .update({ job_id: null })
            .eq("package_id", packageId)
            .eq("step_key", stepKey),
        );

        // Keep package building for retry
        await safeQuery(
          sb.from("course_packages")
            .update({ status: "building", last_error: `Step ${stepKey}: ${errorMsg.slice(0, 250)}` })
            .eq("id", packageId),
        );

        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return json({ ok: true, packageId, stepKey, job_failed: true, error: errorMsg });
      }

      // Unknown job status — release and wait
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return json({ ok: true, packageId, stepKey, jobStatus: job.status });
    }

    // ══════════════════════════════════════════════════════════════
    // ACTION: ENQUEUE — Create a worker job in job_queue
    // ══════════════════════════════════════════════════════════════
    if (nextAction.action === "enqueue") {
      const stepKey = nextAction.stepKey;
      const jobType = STEP_TO_JOB_TYPE[stepKey];
      const stepMeta = (steps ?? []).find((s: StepRow) => s.step_key === stepKey)?.meta;
      const batchCursor = (stepMeta?.batch_cursor as Record<string, unknown>) ?? null;

      console.log(`[runner] Enqueuing job ${jobType} for step ${stepKey} (pkg ${packageId.slice(0, 8)})`);

      // Build payload — top-level fields required by job_queue SSOT triggers
      const payload: Record<string, unknown> = {
        package_id: packageId,
        course_id: pkg.course_id,
        curriculum_id: pkg.curriculum_id,
        certification_id: pkg.certification_id,
        mode,
        feature_flags: pkg.feature_flags ?? {},
      };
      if (batchCursor) {
        payload.batch_cursor = batchCursor;
      }

      // Insert job with idempotency (partial unique index prevents duplicates)
      const jobId = crypto.randomUUID();
      const { error: insertErr } = await sb.from("job_queue").insert({
        id: jobId,
        job_type: jobType,
        status: "pending",
        payload,
        priority: 10, // Pipeline steps get high priority
        max_attempts: 25, // Worker handles retries via triage policy
        batch_cursor: batchCursor,
      });

      if (insertErr) {
        // Likely idempotency violation → job already exists
        if (insertErr.message?.includes("duplicate") || insertErr.message?.includes("unique")) {
          console.warn(`[runner] Job already enqueued for ${stepKey} — skipping`);
          // Find the existing job
          const { data: existingJob } = await sb
            .from("job_queue")
            .select("id")
            .eq("job_type", jobType)
            .in("status", ["pending", "processing"])
            .contains("payload", { package_id: packageId })
            .limit(1)
            .maybeSingle();

          if (existingJob) {
            // Update step with existing job_id
            await safeQuery(
              sb.from("package_steps")
                .update({ status: "enqueued", job_id: existingJob.id, runner_id: runnerId })
                .eq("package_id", packageId)
                .eq("step_key", stepKey),
            );
          }
        } else {
          console.error(`[runner] Failed to enqueue job: ${insertErr.message}`);
          await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
          return json({ ok: false, error: insertErr.message }, 500);
        }
      } else {
        // Job created — update step to enqueued with job_id
        await safeQuery(
          sb.from("package_steps")
            .update({ status: "enqueued", job_id: jobId, runner_id: runnerId })
            .eq("package_id", packageId)
            .eq("step_key", stepKey),
        );
      }

      // Mark step as started (for heartbeat tracking)
      try {
        await sb.rpc("step_start", {
          p_package_id: packageId,
          p_step_key: stepKey,
          p_runner_id: runnerId,
        });
      } catch { /* ignore if RPC doesn't exist yet */ }

      // Keep lease after enqueue — job is now pending/processing, lease protects the slot
      console.log(`[runner] 📤 Enqueued ${jobType} (job ${jobId.slice(0, 8)}) for ${packageId.slice(0, 8)}`);
      return json({ ok: true, packageId, stepKey, enqueued: true, jobId });
    }

    // Fallback (shouldn't reach here)
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return json({ ok: true, packageId, noop: true });

  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[runner] Fatal:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
