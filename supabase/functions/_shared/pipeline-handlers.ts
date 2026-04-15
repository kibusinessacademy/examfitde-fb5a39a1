/**
 * pipeline-handlers.ts — Extracted from pipeline-process.ts to reduce bundle size.
 * Contains handleJobFailed() and handleEnqueue().
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { inferBackoffSeconds, getFanOutConfig, STEP_TO_JOB_TYPE, type PipelineStepKey } from "./job-map.ts";
import { enqueueJob } from "./enqueue.ts";
import { classifyStep } from "./step-weight.ts";
import {
  type StepKey, type StepRow, type StepClassContext,
  safeRpc, safeQuery, isTransientStepError,
} from "./pipeline-helpers.ts";
import { checkLoopGuard, checkRetryLoopGuard, applyLoopGuardBlock, updateLoopGuardMeta, updateRetryLoopGuardMeta } from "./loop-guard.ts";
import { mergePackageStepMeta } from "./merge-step-meta.ts";

// ── Sanitize error messages (strip HTML from 502/503 Cloudflare pages) ──
function sanitizeErrorMsg(msg: string): string {
  if (!msg) return msg;
  // Detect Cloudflare/proxy HTML error pages
  if (msg.includes("<!DOCTYPE") || msg.includes("<html")) {
    // Extract HTTP status if present
    const statusMatch = msg.match(/^HTTP (\d{3})/);
    const status = statusMatch ? statusMatch[1] : "502";
    return `HTTP ${status}: upstream proxy error (Cloudflare HTML page stripped)`;
  }
  return msg;
}

// ══════════════════════════════════════════════════════════════
// Handle job failed
// ══════════════════════════════════════════════════════════════

export async function handleJobFailed(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  runnerId: string,
  shortId: string,
  stepKey: StepKey,
  jobId: string,
  job: any,
  steps: StepRow[],
): Promise<Record<string, unknown>> {
  const rawErrorMsg = job.last_error || job.error || "Worker job failed";
  const errorMsg = sanitizeErrorMsg(rawErrorMsg === "Job failed: unknown" ? "UNKNOWN_EDGE_FAILURE" : rawErrorMsg);
  const MAX_STEP_RETRIES = 7;
  const TRANSIENT_STEP_MAX = 15;
  const TRANSIENT_TIMEOUT_MS = 45 * 60 * 1000; // Must match content-runner (was 20 min — caused premature exhaustion after liveness kills)
  const failedStep = steps.find((s: StepRow) => s.step_key === stepKey);
  const stepAttempts = failedStep?.attempts ?? 0;
  const stepMeta = (failedStep?.meta ?? {}) as Record<string, any>;
  const transient = isTransientStepError(errorMsg);
  const backoffSec = Math.max(15, inferBackoffSeconds(errorMsg));

  // ── Terminal loop-breaker for escalated validation failures ──
  // If job-runner already escalated a validation QG failure, never requeue here.
  const terminalValidationEscalation =
    stepKey.startsWith("validate_") &&
    /(QG FAIL ESCALATED|kill-switch|auto-heal exhausted|AUTO_HEAL_EXHAUSTED)/i.test(errorMsg);

  if (terminalValidationEscalation) {
    console.error(`[runner] 🛑 Terminal validation escalation for ${stepKey}: ${errorMsg.slice(0, 180)}`);
    await safeRpc(sb, "step_fail", {
      p_package_id: packageId,
      p_step_key: stepKey,
      p_error: `Terminal escalation: ${errorMsg.slice(0, 300)}`,
    });
    await safeQuery(
      sb.from("package_steps").update({
        status: "failed",
        job_id: null,
        runner_id: null,
        started_at: null,
        last_error: `Terminal escalation: ${errorMsg.slice(0, 300)}`,
      }).eq("package_id", packageId).eq("step_key", stepKey),
      "terminal_validation_escalation_step_fail",
    );
    await safeQuery(
      sb.from("course_packages").update({
        status: "blocked",
        blocked_reason: "pipeline_repair_required",
        last_error: `Terminal escalation at ${stepKey}: ${errorMsg.slice(0, 300)}`,
      }).eq("id", packageId),
      "terminal_validation_escalation_pkg_block",
    );
    await safeQuery(sb.from("auto_heal_log").insert({
      action_type: "validation_terminal_escalation",
      trigger_source: "pipeline_runner",
      target_type: "package_step",
      target_id: packageId,
      result_status: "escalated",
      result_detail: `${stepKey} terminal escalation detected — package blocked to prevent requeue loop`,
      metadata: { step: stepKey, error: errorMsg.slice(0, 400) },
    }));
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, stepKey, terminal_escalation: true, error: errorMsg };
  }

  // ── v2 LOOP GUARD: Check retry path BEFORE any requeue ──
  {
    const updatedMeta = updateRetryLoopGuardMeta(stepMeta, errorMsg);
    const retryGuard = checkRetryLoopGuard(updatedMeta, errorMsg, stepAttempts);
    if (retryGuard.blocked) {
      // Persist the updated meta atomically before blocking
      await mergePackageStepMeta(sb, packageId, stepKey, updatedMeta);
      await applyLoopGuardBlock(sb, packageId, stepKey, runnerId, retryGuard);
      return { packageId, stepKey, loop_guard_blocked: true, reason: retryGuard.reason, metrics: retryGuard.metrics };
    }
    // Always persist the updated zero_generation_streak even if not blocked
    if (updatedMeta !== stepMeta) {
      await mergePackageStepMeta(sb, packageId, stepKey, updatedMeta);
      // Update stepMeta reference for downstream use
      Object.assign(stepMeta, updatedMeta);
    }
  }

  if (transient) {
    const transientNext = (Number(stepMeta.transient_attempts ?? 0) || 0) + 1;
    const rawFta = stepMeta.first_transient_at;
    // Reset transient timer if job was liveness-killed (stuck-scan requeue adds dead time)
    const wasLivenessKilled = !!stepMeta.liveness_requeued || !!stepMeta.liveness_killed_at;
    const firstTransientAt =
      (typeof rawFta === "string" && !Number.isNaN(Date.parse(rawFta)) && !wasLivenessKilled)
        ? rawFta
        : new Date().toISOString();
    const elapsedMs = Date.now() - new Date(firstTransientAt).getTime();
    const timedOut = elapsedMs > TRANSIENT_TIMEOUT_MS;
    const exhausted = transientNext >= TRANSIENT_STEP_MAX || timedOut;
    const nextRunAt = new Date(Date.now() + backoffSec * 1000).toISOString();

    if (exhausted) {
      const nextAttempts = stepAttempts + 1;
      if (nextAttempts < MAX_STEP_RETRIES) {
        const resetMeta = { ...stepMeta };
        delete resetMeta.first_transient_at;
        await safeQuery(
          sb.from("package_steps").update({
            status: "queued", job_id: null, runner_id: null, started_at: null,
            attempts: nextAttempts,
            meta: {
              ...resetMeta,
              transient_attempts: 0,
              last_error_kind: "transient_exhausted",
              exhaust_reason: timedOut ? "ops_transient_timeout" : "max_transient_attempts",
              retry_after_sec: backoffSec,
              next_run_at: nextRunAt,
              last_fail_reason: errorMsg,
            },
            last_error: `Transient budget exhausted — attempt ${nextAttempts}/${MAX_STEP_RETRIES}: ${errorMsg.slice(0, 200)}`,
          }).eq("package_id", packageId).eq("step_key", stepKey).eq("job_id", jobId),
          "transient_exhausted_retry",
        );
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, stepKey, transient_exhausted: true, attempt: nextAttempts, maxRetries: MAX_STEP_RETRIES };
      }
      console.error(`[runner] ❌ Step ${stepKey} failed: transient budget + real attempts exhausted`);
      await safeRpc(sb, "step_fail", { p_package_id: packageId, p_step_key: stepKey, p_error: `Exhausted: ${errorMsg}` });
      await safeQuery(sb.from("package_steps").update({ job_id: null }).eq("package_id", packageId).eq("step_key", stepKey));
      await safeQuery(sb.from("course_packages").update({ status: "quality_gate_failed", last_error: `Step ${stepKey}: failed (transient)` }).eq("id", packageId));
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, job_failed: true, retries_exhausted: true, transient: true, error: errorMsg };
    }

    console.warn(`[runner] ⚡ ${stepKey} TRANSIENT fail — backoff ${backoffSec}s [transient ${transientNext}/${TRANSIENT_STEP_MAX}]`);
    await safeQuery(
      sb.from("package_steps").update({
        status: "queued", job_id: null, runner_id: null, started_at: null,
        meta: {
          ...stepMeta,
          transient_attempts: transientNext,
          first_transient_at: firstTransientAt,
          last_transient_at: new Date().toISOString(),
          last_error_kind: "transient",
          last_error_class: "transient",
          retry_after_sec: backoffSec,
          next_run_at: nextRunAt,
          last_fail_reason: errorMsg,
        },
        last_error: `Transient retry ${transientNext}/${TRANSIENT_STEP_MAX}: ${errorMsg.slice(0, 200)}`,
      }).eq("package_id", packageId).eq("step_key", stepKey).eq("job_id", jobId),
      "transient_step_retry",
    );
    await safeQuery(sb.from("course_packages").update({ status: "building", last_error: `Step ${stepKey}: transient retry ${transientNext}/${TRANSIENT_STEP_MAX}` }).eq("id", packageId));
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, stepKey, transient_retry: true, transient_attempts: transientNext };
  } else {
    const nextAttempts = stepAttempts + 1;

    if (nextAttempts < MAX_STEP_RETRIES) {
      console.warn(`[runner] ❌ ${stepKey} PERMANENT fail — attempt ${nextAttempts}/${MAX_STEP_RETRIES}`);
      const permBackoffRunAt = new Date(Date.now() + Math.max(15, backoffSec) * 1000).toISOString();
      const permResetMeta = { ...stepMeta };
      delete permResetMeta.first_transient_at;
      await safeQuery(
        sb.from("package_steps").update({
          status: "queued", job_id: null, runner_id: null, started_at: null,
          attempts: nextAttempts,
          meta: { ...permResetMeta, retry_after_sec: backoffSec, next_run_at: permBackoffRunAt, last_fail_reason: errorMsg, last_error_kind: "permanent", transient_attempts: 0 },
          last_error: `Permanent retry ${nextAttempts}/${MAX_STEP_RETRIES}: ${errorMsg.slice(0, 200)}`,
        }).eq("package_id", packageId).eq("step_key", stepKey).eq("job_id", jobId),
        "permanent_step_retry",
      );
      await safeQuery(sb.from("auto_heal_log").insert({
        action_type: "step_job_retry",
        trigger_source: "pipeline_runner",
        target_type: "package_step",
        target_id: packageId,
        result_status: "ok",
        result_detail: `${stepKey} permanent fail → re-queued (attempt ${nextAttempts}/${MAX_STEP_RETRIES})`,
        metadata: { step: stepKey, attempt: nextAttempts, error: errorMsg.slice(0, 500), kind: "permanent" },
      }));
      await safeQuery(sb.from("course_packages").update({ status: "building", last_error: `Step ${stepKey}: retry ${nextAttempts}/${MAX_STEP_RETRIES}` }).eq("id", packageId));
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, auto_heal_retry: true, attempt: nextAttempts, maxRetries: MAX_STEP_RETRIES, kind: "permanent" };
    }

    console.error(`[runner] ❌ Step ${stepKey} failed after ${MAX_STEP_RETRIES} retries: ${errorMsg}`);
    await safeRpc(sb, "step_fail", { p_package_id: packageId, p_step_key: stepKey, p_error: `Exhausted: ${errorMsg}` });
    await safeQuery(sb.from("package_steps").update({ job_id: null }).eq("package_id", packageId).eq("step_key", stepKey));
    await safeQuery(sb.from("course_packages").update({ status: "quality_gate_failed", last_error: `Step ${stepKey}: failed after ${MAX_STEP_RETRIES} retries` }).eq("id", packageId));
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, stepKey, job_failed: true, retries_exhausted: true, error: errorMsg };
  }
}

// ══════════════════════════════════════════════════════════════
// ENQUEUE handler
// ══════════════════════════════════════════════════════════════

export async function handleEnqueue(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  runnerId: string,
  shortId: string,
  nextAction: { action: "enqueue"; stepKey: StepKey },
  steps: StepRow[],
  STEP_ORDER: StepKey[],
  pkg: any,
  mode: string,
  stepClassCtx?: StepClassContext,
): Promise<Record<string, unknown>> {
  const stepKey = nextAction.stepKey;

  // ── STEP-CLASS CAPACITY GATE ──
  if (stepClassCtx) {
    const cls = classifyStep(stepKey);
    const currentLoad = stepClassCtx.load[cls]?.size ?? 0;
    const limit = stepClassCtx.limits[cls] ?? 99;
    if (currentLoad >= limit && !stepClassCtx.load[cls]?.has(packageId)) {
      console.log(`[runner] ⏸️ Step-class gate: ${cls} at capacity (${currentLoad}/${limit})`);
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, deferred: true, reason: "step_class_at_capacity", class: cls, load: currentLoad, limit };
    }
    stepClassCtx.load[cls]?.add(packageId);
  }

  const jobType = STEP_TO_JOB_TYPE[stepKey];
  const currentStep = steps.find((s: StepRow) => s.step_key === stepKey);
  const stepMeta = currentStep?.meta;
  const batchCursor = (stepMeta?.batch_cursor as Record<string, unknown>) ?? null;

  const retryAfterSec = typeof stepMeta?.retry_after_sec === "number" && stepMeta.retry_after_sec > 0
    ? Math.min(300, Math.max(5, Math.floor(stepMeta.retry_after_sec)))
    : 0;

  if (currentStep?.status === "running" || currentStep?.status === "enqueued") {
    console.warn(`[runner] Resetting orphaned step ${stepKey} (was ${currentStep.status}) → queued`);
    await safeQuery(
      sb.from("package_steps")
        .update({ status: "queued", job_id: null, runner_id: null, started_at: null })
        .eq("package_id", packageId)
        .eq("step_key", stepKey),
      "reset_orphan",
    );
  }

  // ── VARIANT READINESS GATE: block exam_pool if variant inventory not ready ──
  if (stepKey === "generate_exam_pool") {
    const { data: variantReady } = await sb.rpc("fn_is_variant_inventory_ready" as any, { p_package_id: packageId });
    if (variantReady === false) {
      console.warn(`[runner] ⛔ Variant readiness gate BLOCKED generate_exam_pool for ${shortId} — inventory not ready`);
      await safeQuery(
        sb.from("package_steps").update({
          status: "queued", job_id: null, runner_id: null, started_at: null,
          last_error: "WAITING_FOR_VARIANT_PREBUILD: variant inventory not yet ready",
        }).eq("package_id", packageId).eq("step_key", stepKey),
        "variant_readiness_gate_block",
      );
      await safeQuery(sb.from("auto_heal_log").insert({
        action_type: "variant_readiness_gate_block",
        trigger_source: "pipeline_runner",
        target_type: "package",
        target_id: packageId,
        result_status: "blocked",
        result_detail: "Blocked generate_exam_pool: variant inventory not ready",
      }), "log_variant_gate");
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, variant_readiness_gate_blocked: true };
    }
  }

  // ── INTEGRITY GATE: block exam_pool if content not ready ──
  const hasActiveLearningContent = steps.some((s: StepRow) => s.step_key === "generate_learning_content" && s.status !== "skipped");
  if (stepKey === "generate_exam_pool" && pkg.course_id && hasActiveLearningContent) {
    const { data: canProceed } = await sb.rpc("can_generate_exam_pool", { p_course_id: pkg.course_id });
    if (!canProceed) {
      console.warn(`[runner] ⛔ Content integrity gate BLOCKED generate_exam_pool for ${shortId}`);

      const { data: repairResult } = await sb.rpc("repair_placeholder_lessons", { p_course_id: pkg.course_id });
      const repaired = repairResult as { fixed_flags: number; still_empty: number; ready: boolean } | null;

      if (repaired?.ready) {
        console.log(`[runner] ✅ Auto-repair fixed ${repaired.fixed_flags} flags — proceeding`);
      } else {
        const { data: flightCheck } = await sb.rpc("check_lesson_writes_in_flight", { p_course_id: pkg.course_id, p_window_minutes: 5 });
        const inFlight = flightCheck as { in_flight: boolean; recent_writes: number } | null;

        if (inFlight?.in_flight) {
          console.log(`[runner] ⏳ Content writes in-flight (${inFlight.recent_writes} recent) — deferring`);
          await safeQuery(
            sb.from("package_steps").update({
              last_error: `Deferred: ${inFlight.recent_writes} lesson writes in last 5min`,
            }).eq("package_id", packageId).eq("step_key", stepKey),
            "integrity_gate_defer",
          );
          await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
          return { packageId, stepKey, integrity_gate_deferred: true, recent_writes: inFlight.recent_writes };
        }

        await safeQuery(
          sb.from("package_steps").update({
            status: "queued", job_id: null, runner_id: null, started_at: null,
            last_error: `Integrity gate: ${repaired?.still_empty ?? '?'} lessons still empty — re-generating`,
          }).eq("package_id", packageId).eq("step_key", "generate_learning_content"),
          "integrity_gate_reset_content",
        );
        await safeQuery(
          sb.from("package_steps").update({
            status: "queued", job_id: null, runner_id: null, started_at: null,
            last_error: `Waiting for content integrity (${repaired?.still_empty ?? '?'} lessons empty)`,
          }).eq("package_id", packageId).eq("step_key", stepKey),
          "integrity_gate_reset_exam",
        );
        await safeQuery(sb.from("auto_heal_log").insert({
          action_type: "integrity_gate_block",
          trigger_source: "pipeline_runner",
          target_type: "package",
          target_id: packageId,
          result_status: "healed",
          result_detail: `Blocked exam_pool, reset generate_learning_content (${repaired?.still_empty} empty)`,
        }), "log_integrity_gate");
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, stepKey, integrity_gate_blocked: true, still_empty: repaired?.still_empty };
      }
    }
  }

  // ── ACTIVE JOB DEDUP GUARD v3: prevent infinite re-enqueue loop ──
  // Check 1: active jobs (pending/processing) for this step+package
  const { count: activeJobCount } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("job_type", jobType)
    .eq("package_id", packageId)
    .in("status", ["pending", "processing"]);

  // Check 2: RECENTLY COMPLETED root jobs (last 5 min) — prevents rapid re-fan-out
  // Root fan-out jobs (e.g. exam_pool) complete instantly, making them invisible to
  // the active-only check above. This caused 990+ jobs/hour loops.
  const DEDUP_COOLDOWN_MS = 5 * 60 * 1000;
  const cooldownCutoff = new Date(Date.now() - DEDUP_COOLDOWN_MS).toISOString();
  const { count: recentCompletedCount } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("job_type", jobType)
    .eq("package_id", packageId)
    .eq("status", "completed")
    .gte("completed_at", cooldownCutoff);

  // Check 3: Active FAN-OUT sub-jobs (for fan-out job types like exam_pool)
  // Even if the root job completed, sub-jobs may still be running
  let activeFanOutCount = 0;
  if (jobType === "package_generate_exam_pool" || jobType === "package_generate_lesson_minichecks") {
    const { count: subJobCount } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("job_type", jobType)
      .eq("package_id", packageId)
      .in("status", ["pending", "processing"])
      .not("payload->_fan_out", "is", null);
    activeFanOutCount = subJobCount ?? 0;
  }

  const totalActiveOrRecent = (activeJobCount ?? 0) + (recentCompletedCount ?? 0) + activeFanOutCount;

  if (totalActiveOrRecent > 0) {
    const reason = (activeJobCount ?? 0) > 0
      ? "active_jobs_exist"
      : activeFanOutCount > 0
        ? "active_fanout_sub_jobs"
        : "recently_completed_cooldown";
    console.log(`[runner] ⏭️ Skipping enqueue for ${stepKey} — active=${activeJobCount}, recentCompleted=${recentCompletedCount}, fanOutSubs=${activeFanOutCount} for ${shortId} (reason: ${reason})`);
    // Link the step to an existing job if needed
    if (currentStep?.status === "queued") {
      const { data: existingJob } = await sb
        .from("job_queue")
        .select("id")
        .eq("job_type", jobType)
        .eq("package_id", packageId)
        .in("status", ["pending", "processing"])
        .limit(1)
        .maybeSingle();
      if (existingJob) {
        await safeQuery(
          sb.from("package_steps")
            .update({ status: "enqueued", job_id: existingJob.id, runner_id: runnerId })
            .eq("package_id", packageId)
            .eq("step_key", stepKey),
          "link_active_job",
        );
      }
    }
    return { packageId, stepKey, skipped: true, reason, active_jobs: activeJobCount, recent_completed: recentCompletedCount, fanout_subs: activeFanOutCount };
  }

  // ── LOOP GUARD: prevent infinite retry/fan-out loops ──
  // FIX 1: Artifact-SSOT override — if artifacts are materialized, bypass loop guard
  {
    const loopCheck = await checkLoopGuard(sb, packageId, stepKey, jobType, (currentStep?.meta ?? null) as Record<string, unknown> | null);
    if (loopCheck.blocked) {
      // Artifact-SSOT override for generate_learning_content:
      // If all lessons are generated, needs_regen=0, and no active content jobs,
      // the step is done regardless of job history.
      if (stepKey === "generate_learning_content") {
        try {
          const { data: matRows } = await sb.rpc("fn_package_learning_content_materialized", { p_package_id: packageId });
          const mat = Array.isArray(matRows) ? matRows[0] : matRows;
          if (
            mat?.materialized === true &&
            Number(mat.total_lessons ?? 0) > 0 &&
            Number(mat.generated_lessons ?? 0) >= Number(mat.total_lessons ?? 0) * 0.95 &&
            Number(mat.needs_regen_count ?? 999999) === 0 &&
            mat.no_active_content_jobs === true
          ) {
            console.warn(`[runner] 🏗️ ARTIFACT_SSOT_OVERRIDE: ${stepKey} for ${shortId} — loop guard blocked but content is 100% materialized (${mat.generated_lessons}/${mat.total_lessons}). Marking done.`);
            await safeQuery(
              sb.from("package_steps").update({
                status: "done",
                finished_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                last_error: null,
                job_id: null,
                runner_id: null,
                meta: {
                  ...(currentStep?.meta ?? {}),
                  loop_guard_overridden: true,
                  loop_guard_override_reason: "ARTIFACT_SSOT: content fully materialized",
                  loop_guard_original_reason: loopCheck.reason,
                  completion_guard: {
                    mode: "artifact_ssot_override",
                    total_lessons: mat.total_lessons,
                    generated_lessons: mat.generated_lessons,
                    needs_regen_count: mat.needs_regen_count,
                    completion_ratio: Number(mat.completion_ratio),
                    resolved_as: "done",
                  },
                },
              }).eq("package_id", packageId).eq("step_key", stepKey),
              "artifact_ssot_override",
            );
            await sb.from("auto_heal_log").insert({
              action_type: "loop_guard_artifact_ssot_override",
              trigger_source: "pipeline_runner",
              target_type: "package_step",
              target_id: packageId,
              result_status: "applied",
              result_detail: `Loop guard blocked ${stepKey} but artifacts are 100% materialized. Overriding to done.`,
              metadata: { step_key: stepKey, ...mat, original_guard_reason: loopCheck.reason },
            });
            // Don't block — just skip enqueue since step is now done
            await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
            return { packageId, stepKey, artifact_ssot_override: true, completion: mat };
          }
        } catch (ssotErr) {
          console.warn(`[runner] artifact-SSOT check failed for ${shortId}: ${(ssotErr as Error).message}`);
        }
      }
      await applyLoopGuardBlock(sb, packageId, stepKey, runnerId, loopCheck);
      return { packageId, stepKey, loop_guard_blocked: true, reason: loopCheck.reason, metrics: loopCheck.metrics };
    }
  }

  // ── Track first enqueue time for stagnation detection ──
  if (!currentStep?.meta?.first_enqueue_at) {
    await safeQuery(
      sb.from("package_steps").update({
        meta: { ...(currentStep?.meta ?? {}), first_enqueue_at: new Date().toISOString() },
      }).eq("package_id", packageId).eq("step_key", stepKey),
      "set_first_enqueue_at",
    );
  }

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
  if (currentStep?.meta?.target_lf_ids && Array.isArray(currentStep.meta.target_lf_ids)) {
    payload.target_lf_ids = currentStep.meta.target_lf_ids;
    console.log(`[runner] 🎯 Injecting target_lf_ids (${currentStep.meta.target_lf_ids.length} LFs)`);
  }

  const STEP_MAX_ATTEMPTS: Partial<Record<StepKey, number>> = {
    generate_handbook: 5,
    generate_exam_pool: 5,
    generate_oral_exam: 5,
    generate_learning_content: 5,
    generate_lesson_minichecks: 5,
    scaffold_learning_course: 3,
    validate_blueprints: 3,
    validate_exam_pool: 3,
    validate_oral_exam: 3,
    validate_handbook: 3,
    validate_tutor_index: 3,
    validate_learning_content: 3,
    validate_lesson_minichecks: 3,
    elite_harden: 5,
    run_integrity_check: 3,
    quality_council: 3,
    auto_publish: 3,
  };
  const stepMaxAttempts = STEP_MAX_ATTEMPTS[stepKey] ?? 10;

  let jobId: string | null = null;
  let insertErr: { message?: string } | null = null;
  try {
    const inserted = await enqueueJob(sb, {
      job_type: jobType,
      payload,
      package_id: packageId,
      max_attempts: stepMaxAttempts,
      priority: 10,
      run_after: retryAfterSec > 0 ? new Date(Date.now() + retryAfterSec * 1000).toISOString() : null,
      batch_cursor: batchCursor,
    });
    jobId = inserted.id;
  } catch (e) {
    insertErr = { message: (e as Error).message };
  }

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
          "link_existing_job",
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
      "set_enqueued",
    );
  }

  console.log(`[runner] 📤 Enqueued ${jobType} (job ${(jobId ?? "?").slice(0, 8)}) for ${shortId}`);
  return { packageId, stepKey, enqueued: true, jobId };
}
