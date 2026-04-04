/**
 * content-shard-tracker.ts — SSOT shard lifecycle management
 *
 * Provides functions for:
 *   - Creating shards when fan-out dispatches
 *   - Updating shard progress from competency-bundle / lesson workers
 *   - Querying shard status for barrier checks
 *
 * All shard state is in `package_content_shards` table.
 */

// deno-lint-ignore-file no-explicit-any

/**
 * Create shard records for a fan-out batch.
 * Called by package-generate-learning-content when dispatching competency bundles.
 */
export async function createShardsForFanOut(
  sb: any,
  packageId: string,
  courseId: string,
  fanoutId: string,
  shards: Array<{
    learning_field_id: string;
    lesson_count: number;
    chunk_index?: number;
    chunk_count?: number;
  }>,
): Promise<number> {
  if (shards.length === 0) return 0;

  const shardsJson = JSON.stringify(
    shards.map((s) => ({
      learning_field_id: s.learning_field_id,
      lesson_count: s.lesson_count,
      chunk_index: s.chunk_index ?? 1,
      chunk_count: s.chunk_count ?? 1,
    })),
  );

  const { data, error } = await sb.rpc("create_content_shards", {
    p_package_id: packageId,
    p_course_id: courseId,
    p_fanout_id: fanoutId,
    p_shards: shardsJson,
  });

  if (error) {
    console.warn(`[shard-tracker] create_content_shards error: ${error.message}`);
    return 0;
  }

  return data ?? shards.length;
}

/**
 * Mark a shard as processing (started).
 */
export async function markShardProcessing(
  sb: any,
  packageId: string,
  learningFieldId: string,
  jobId: string,
): Promise<string | null> {
  // Find the shard for this LF (most recent fanout)
  const { data: shard } = await sb
    .from("package_content_shards")
    .select("id")
    .eq("package_id", packageId)
    .eq("learning_field_id", learningFieldId)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!shard) return null;

  await sb
    .from("package_content_shards")
    .update({
      status: "processing",
      claimed_by_job_id: jobId,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", shard.id);

  return shard.id;
}

/**
 * Update shard progress after lesson generation completes.
 */
export async function updateShardAfterLesson(
  sb: any,
  packageId: string,
  learningFieldId: string | null,
  success: boolean,
): Promise<void> {
  if (!learningFieldId) return;

  const { data: shard } = await sb
    .from("package_content_shards")
    .select("id, lesson_generated_count, lesson_failed_count, lesson_target_count")
    .eq("package_id", packageId)
    .eq("learning_field_id", learningFieldId)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!shard) return;

  const newGenerated = (shard.lesson_generated_count ?? 0) + (success ? 1 : 0);
  const newFailed = (shard.lesson_failed_count ?? 0) + (success ? 0 : 1);
  const total = shard.lesson_target_count ?? 0;

  // Auto-complete shard if all lessons are done
  const allDone = total > 0 && (newGenerated + newFailed) >= total;
  const newStatus = allDone
    ? newFailed > 0 && newGenerated === 0
      ? "failed"
      : "completed"
    : "processing";

  await sb.rpc("update_shard_progress", {
    p_shard_id: shard.id,
    p_generated_count: newGenerated,
    p_failed_count: newFailed,
    p_status: newStatus,
    p_error: null,
  });
}

/**
 * Update lesson generation_status after content is persisted.
 */
export async function updateLessonGenerationStatus(
  sb: any,
  lessonId: string,
  status: "generated" | "failed",
  jobId?: string,
): Promise<void> {
  await sb
    .from("lessons")
    .update({
      generation_status: status,
      generation_job_id: jobId ?? null,
    })
    .eq("id", lessonId);
}

/**
 * Get shard summary for a package (for barrier/finalize checks).
 */
export async function getShardSummary(
  sb: any,
  packageId: string,
): Promise<{
  total_shards: number;
  completed: number;
  failed: number;
  pending: number;
  processing: number;
  all_complete: boolean;
  progress_pct: number;
} | null> {
  const { data } = await sb
    .from("v_package_shard_summary")
    .select("*")
    .eq("package_id", packageId)
    .maybeSingle();

  if (!data) return null;

  return {
    total_shards: data.total_shards ?? 0,
    completed: data.completed_shards ?? 0,
    failed: data.failed_shards ?? 0,
    pending: data.pending_shards ?? 0,
    processing: data.processing_shards ?? 0,
    all_complete: data.all_shards_complete ?? false,
    progress_pct: data.overall_progress_pct ?? 0,
  };
}

/**
 * Fanout re-enqueue guard: prevents deadlock loops by checking
 * whether shards are already materialized or in-flight.
 */
export async function shouldSkipFanoutReEnqueue(
  sb: any,
  packageId: string,
): Promise<{ skip: boolean; reason?: string }> {
  // Check if shards already exist
  const { data: shards } = await sb
    .from("package_content_shards")
    .select("status")
    .eq("package_id", packageId);

  const total = shards?.length ?? 0;
  if (total === 0) return { skip: false };

  const pending = (shards ?? []).filter((s: any) => s.status === "pending").length;
  const processing = (shards ?? []).filter((s: any) => s.status === "processing").length;
  const completed = (shards ?? []).filter((s: any) => s.status === "completed").length;
  const failed = (shards ?? []).filter((s: any) => s.status === "failed").length;

  if (pending > 0 || processing > 0) {
    return { skip: true, reason: `shards_in_flight: ${pending} pending, ${processing} processing` };
  }

  if (completed + failed === total) {
    return { skip: true, reason: `fanout_already_materialized: ${completed} completed, ${failed} failed of ${total}` };
  }

  // Check re-enqueue frequency (loop guard)
  const { data: recentJobs } = await sb
    .from("job_queue")
    .select("id")
    .like("job_type", "%fanout_learning_content%")
    .eq("payload->>package_id", packageId)
    .gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

  const recentCount = recentJobs?.length ?? 0;
  if (recentCount >= 3) {
    return { skip: true, reason: `loop_guard: ${recentCount} fanout jobs in last 30min` };
  }

  return { skip: false };
}
