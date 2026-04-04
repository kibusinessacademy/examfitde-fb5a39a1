/**
 * F-3: Central Fanout Loop Guard
 *
 * Prevents re-enqueue loops for fanout/shard/blueprint jobs.
 * Called by enqueueJob() so ALL paths (watchdog, reconciler, sequencer,
 * repair, direct edge-function dispatches) are automatically covered.
 *
 * Rules:
 *   1. Block if ≥3 matching jobs created in last 30 min for same package
 *   2. Block if active (pending/queued/processing) jobs already exist
 *      for same package + job_type (unless progress justifies it)
 *   3. Log every block to auto_heal_log for observability
 */

/**
 * Job types subject to fanout loop protection.
 *
 * IMPORTANT: Only PARENT/ORCHESTRATOR types go here — NOT individual
 * shard/child jobs. Shard jobs (lesson_generate_content_shard) are
 * legitimately created in bulk during a single fanout and are already
 * deduplicated via batch_cursor in the unique index.
 */
export const FANOUT_GUARDED_JOB_TYPES = new Set([
  "package_fanout_learning_content",
  "regenerate_learning_content_cluster",
]);

export interface FanoutGuardResult {
  blocked: boolean;
  reason?: string;
  recent_count?: number;
  active_count?: number;
}

/**
 * Check whether a fanout job should be blocked.
 * Returns { blocked: false } for non-guarded job types (passthrough).
 */
export async function checkFanoutLoopGuard(
  // deno-lint-ignore no-explicit-any
  sb: any,
  jobType: string,
  packageId: string | null,
): Promise<FanoutGuardResult> {
  // Only guard fanout-type jobs
  if (!FANOUT_GUARDED_JOB_TYPES.has(jobType)) {
    return { blocked: false };
  }

  // No package = no guard (global jobs are not fanout)
  if (!packageId) {
    return { blocked: false };
  }

  const MAX_RECENT = 3;
  const WINDOW_MINUTES = 30;
  const cutoff = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

  // Run both checks in parallel
  const [recentResult, activeResult] = await Promise.all([
    // Count jobs created in window
    sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("package_id", packageId)
      .eq("job_type", jobType)
      .gte("created_at", cutoff),
    // Count currently active jobs
    sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("package_id", packageId)
      .eq("job_type", jobType)
      .in("status", ["pending", "queued", "processing"]),
  ]);

  const recentCount = recentResult.count ?? 0;
  const activeCount = activeResult.count ?? 0;

  // Rule 1: too many recent enqueues → loop detected
  if (recentCount >= MAX_RECENT) {
    const reason = `FANOUT_LOOP_GUARD: ${recentCount} ${jobType} jobs for pkg ${packageId.slice(0, 8)} in last ${WINDOW_MINUTES}min (limit ${MAX_RECENT})`;
    console.warn(`[fanout-guard] ${reason}`);
    await logFanoutBlock(sb, jobType, packageId, reason, recentCount, activeCount);
    return { blocked: true, reason, recent_count: recentCount, active_count: activeCount };
  }

  // Rule 2: active jobs already exist → skip duplicate enqueue
  if (activeCount > 0) {
    const reason = `FANOUT_ACTIVE_GUARD: ${activeCount} active ${jobType} jobs for pkg ${packageId.slice(0, 8)}`;
    console.warn(`[fanout-guard] ${reason}`);
    await logFanoutBlock(sb, jobType, packageId, reason, recentCount, activeCount);
    return { blocked: true, reason, recent_count: recentCount, active_count: activeCount };
  }

  return { blocked: false, recent_count: recentCount, active_count: activeCount };
}

/**
 * Fire-and-forget audit log for blocked fanout enqueues.
 */
async function logFanoutBlock(
  // deno-lint-ignore no-explicit-any
  sb: any,
  jobType: string,
  packageId: string,
  reason: string,
  recentCount: number,
  activeCount: number,
): Promise<void> {
  try {
    await sb.from("auto_heal_log").insert({
      package_id: packageId,
      action_type: "fanout_loop_guard",
      result_status: "blocked",
      details: {
        job_type: jobType,
        recent_count: recentCount,
        active_count: activeCount,
        reason,
      },
    });
  } catch (_e) {
    // fire-and-forget — never let logging break the enqueue path
  }
}
