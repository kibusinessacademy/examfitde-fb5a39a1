/**
 * SSOT Learning-Content Revive Helpers (v2 — Shard-Aware)
 *
 * Provides:
 *   - Composite liveness detection spanning parent jobs AND shard jobs/shards
 *   - Transient error classification for lesson_generate_content
 *   - Step revive logic when no live jobs exist but needsRegen > 0
 *   - Orphan-shard detection as first-class signal
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

// ═══════════════════════════════════════════════════════════════════
// Composite Liveness Verdict
// ═══════════════════════════════════════════════════════════════════

export type ShardLivenessVerdict =
  | "healthy_active"      // Active shard or parent jobs exist
  | "healthy_idle"        // All shards done, no active jobs → ready for finalize
  | "shard_orphaned"      // Pending shards exist but no active shard jobs
  | "parent_only_active"  // Parent job active, no shards yet (pre-fanout)
  | "fully_idle"          // No shards, no jobs, no activity
  | "stalled";            // Jobs exist but no progress for grace window

export interface LearningContentLivenessState {
  // Parent-level (lesson_generate_content)
  parent_pending: number;
  parent_processing: number;
  parent_failed: number;

  // Shard-level (lesson_generate_content_shard jobs)
  shard_jobs_pending: number;
  shard_jobs_processing: number;
  shard_jobs_failed: number;

  // Shard table state (package_content_shards)
  shards_pending: number;
  shards_processing: number;
  shards_completed: number;
  shards_failed: number;
  shards_total: number;
  last_shard_activity_at: string | null;

  // Composite verdict
  verdict: ShardLivenessVerdict;
  is_deadlocked: boolean;
}

/**
 * Count jobs by type and status for a package.
 */
async function countJobsByType(
  sb: any,
  packageId: string,
  jobType: string,
): Promise<{ pending: number; processing: number; failed: number }> {
  const { data, error } = await sb
    .from("job_queue")
    .select("status")
    .eq("package_id", packageId)
    .eq("job_type", jobType)
    .in("status", ["pending", "queued", "processing", "failed"]);

  if (error || !data) return { pending: 0, processing: 0, failed: 0 };

  return {
    pending: data.filter((r: any) => r.status === "pending" || r.status === "queued").length,
    processing: data.filter((r: any) => r.status === "processing").length,
    failed: data.filter((r: any) => r.status === "failed").length,
  };
}

/**
 * Get shard table state for a package.
 */
async function getShardTableState(
  sb: any,
  packageId: string,
): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
  last_activity_at: string | null;
}> {
  const { data, error } = await sb
    .from("package_content_shards")
    .select("status, updated_at")
    .eq("package_id", packageId);

  if (error || !data || data.length === 0) {
    return { pending: 0, processing: 0, completed: 0, failed: 0, total: 0, last_activity_at: null };
  }

  let lastActivity: string | null = null;
  for (const row of data) {
    if (!lastActivity || (row.updated_at && row.updated_at > lastActivity)) {
      lastActivity = row.updated_at;
    }
  }

  return {
    pending: data.filter((r: any) => r.status === "pending" || r.status === "claimed").length,
    processing: data.filter((r: any) => r.status === "processing").length,
    completed: data.filter((r: any) => r.status === "completed").length,
    failed: data.filter((r: any) => r.status === "failed").length,
    total: data.length,
    last_activity_at: lastActivity,
  };
}

/**
 * Derive composite liveness verdict from parent + shard state.
 */
function deriveVerdict(
  parent: { pending: number; processing: number; failed: number },
  shardJobs: { pending: number; processing: number; failed: number },
  shardTable: { pending: number; processing: number; completed: number; failed: number; total: number; last_activity_at: string | null },
  graceWindowMinutes = 15,
): { verdict: ShardLivenessVerdict; is_deadlocked: boolean } {
  const parentActive = parent.pending + parent.processing > 0;
  const shardJobsActive = shardJobs.pending + shardJobs.processing > 0;
  const shardsPendingOrProcessing = shardTable.pending + shardTable.processing;
  const hasShards = shardTable.total > 0;

  // Case 1: Active shard jobs → healthy
  if (shardJobsActive) {
    return { verdict: "healthy_active", is_deadlocked: false };
  }

  // Case 2: Parent active, no shards yet → pre-fanout phase
  if (parentActive && !hasShards) {
    return { verdict: "parent_only_active", is_deadlocked: false };
  }

  // Case 3: All shards done (completed + failed = total), no active jobs → ready for finalize
  if (hasShards && shardsPendingOrProcessing === 0) {
    return { verdict: "healthy_idle", is_deadlocked: false };
  }

  // Case 4: Pending/processing shards but NO active shard jobs → DEADLOCK
  if (shardsPendingOrProcessing > 0 && !shardJobsActive) {
    // Check grace window — maybe jobs just finished and new ones are being dispatched
    if (shardTable.last_activity_at) {
      const lastActivity = new Date(shardTable.last_activity_at).getTime();
      const graceMs = graceWindowMinutes * 60_000;
      if (Date.now() - lastActivity < graceMs) {
        // Within grace window — could be transient
        return { verdict: "stalled", is_deadlocked: false };
      }
    }
    return { verdict: "shard_orphaned", is_deadlocked: true };
  }

  // Case 5: No shards, no jobs → fully idle
  if (!hasShards && !parentActive) {
    return { verdict: "fully_idle", is_deadlocked: false };
  }

  // Fallback: parent active with shards but unclear state
  return { verdict: "healthy_active", is_deadlocked: false };
}

