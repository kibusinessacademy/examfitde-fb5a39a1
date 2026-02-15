import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * pipeline-runner — Pure Orchestrator (v3: Multi-Slot Acquisition)
 *
 * The Runner NEVER executes steps directly. It only:
 * 1. Acquires package leases in a loop (up to max_concurrent_packages)
 * 2. Determines next step via state machine for each acquired package
 * 3. Enqueues worker jobs into job_queue
 * 4. Polls enqueued job status and propagates results
 *
 * KEY CHANGE in v3: Each invocation fills ALL available slots, not just one.
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

/** Maps step_key → job_type in job_queue */
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
    const result = await sb.rpc(fn, params);
    if (result.error) {
      console.warn(`[runner] RPC ${fn} returned error:`, result.error.message);
    }
    return result;
  } catch (e) {
    console.error(`[runner] RPC ${fn} threw:`, (e as Error).message);
    return { data: null, error: e };
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
  | null;

function pickNextAction(steps: StepRow[]): StepAction {
  const byKey = new Map<string, StepRow>();
  for (const s of steps) byKey.set(s.step_key, s);

  for (const k of STEP_ORDER) {
    const s = byKey.get(k);
    if (!s) continue;

    if (s.status === "done" || s.status === "skipped") continue;
    if (s.status === "blocked") continue;

    // Poll if step has a linked job (both enqueued and running steps)
    if ((s.status === "enqueued" || s.status === "running") && s.job_id) {
      return { action: "poll", stepKey: k, jobId: s.job_id };
    }

    if (s.status === "running") {
      const timeout = s.timeout_seconds || 600;
      if (s.started_at) {
        const elapsed = (Date.now() - new Date(s.started_at).getTime()) / 1000;
        if (elapsed > timeout) {
          return { action: "timed_out", stepKey: k };
        }
      }
      return null;
    }

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

// ══════════════════════════════════════════════════════════════
// Process a single acquired package — returns result summary
// ══════════════════════════════════════════════════════════════
async function processPackage(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  runnerId: string,
): Promise<Record<string, unknown>> {
  const shortId = packageId.slice(0, 8);

  // ── Load package metadata ──
  const { data: pkg, error: pkgErr } = await sb
    .from("course_packages")
    .select("id,pipeline_mode,course_id,curriculum_id,certification_id,feature_flags")
    .eq("id", packageId)
    .single();

  if (pkgErr || !pkg) {
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, error: pkgErr?.message ?? "package not found" };
  }

  // ── Auto-resolve missing curriculum_id ──
  if (!pkg.curriculum_id && pkg.course_id) {
    const { data: course } = await sb
      .from("courses")
      .select("curriculum_id")
      .eq("id", pkg.course_id)
      .single();

    if (course?.curriculum_id) {
      await safeQuery(
        sb.from("course_packages").update({ curriculum_id: course.curriculum_id }).eq("id", packageId),
      );
      pkg.curriculum_id = course.curriculum_id;
      console.log(`[runner] Auto-resolved curriculum_id for ${shortId}`);
    }
  }

  // ── Block if missing required IDs ──
  if (!pkg.curriculum_id || !pkg.course_id) {
    await safeQuery(
      sb.from("course_packages")
        .update({ status: "blocked", blocked_reason: "missing_curriculum_or_course_id" })
        .eq("id", packageId),
    );
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, blocked: true, reason: "missing_curriculum_or_course_id" };
  }

  const mode = (pkg.pipeline_mode ?? "factory") as "factory" | "production";

  // ── Load steps & determine next action ──
  const { data: steps, error: stepsErr } = await sb
    .from("package_steps")
    .select("step_key,status,attempts,max_attempts,timeout_seconds,started_at,meta,job_id")
    .eq("package_id", packageId);

  if (stepsErr) {
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, error: stepsErr.message };
  }

  // ── Bootstrap: If no steps exist, invoke build-course-package to create them ──
  if (!steps || steps.length === 0) {
    console.log(`[runner] Package ${shortId} has no steps — invoking build-course-package to bootstrap`);
    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      // Ensure pipeline lock is held by this package before build-course-package checks it
      await safeRpc(sb, "try_claim_pipeline_lock", { p_package_id: packageId, p_locked_by: runnerId });

      const buildRes = await fetch(`${SUPABASE_URL}/functions/v1/build-course-package`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          packageId,
          courseId: pkg.course_id,
          curriculumId: pkg.curriculum_id,
          certificationId: pkg.certification_id,
        }),
      });

      const buildData = await buildRes.json().catch(() => ({}));

      if (!buildRes.ok) {
        console.error(`[runner] build-course-package failed for ${shortId}: ${JSON.stringify(buildData)}`);
        await safeQuery(
          sb.from("course_packages")
            .update({ status: "blocked", blocked_reason: `build_init_failed: ${buildData.error || buildRes.status}` })
            .eq("id", packageId),
        );
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, error: "build_init_failed", detail: buildData };
      }

      console.log(`[runner] ✅ build-course-package bootstrapped ${shortId}: enqueued=${buildData.enqueued}`);
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, bootstrapped: true, enqueued: buildData.enqueued };
    } catch (buildErr) {
      console.error(`[runner] Bootstrap error for ${shortId}:`, (buildErr as Error).message);
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, error: `bootstrap_error: ${(buildErr as Error).message}` };
    }
  }

  const nextAction = pickNextAction((steps ?? []) as StepRow[]);

  // ── All steps done / no actionable step ──
  if (!nextAction) {
    const statuses = (steps ?? []).map((s: StepRow) => s.status);
    const allDone = statuses.length > 0 && statuses.every((s: string) => s === "done" || s === "skipped");

    if (allDone) {
      await safeQuery(sb.from("course_packages").update({ status: "done" }).eq("id", packageId));
      console.log(`[runner] Package ${shortId} → done`);
    } else {
      const hasEnqueued = statuses.includes("enqueued");
      if (!hasEnqueued) {
        await safeQuery(
          sb.from("course_packages")
            .update({ status: "blocked", blocked_reason: "no_runnable_steps" })
            .eq("id", packageId),
        );
      }
    }

    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, finished: statuses.every((s: string) => s === "done" || s === "skipped") };
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
        message: `STEP_EXHAUSTED: ${nextAction.stepKey} pkg ${shortId}`,
        payload: { packageId, stepKey: nextAction.stepKey },
      }),
    );
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, stepKey: nextAction.stepKey, exhausted: true };
  }

  // ── Handle: step timed out ──
  if (nextAction.action === "timed_out") {
    console.warn(`[runner] Step ${nextAction.stepKey} timed out for ${shortId}`);
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
    return { packageId, stepKey: nextAction.stepKey, timeout_reset: true };
  }

  // ── POLL: Check status of an enqueued worker job ──
  if (nextAction.action === "poll") {
    const { stepKey, jobId } = nextAction;
    console.log(`[runner] Polling job ${jobId.slice(0, 8)} for step ${stepKey} (pkg ${shortId})`);

    const { data: job } = await sb
      .from("job_queue")
      .select("status,result,error,last_error,batch_cursor")
      .eq("id", jobId)
      .single();

    if (!job) {
      console.warn(`[runner] Job ${jobId.slice(0, 8)} not found — resetting step`);
      await safeQuery(
        sb.from("package_steps")
          .update({ status: "queued", job_id: null, runner_id: null })
          .eq("package_id", packageId)
          .eq("step_key", stepKey),
      );
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, job_reset: true };
    }

    // Job still pending/processing → keep lease + send step heartbeat
    if (job.status === "pending" || job.status === "processing") {
      await safeRpc(sb, "renew_package_lease", {
        p_package_id: packageId,
        p_runner_id: runnerId,
        p_lease_seconds: 600,
      });
      // Fix B: Send step heartbeat to prevent false timeout by expire_stale_steps()
      await safeRpc(sb, "step_heartbeat", {
        p_package_id: packageId,
        p_step_key: stepKey,
      });
      return { packageId, stepKey, waiting: true, jobStatus: job.status };
    }

    // Job completed
    if (job.status === "completed") {
      const result = (job.result ?? {}) as Record<string, unknown>;

      // Check if step is already marked done (idempotency guard against re-polling)
      const currentStep = (steps ?? []).find((s: StepRow) => s.step_key === stepKey);
      if (currentStep?.status === "done") {
        console.log(`[runner] Step ${stepKey} already done for ${shortId} — skipping redundant step_done`);
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, stepKey, already_done: true };
      }

      if (result.batch_complete === false && result.batch_cursor) {
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
        return { packageId, stepKey, batch_continue: true };
      }

      await sb.rpc("step_done", {
        p_package_id: packageId,
        p_step_key: stepKey,
        p_meta: result,
      });

      const doneCount = (steps ?? []).filter(
        (s: StepRow) => s.status === "done" || s.status === "skipped",
      ).length + 1;
      const progress = Math.round((doneCount / STEP_ORDER.length) * 100);
      await safeQuery(
        sb.from("course_packages").update({ build_progress: progress }).eq("id", packageId),
      );

      if (stepKey === "auto_publish") {
        await safeQuery(
          sb.from("course_packages").update({ status: "done" }).eq("id", packageId),
        );
      }

      // Clear the job_id from the step so the next runner invocation doesn't re-poll the same completed job
      await safeQuery(
        sb.from("package_steps")
          .update({ job_id: null })
          .eq("package_id", packageId)
          .eq("step_key", stepKey),
      );

      console.log(`[runner] ✅ Step ${stepKey} done for ${shortId} (progress ${progress}%)`);
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, mode, progress };
    }

    // Job failed
    if (job.status === "failed") {
      const errorMsg = job.last_error || job.error || "Worker job failed";
      console.error(`[runner] ❌ Step ${stepKey} job failed: ${errorMsg}`);

      await safeRpc(sb, "step_fail", {
        p_package_id: packageId,
        p_step_key: stepKey,
        p_error: errorMsg,
      });

      await safeQuery(
        sb.from("package_steps")
          .update({ job_id: null })
          .eq("package_id", packageId)
          .eq("step_key", stepKey),
      );

      await safeQuery(
        sb.from("course_packages")
          .update({ status: "building", last_error: `Step ${stepKey}: ${errorMsg.slice(0, 250)}` })
          .eq("id", packageId),
      );

      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, job_failed: true, error: errorMsg };
    }

    // Unknown job status
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, stepKey, jobStatus: job.status };
  }

  // ── ENQUEUE: Create a worker job ──
  if (nextAction.action === "enqueue") {
    const stepKey = nextAction.stepKey;
    const jobType = STEP_TO_JOB_TYPE[stepKey];
    const stepMeta = (steps ?? []).find((s: StepRow) => s.step_key === stepKey)?.meta;
    const batchCursor = (stepMeta?.batch_cursor as Record<string, unknown>) ?? null;

    console.log(`[runner] Enqueuing ${jobType} for step ${stepKey} (pkg ${shortId})`);

    const payload: Record<string, unknown> = {
      package_id: packageId,
      course_id: pkg.course_id,
      curriculum_id: pkg.curriculum_id,
      certification_id: pkg.certification_id,
      mode,
      feature_flags: pkg.feature_flags ?? {},
    };
    if (batchCursor) payload.batch_cursor = batchCursor;

    const jobId = crypto.randomUUID();
    const { error: insertErr } = await sb.from("job_queue").insert({
      id: jobId,
      job_type: jobType,
      status: "pending",
      payload,
      priority: 10,
      max_attempts: 25,
      batch_cursor: batchCursor,
    });

    if (insertErr) {
      if (insertErr.message?.includes("duplicate") || insertErr.message?.includes("unique")) {
        console.warn(`[runner] Job already enqueued for ${stepKey} — skipping`);
        const { data: existingJob } = await sb
          .from("job_queue")
          .select("id")
          .eq("job_type", jobType)
          .in("status", ["pending", "processing"])
          .contains("payload", { package_id: packageId })
          .limit(1)
          .maybeSingle();

        if (existingJob) {
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
        return { packageId, error: insertErr.message };
      }
    } else {
      await safeQuery(
        sb.from("package_steps")
          .update({ status: "enqueued", job_id: jobId, runner_id: runnerId })
          .eq("package_id", packageId)
          .eq("step_key", stepKey),
      );
    }

    // Fix D: Log step_start errors instead of swallowing them
    const startResult = await safeRpc(sb, "step_start", {
      p_package_id: packageId,
      p_step_key: stepKey,
      p_runner_id: runnerId,
    });
    if (startResult.error) {
      console.error(`[runner] step_start failed for ${stepKey} pkg ${shortId}:`, (startResult.error as Error)?.message ?? startResult.error);
    }

    // Keep lease — slot stays occupied
    console.log(`[runner] 📤 Enqueued ${jobType} (job ${jobId.slice(0, 8)}) for ${shortId}`);
    return { packageId, stepKey, enqueued: true, jobId };
  }

  // Fallback
  await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
  return { packageId, noop: true };
}

