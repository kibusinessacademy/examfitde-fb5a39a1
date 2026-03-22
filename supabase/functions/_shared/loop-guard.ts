/**
 * loop-guard.ts — Systemwide Loop Prevention Guard (v2)
 *
 * Prevents infinite retry/fan-out loops by tracking:
 * 1. Consecutive zero-progress runs (ZERO_GENERATION, generated=0)
 * 2. Cumulative job count per step/package in a rolling window
 * 3. Time-based stagnation (no new artifacts produced over N hours)
 * 4. Cumulative attempts across ALL jobs for a step (v2: retry-path guard)
 *
 * v2 changes:
 * - Added checkRetryLoopGuard() for the retry path in handleJobFailed
 * - Added cumulative attempts tracking across all jobs
 * - ZERO_GENERATION errors now counted as zero-progress even on retry path
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// ── Configuration ──
const LOOP_GUARD_CONFIG = {
  /** Max consecutive runs with zero new content before blocking */
  MAX_ZERO_PROGRESS_RUNS: 5,
  /** Max total jobs for a single step/package in 24h before blocking */
  MAX_JOBS_PER_STEP_24H: 80,
  /** Max total failed jobs for a single step/package before blocking */
  MAX_FAILED_JOBS_PER_STEP: 30,
  /** Rolling window for job count check (hours) */
  JOB_COUNT_WINDOW_HOURS: 24,
  /** If step has been in non-done state for this many hours with no progress, block */
  MAX_STAGNATION_HOURS: 8,
  /** Max cumulative attempts across ALL jobs for a step/package in 24h */
  MAX_CUMULATIVE_ATTEMPTS_24H: 50,
  /** Max consecutive ZERO_GENERATION failures before blocking (retry-path) */
  MAX_ZERO_GENERATION_STREAK: 4,
} as const;

export interface LoopGuardResult {
  blocked: boolean;
  reason?: string;
  metrics?: Record<string, unknown>;
}

/**
 * Pre-enqueue loop guard: checks if a step should be blocked
 * to prevent infinite loops. Called BEFORE creating a new job.
 */
