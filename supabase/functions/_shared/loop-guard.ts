/**
 * loop-guard.ts — Systemwide Loop Prevention Guard
 *
 * Prevents infinite retry/fan-out loops by tracking:
 * 1. Consecutive zero-progress runs (ZERO_GENERATION, generated=0)
 * 2. Cumulative job count per step/package in a rolling window
 * 3. Time-based stagnation (no new artifacts produced over N hours)
 *
 * When thresholds are breached, the step is blocked with a clear reason
 * and the package is flagged to prevent further resource waste.
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

  // ── Check 2: Cumulative job count in rolling window ──
  const windowCutoff = new Date(
    Date.now() - LOOP_GUARD_CONFIG.JOB_COUNT_WINDOW_HOURS * 3600 * 1000,
  ).toISOString();

  const { count: totalJobsInWindow } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("job_type", jobType)
    .eq("package_id", packageId)
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

  // ── Check 4: Time-based stagnation ──
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

  // Cancel any remaining jobs
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

// ── Helper: resolve job_type for a step_key ──
async function getJobTypeForStep(
  sb: ReturnType<typeof createClient>,
  stepKey: string,
): Promise<string | null> {
  // Use the mapping view if available, fallback to convention
  const { data } = await sb
    .from("ops_jobtype_step_map")
    .select("job_type")
    .eq("step_key", stepKey)
    .maybeSingle();
  return data?.job_type ?? `package_${stepKey}`;
}