// ══════════════════════════════════════════════════════════════
// MAIN: Multi-Slot Acquisition Loop
// ══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Read max slots from config
  const { data: configRow } = await sb
    .from("ops_pipeline_config")
    .select("value")
    .eq("key", "max_concurrent_packages")
    .maybeSingle();
  // Fix C: No fallback mismatch — if config missing, default to 3 (matches DB seed)
  const maxSlots = parseInt(configRow?.value ?? "3", 10);

  const results: Record<string, unknown>[] = [];
  const processedPackageIds = new Set<string>();

  try {
    // Loop: try to acquire up to maxSlots packages
    for (let slot = 0; slot < maxSlots; slot++) {
      const runnerId = `runner_${crypto.randomUUID().slice(0, 8)}`;

      const { data: pkgId, error: acquireErr } = await sb.rpc(
        "acquire_next_package_lease",
        { p_runner_id: runnerId, p_lease_seconds: 600 },
      );

      if (acquireErr) {
        console.error(`[runner] acquire error on slot ${slot}:`, acquireErr.message);
        break;
      }

      if (!pkgId) {
        console.log(`[runner] No more packages available after ${slot} acquisitions`);
        break;
      }

      const packageId = String(pkgId);

      // ── DEDUP: Skip if already processed in this invocation ──
      if (processedPackageIds.has(packageId)) {
        console.warn(`[runner] Slot ${slot + 1}: package ${packageId.slice(0, 8)} already processed this invocation — releasing duplicate lease`);
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        continue;
      }
      processedPackageIds.add(packageId);

      console.log(`[runner] Acquired slot ${slot + 1}/${maxSlots}: package ${packageId.slice(0, 8)}`);

      const result = await processPackage(sb, packageId, runnerId);
      results.push({ slot: slot + 1, ...result });
    }

    if (results.length === 0) {
      return json({ ok: true, idle: true, reason: "no_claimable_packages_or_slots_full" });
    }

    console.log(`[runner] Processed ${results.length} package(s) in this invocation`);
    return json({ ok: true, processed: results.length, results });

  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[runner] Fatal:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