export async function checkLoopGuard(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  stepKey: string,
  jobType: string,
  stepMeta: Record<string, unknown> | null,
): Promise<LoopGuardResult> {
  const meta = stepMeta ?? {};

  // ── Check 1: Consecutive zero-progress runs ──
  const zeroProgressRuns = typeof meta.zero_progress_runs === "number"
    ? meta.zero_progress_runs : 0;

  if (zeroProgressRuns >= LOOP_GUARD_CONFIG.MAX_ZERO_PROGRESS_RUNS) {
    return {
      blocked: true,
      reason: `LOOP_GUARD: ${zeroProgressRuns} consecutive zero-progress runs (limit: ${LOOP_GUARD_CONFIG.MAX_ZERO_PROGRESS_RUNS})`,
      metrics: { zero_progress_runs: zeroProgressRuns, limit: LOOP_GUARD_CONFIG.MAX_ZERO_PROGRESS_RUNS },
    };
  }

  // ── Check 1b: ZERO_GENERATION streak (v2) ──
  const zeroGenStreak = typeof meta.zero_generation_streak === "number"
    ? meta.zero_generation_streak : 0;

  if (zeroGenStreak >= LOOP_GUARD_CONFIG.MAX_ZERO_GENERATION_STREAK) {
    return {
      blocked: true,
      reason: `LOOP_GUARD: ${zeroGenStreak} consecutive ZERO_GENERATION failures (limit: ${LOOP_GUARD_CONFIG.MAX_ZERO_GENERATION_STREAK})`,
      metrics: { zero_generation_streak: zeroGenStreak, limit: LOOP_GUARD_CONFIG.MAX_ZERO_GENERATION_STREAK },
    };
  }

  // ── Determine effective window cutoff ──
  // If an admin reset occurred (loop_guard_reset_at), only count jobs created AFTER the reset.
  // This prevents stale historical jobs from re-triggering the guard immediately after an admin heal.
  const defaultCutoff = new Date(
    Date.now() - LOOP_GUARD_CONFIG.JOB_COUNT_WINDOW_HOURS * 3600 * 1000,
  ).toISOString();

  const resetAt = typeof meta.loop_guard_reset_at === "string"
    ? meta.loop_guard_reset_at : null;
  const windowCutoff = resetAt && resetAt > defaultCutoff ? resetAt : defaultCutoff;

  // ── Check 2: Cumulative job count in rolling window ──
  // Exclude cancelled jobs — they are administratively terminated, not loop evidence
  const { count: totalJobsInWindow } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("job_type", jobType)
    .eq("package_id", packageId)
    .neq("status", "cancelled")
    .gte("created_at", windowCutoff);

  if ((totalJobsInWindow ?? 0) >= LOOP_GUARD_CONFIG.MAX_JOBS_PER_STEP_24H) {
    return {
      blocked: true,
      reason: `LOOP_GUARD: ${totalJobsInWindow} jobs created for ${stepKey} in last ${LOOP_GUARD_CONFIG.JOB_COUNT_WINDOW_HOURS}h (limit: ${LOOP_GUARD_CONFIG.MAX_JOBS_PER_STEP_24H})`,
      metrics: { total_jobs_24h: totalJobsInWindow, limit: LOOP_GUARD_CONFIG.MAX_JOBS_PER_STEP_24H },
    };
  }

  // ── Check 3: Failed job accumulation ──
  const { count: failedJobCount } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("job_type", jobType)
    .eq("package_id", packageId)
    .eq("status", "failed")
    .gte("created_at", windowCutoff);

  if ((failedJobCount ?? 0) >= LOOP_GUARD_CONFIG.MAX_FAILED_JOBS_PER_STEP) {
    return {
      blocked: true,
      reason: `LOOP_GUARD: ${failedJobCount} failed jobs for ${stepKey} in last ${LOOP_GUARD_CONFIG.JOB_COUNT_WINDOW_HOURS}h (limit: ${LOOP_GUARD_CONFIG.MAX_FAILED_JOBS_PER_STEP})`,
      metrics: { failed_jobs_24h: failedJobCount, limit: LOOP_GUARD_CONFIG.MAX_FAILED_JOBS_PER_STEP },
    };
  }

  // ── Check 4: Cumulative attempts across all jobs (v2) ──
  // Exclude cancelled jobs from attempt counting — they represent
  // administratively terminated work (e.g. wrong payload format), not real loops
  const { data: attemptRows } = await sb
    .from("job_queue")
    .select("attempts")
    .eq("job_type", jobType)
    .eq("package_id", packageId)
    .neq("status", "cancelled")
    .gte("created_at", windowCutoff);

  const totalAttempts = (attemptRows ?? []).reduce(
    (sum: number, r: { attempts: number }) => sum + (r.attempts || 0), 0
  );

  if (totalAttempts >= LOOP_GUARD_CONFIG.MAX_CUMULATIVE_ATTEMPTS_24H) {
    return {
      blocked: true,
      reason: `LOOP_GUARD: ${totalAttempts} cumulative attempts across all jobs for ${stepKey} in 24h (limit: ${LOOP_GUARD_CONFIG.MAX_CUMULATIVE_ATTEMPTS_24H})`,
      metrics: { cumulative_attempts_24h: totalAttempts, limit: LOOP_GUARD_CONFIG.MAX_CUMULATIVE_ATTEMPTS_24H },
    };
  }

  // ── Check 5: Time-based stagnation ──
  const lastProgressAt = typeof meta.last_progress_at === "string"
    ? meta.last_progress_at
    : typeof meta.first_enqueue_at === "string"
      ? meta.first_enqueue_at
      : null;

  if (lastProgressAt) {
    const stagnationMs = Date.now() - new Date(lastProgressAt).getTime();
    const stagnationHours = stagnationMs / (3600 * 1000);
    if (stagnationHours >= LOOP_GUARD_CONFIG.MAX_STAGNATION_HOURS && zeroProgressRuns >= 2) {
      return {
        blocked: true,
        reason: `LOOP_GUARD: No progress for ${stagnationHours.toFixed(1)}h with ${zeroProgressRuns} zero-progress runs`,
        metrics: { stagnation_hours: stagnationHours, zero_progress_runs: zeroProgressRuns },
      };
    }
  }

  return { blocked: false };
}

/**
 * v2: Retry-path loop guard — called from handleJobFailed BEFORE requeueing a step.
 * Checks the error pattern and step meta to decide if the retry should be blocked.
 * This is lighter than checkLoopGuard (no DB queries) for hot-path performance.
 */
export function checkRetryLoopGuard(
  stepMeta: Record<string, unknown>,
  errorMsg: string,
  stepAttempts: number,
): LoopGuardResult {
  const meta = stepMeta ?? {};

  // ── Check A: ZERO_GENERATION streak ──
  const isZeroGen = /ZERO_GENERATION|EFFECTIVE_FAILURE.*generated.*0/i.test(errorMsg);
  const zeroGenStreak = typeof meta.zero_generation_streak === "number"
    ? meta.zero_generation_streak : 0;
  const effectiveStreak = isZeroGen ? zeroGenStreak + 1 : zeroGenStreak;

  if (effectiveStreak >= LOOP_GUARD_CONFIG.MAX_ZERO_GENERATION_STREAK) {
    return {
      blocked: true,
      reason: `LOOP_GUARD_RETRY: ${effectiveStreak} consecutive ZERO_GENERATION failures — LLM cannot produce content for this step`,
      metrics: { zero_generation_streak: effectiveStreak, error_pattern: "ZERO_GENERATION", step_attempts: stepAttempts },
    };
  }

  // ── Check B: Zero-progress runs ──
  const zeroProgressRuns = typeof meta.zero_progress_runs === "number"
    ? meta.zero_progress_runs : 0;
  if (zeroProgressRuns >= LOOP_GUARD_CONFIG.MAX_ZERO_PROGRESS_RUNS) {
    return {
      blocked: true,
      reason: `LOOP_GUARD_RETRY: ${zeroProgressRuns} zero-progress runs detected at retry time`,
      metrics: { zero_progress_runs: zeroProgressRuns },
    };
  }

  return { blocked: false };
}

