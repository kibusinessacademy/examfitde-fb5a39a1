/**
 * SSOT Learning-Content Revive Helpers
 *
 * Provides:
 *   - Transient error classification for lesson_generate_content
 *   - Liveness detection for generate_learning_content steps
 *   - Step revive logic when no live jobs exist but needsRegen > 0
 *
 * Used by: package-generate-learning-content (dispatcher), pipeline-watchdog
 */

// deno-lint-ignore-file no-explicit-any

const TRANSIENT_PATTERNS = [
  "503",
  "timeout",
  "etimedout",
  "econnreset",
  "socket hang up",
  "empty response",
  "provider unavailable",
  "service unavailable",
  "all providers failed",
  "overloaded",
  "temporar",
  "deadline exceeded",
  "rate limit",
  "429",
  "upstream error",
];

export function normalizeErr(input: unknown): string {
  if (!input) return "";
  if (typeof input === "string") return input;
  if (input instanceof Error) return input.message || String(input);
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

export function isTransientLearningContentError(input: unknown): boolean {
  const e = normalizeErr(input).toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => e.includes(p));
}

/**
 * Count active lesson_generate_content jobs for a package.
 */
export async function getLearningContentJobState(
  sb: any,
  packageId: string,
): Promise<{ pending: number; processing: number; failed: number }> {
  const { data, error } = await sb
    .from("job_queue")
    .select("status")
    .eq("package_id", packageId)
    .eq("job_type", "lesson_generate_content")
    .in("status", ["pending", "queued", "processing", "failed"]);

  if (error || !data) return { pending: 0, processing: 0, failed: 0 };

  return {
    pending: data.filter((r: any) => r.status === "pending" || r.status === "queued").length,
    processing: data.filter((r: any) => r.status === "processing").length,
    failed: data.filter((r: any) => r.status === "failed").length,
  };
}

/**
 * Detect and revive a dead generate_learning_content step.
 *
 * Dead = step is not 'done', needsRegen > 0, but pending+processing = 0.
 * This means the dispatcher has nothing to work with.
 *
 * Fix: reset step to 'queued' so the pipeline-runner re-triggers the dispatcher.
 *
 * Returns true if revived, false if no action needed.
 */
export async function reviveLearningContentStepIfDead(
  sb: any,
  packageId: string,
  needsRegenCount: number,
): Promise<boolean> {
  if (needsRegenCount <= 0) return false;

  // Load step
  const { data: step } = await sb
    .from("package_steps")
    .select("id, status, meta")
    .eq("package_id", packageId)
    .eq("step_key", "generate_learning_content")
    .maybeSingle();

  if (!step) return false;
  if (step.status === "done") return false;

  const state = await getLearningContentJobState(sb, packageId);

  // If there are still live jobs, no revive needed
  if (state.pending > 0 || state.processing > 0) return false;

  // Dead: needsRegen > 0, no live jobs → reset step to queued
  const { error } = await sb
    .from("package_steps")
    .update({
      status: "queued",
      started_at: null,
      updated_at: new Date().toISOString(),
      last_error: null,
      meta: {
        ...(step.meta || {}),
        liveness_requeued: true,
        liveness_requeued_at: new Date().toISOString(),
        liveness_requeue_reason: "needs_regen_but_no_live_jobs",
        liveness_needs_regen: needsRegenCount,
        liveness_stale_failed: state.failed,
      },
    })
    .eq("id", step.id);

  if (error) {
    console.error(`[revive] Failed to revive step ${step.id}: ${error.message}`);
    return false;
  }

  console.warn(
    `[revive] LIVENESS_REQUEUE package=${packageId.slice(0, 8)} step=${step.id.slice(0, 8)} needsRegen=${needsRegenCount} staleFailed=${state.failed}`,
  );
  return true;
}

/**
 * Neutralize stale transient-exhausted failed jobs for a package.
 * Sets them to 'cancelled' so the dispatcher can create fresh jobs.
 * Returns count of neutralized jobs.
 */
export async function neutralizeStaleTransientFailed(
  sb: any,
  packageId: string,
  staleThresholdMinutes = 120,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleThresholdMinutes * 60_000).toISOString();

  const { data: staleJobs, error } = await sb
    .from("job_queue")
    .select("id, last_error")
    .eq("package_id", packageId)
    .eq("job_type", "lesson_generate_content")
    .eq("status", "failed")
    .lt("updated_at", cutoff);

  if (error || !staleJobs || staleJobs.length === 0) return 0;

  // Filter to only transient failures
  const transientIds = staleJobs
    .filter((j: any) => isTransientLearningContentError(j.last_error))
    .map((j: any) => j.id);

  if (transientIds.length === 0) return 0;

  const now = new Date().toISOString();
  const { error: updateErr } = await sb
    .from("job_queue")
    .update({
      status: "cancelled",
      completed_at: now,
      updated_at: now,
      last_error: `[AUTO_REVIVE] ${now} transient failure neutralized for redispatch`,
      meta: {
        auto_revived: true,
        auto_revived_at: now,
        auto_revive_reason: "stale_transient_exhausted",
      },
    })
    .in("id", transientIds);

  if (updateErr) {
    console.error(`[revive] neutralize failed: ${updateErr.message}`);
    return 0;
  }

  console.warn(`[revive] Neutralized ${transientIds.length} stale transient-failed jobs for package=${packageId.slice(0, 8)}`);
  return transientIds.length;
}