/**
 * Full composite liveness assessment for generate_learning_content.
 *
 * Replaces the old parent-only `getLearningContentJobState`.
 */
export async function getLearningContentLiveness(
  sb: any,
  packageId: string,
  graceWindowMinutes = 15,
): Promise<LearningContentLivenessState> {
  const [parent, shardJobs, shardTable] = await Promise.all([
    countJobsByType(sb, packageId, "lesson_generate_content"),
    countJobsByType(sb, packageId, "lesson_generate_content_shard"),
    getShardTableState(sb, packageId),
  ]);

  const { verdict, is_deadlocked } = deriveVerdict(parent, shardJobs, shardTable, graceWindowMinutes);

  return {
    parent_pending: parent.pending,
    parent_processing: parent.processing,
    parent_failed: parent.failed,
    shard_jobs_pending: shardJobs.pending,
    shard_jobs_processing: shardJobs.processing,
    shard_jobs_failed: shardJobs.failed,
    shards_pending: shardTable.pending,
    shards_processing: shardTable.processing,
    shards_completed: shardTable.completed,
    shards_failed: shardTable.failed,
    shards_total: shardTable.total,
    last_shard_activity_at: shardTable.last_activity_at,
    verdict,
    is_deadlocked,
  };
}

/**
 * Legacy compat wrapper — returns the old shape but now includes shard jobs.
 */
export async function getLearningContentJobState(
  sb: any,
  packageId: string,
): Promise<{ pending: number; processing: number; failed: number }> {
  const [parent, shardJobs] = await Promise.all([
    countJobsByType(sb, packageId, "lesson_generate_content"),
    countJobsByType(sb, packageId, "lesson_generate_content_shard"),
  ]);

  return {
    pending: parent.pending + shardJobs.pending,
    processing: parent.processing + shardJobs.processing,
    failed: parent.failed + shardJobs.failed,
  };
}

/**
 * Detect and revive a dead generate_learning_content step.
 *
 * Now uses composite shard-aware liveness instead of parent-only checks.
 *
 * Dead = step is not 'done', needsRegen > 0, and verdict is shard_orphaned or fully_idle.
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

  // Use composite liveness
  const liveness = await getLearningContentLiveness(sb, packageId);

  // Only revive if genuinely deadlocked or fully idle
  if (!liveness.is_deadlocked && liveness.verdict !== "fully_idle") return false;

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
        liveness_requeue_reason: liveness.verdict,
        liveness_needs_regen: needsRegenCount,
        liveness_verdict: liveness.verdict,
        liveness_shard_state: {
          shards_pending: liveness.shards_pending,
          shards_completed: liveness.shards_completed,
          shard_jobs_active: liveness.shard_jobs_pending + liveness.shard_jobs_processing,
          parent_jobs_active: liveness.parent_pending + liveness.parent_processing,
        },
      },
    })
    .eq("id", step.id);

  if (error) {
    console.error(`[revive] Failed to revive step ${step.id}: ${error.message}`);
    return false;
  }

  console.warn(
    `[revive] LIVENESS_REQUEUE package=${packageId.slice(0, 8)} step=${step.id.slice(0, 8)} verdict=${liveness.verdict} needsRegen=${needsRegenCount} shards=${liveness.shards_total}(pending=${liveness.shards_pending})`,
  );
  return true;
}

/**
 * Neutralize stale transient-exhausted failed jobs for a package.
 * Now covers BOTH parent and shard job types.
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
    .in("job_type", ["lesson_generate_content", "lesson_generate_content_shard"])
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