/**
 * Apply loop guard block: sets step to blocked and logs the event.
 */
export async function applyLoopGuardBlock(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  stepKey: string,
  runnerId: string,
  guardResult: LoopGuardResult,
): Promise<void> {
  const reason = guardResult.reason ?? "LOOP_GUARD: unknown";

  console.error(`[runner] 🛑 LOOP GUARD BLOCK: ${stepKey} for ${packageId.slice(0, 8)} — ${reason}`);

  // Block the step
  await sb
    .from("package_steps")
    .update({
      status: "blocked",
      job_id: null,
      runner_id: null,
      last_error: reason,
      meta: {
        loop_guard_blocked: true,
        loop_guard_reason: reason,
        loop_guard_metrics: guardResult.metrics,
        loop_guard_blocked_at: new Date().toISOString(),
      },
    })
    .eq("package_id", packageId)
    .eq("step_key", stepKey);

  // Block the package
  await sb
    .from("course_packages")
    .update({
      status: "blocked",
      blocked_reason: `loop_guard_${stepKey}`,
      last_error: reason,
    })
    .eq("id", packageId);

  // Cancel any remaining jobs for this step
  const jobType = await getJobTypeForStep(sb, stepKey);
  if (jobType) {
    await sb
      .from("job_queue")
      .update({ status: "cancelled", last_error: `Cancelled by loop guard: ${reason}` })
      .eq("package_id", packageId)
      .eq("job_type", jobType)
      .in("status", ["pending", "processing"]);
  }

  // Log to auto_heal_log
  await sb.from("auto_heal_log").insert({
    action_type: "loop_guard_block",
    trigger_source: "pipeline_runner",
    target_type: "package_step",
    target_id: packageId,
    result_status: "blocked",
    result_detail: reason,
    metadata: {
      step_key: stepKey,
      ...guardResult.metrics,
    },
  });

  // Release lease
  try {
    await sb.rpc("release_package_lease", {
      p_package_id: packageId,
      p_runner_id: runnerId,
    });
  } catch { /* best effort */ }
}

/**
 * Record progress (or lack thereof) after a job completes.
 * Call this when a job finishes to update the loop guard counters.
 */
export function updateLoopGuardMeta(
  currentMeta: Record<string, unknown>,
  jobResult: { generated?: number; inserted?: number; noop_reason?: string | null },
): Record<string, unknown> {
  const madeProgress =
    (jobResult.generated ?? 0) > 0 ||
    (jobResult.inserted ?? 0) > 0 ||
    jobResult.noop_reason === "TARGET_ALREADY_REACHED";

  const prevZeroRuns = typeof currentMeta.zero_progress_runs === "number"
    ? currentMeta.zero_progress_runs : 0;

  if (madeProgress) {
    return {
      ...currentMeta,
      zero_progress_runs: 0,
      zero_generation_streak: 0,
      last_progress_at: new Date().toISOString(),
      total_progress_runs: (typeof currentMeta.total_progress_runs === "number"
        ? currentMeta.total_progress_runs : 0) + 1,
    };
  } else {
    return {
      ...currentMeta,
      zero_progress_runs: prevZeroRuns + 1,
      last_zero_progress_at: new Date().toISOString(),
    };
  }
}

/**
 * v2: Update loop guard meta specifically for ZERO_GENERATION errors on retry path.
 * This tracks the streak of ZERO_GENERATION failures separately from generic zero-progress.
 */
export function updateRetryLoopGuardMeta(
  currentMeta: Record<string, unknown>,
  errorMsg: string,
): Record<string, unknown> {
  const isZeroGen = /ZERO_GENERATION|EFFECTIVE_FAILURE.*generated.*0/i.test(errorMsg);
  const prevStreak = typeof currentMeta.zero_generation_streak === "number"
    ? currentMeta.zero_generation_streak : 0;
  const prevZeroRuns = typeof currentMeta.zero_progress_runs === "number"
    ? currentMeta.zero_progress_runs : 0;

  if (isZeroGen) {
    return {
      ...currentMeta,
      zero_generation_streak: prevStreak + 1,
      zero_progress_runs: prevZeroRuns + 1,
      last_zero_generation_at: new Date().toISOString(),
      last_zero_progress_at: new Date().toISOString(),
    };
  }

  return currentMeta;
}

// ── Helper: resolve job_type for a step_key ──
async function getJobTypeForStep(
  sb: ReturnType<typeof createClient>,
  stepKey: string,
): Promise<string | null> {
  const { data } = await sb
    .from("ops_jobtype_step_map")
    .select("job_type")
    .eq("step_key", stepKey)
    .maybeSingle();
  return data?.job_type ?? `package_${stepKey}`;
}
