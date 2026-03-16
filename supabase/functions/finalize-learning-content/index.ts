import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { enqueueJob } from "../_shared/enqueue.ts";

/**
 * finalize-learning-content — Hard barrier before downstream.
 *
 * This is the ONLY job that decides "content phase is complete".
 * It checks:
 *   1. All shards in package_content_shards are completed (or skipped)
 *   2. Lesson coverage: all lessons have real content
 *   3. Quality minimum: avg content length thresholds
 *
 * If shards are still processing or have failures:
 *   - Returns retry=true so the runner re-enqueues
 *   - Failed shards get re-enqueued for retry (with retry_count cap)
 *
 * Only when ALL checks pass does it:
 *   - Mark generate_learning_content + finalize_learning_content as done
 *   - Enqueue ALL downstream jobs (minichecks, exam, handbook, oral, tutor)
 *
 * This is the ONLY place downstream gets started.
 */

const MIN_CONTENT_LENGTH = 300;
const COVERAGE_THRESHOLD = 0.90;      // 90% of lessons must have content
const MAX_SHARD_RETRIES = 3;          // Hard cap on per-shard requeues
const STALE_CLAIM_MINUTES = 20;       // Claims older than this are reset

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

/**
 * Enqueue a downstream job only if no active instance exists.
 * Prevents duplicate fan-outs when finalize runs multiple times.
 */
// deno-lint-ignore no-explicit-any
async function enqueueJobOnce(sb: any, opts: Parameters<typeof enqueueJob>[1]): Promise<boolean> {
  const packageId = opts.package_id ?? (opts.payload?.package_id as string);
  if (packageId) {
    const { data: existing } = await sb
      .from("job_queue")
      .select("id")
      .eq("package_id", packageId)
      .eq("job_type", opts.job_type)
      .in("status", ["pending", "queued", "processing", "running", "batch_pending"])
      .limit(1)
      .maybeSingle();

    if (existing) {
      console.log(`[finalize] DEDUP: ${opts.job_type} already active for ${packageId.slice(0, 8)}`);
      return false;
    }

    // Also check if step is already done
    const stepKey = opts.job_type.replace(/^package_/, "").replace(/_/g, "_");
    const { data: step } = await sb
      .from("package_steps")
      .select("status")
      .eq("package_id", packageId)
      .eq("step_key", stepKey)
      .maybeSingle();

    if (step && step.status === "done") {
      console.log(`[finalize] SKIP: step ${stepKey} already done for ${packageId.slice(0, 8)}`);
      return false;
    }
  }

  await enqueueJob(sb, opts);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  await assertSchemaReady("finalize-learning-content", sb);

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  const fanoutId = p.fanout_id;
  const expectedShards = Number(p.expected_shards || 0);

  if (!packageId || !courseId || !fanoutId) {
    return json({ error: "Missing package_id, course_id, or fanout_id" }, 400);
  }

  // ── 1. Check shard progress ──
  const { data: shards, error: shardErr } = await sb
    .from("package_content_shards")
    .select("id, status, learning_field_id, chunk_index, lesson_target_count, lesson_generated_count, last_error, meta")
    .eq("package_id", packageId)
    .eq("fanout_id", fanoutId);

  if (shardErr) {
    return json({ ok: false, retry: true, error: `shard_read_failed: ${shardErr.message}` }, 500);
  }

  // deno-lint-ignore no-explicit-any
  const allShards = (shards || []) as any[];
  const totalShards = allShards.length;

  if (expectedShards > 0 && totalShards < expectedShards) {
    return json({
      ok: true,
      batch_complete: false,
      transient: true,
      message: `Shard rows incomplete: ${totalShards}/${expectedShards}`,
    });
  }

  // deno-lint-ignore no-explicit-any
  const pending = allShards.filter((s: any) => ["pending", "processing", "claimed"].includes(s.status));
  // deno-lint-ignore no-explicit-any
  const failed = allShards.filter((s: any) => s.status === "failed");
  // deno-lint-ignore no-explicit-any
  const completed = allShards.filter((s: any) => s.status === "completed");

  // ── 2. Handle incomplete shards ──
  if (pending.length > 0) {
    return json({
      ok: true,
      batch_complete: false,
      transient: true,
      message: `⏳ ${pending.length} shards still processing/pending`,
      progress: { total: totalShards, completed: completed.length, pending: pending.length, failed: failed.length },
    });
  }

  // ── 3. Handle failed shards — requeue with retry cap ──
  if (failed.length > 0) {
    let requeued = 0;
    let exhausted = 0;

    for (const shard of failed) {
      const retryCount = Number(shard.meta?.retry_count || 0);

      // ── Retry cap: don't requeue permanently broken shards ──
      if (retryCount >= MAX_SHARD_RETRIES) {
        exhausted++;
        console.warn(`[finalize] Shard ${shard.id} exhausted after ${retryCount} retries — leaving failed`);
        continue;
      }

      try {
        // Reset shard to pending with incremented retry_count
        const nextMeta = {
          ...(shard.meta || {}),
          retry_count: retryCount + 1,
          last_requeued_at: new Date().toISOString(),
          last_failure_kind: shard.last_error?.slice(0, 100) || "unknown",
        };

        await sb
          .from("package_content_shards")
          .update({
            status: "pending",
            last_error: null,
            updated_at: new Date().toISOString(),
            meta: nextMeta,
          })
          .eq("id", shard.id);

        // Reset failed lessons in this shard's scope back to pending
        const shardLessonIds = shard.meta?.lesson_ids || [];
        if (shardLessonIds.length > 0) {
          await sb
            .from("lessons")
            .update({ generation_status: "pending", generation_job_id: null, generation_claimed_at: null })
            .in("id", shardLessonIds)
            .in("generation_status", ["failed", "claimed"]);
        }

        // Re-enqueue shard job
        await enqueueJob(sb, {
          job_type: "lesson_generate_content_shard",
          package_id: packageId,
          payload: {
            package_id: packageId,
            course_id: courseId,
            curriculum_id: curriculumId,
            learning_field_id: shard.learning_field_id,
            chunk_index: shard.chunk_index,
            fanout_id: fanoutId,
            lesson_ids: shardLessonIds,
          },
          priority: 12,
          max_attempts: 5,
        });
        requeued++;
      } catch (e) {
        console.warn(`[finalize] requeue failed for shard ${shard.id}: ${(e as Error).message}`);
      }
    }

    // If ALL failed shards are exhausted, we proceed to coverage check anyway
    // (some content is better than blocking forever)
    if (exhausted === failed.length) {
      console.warn(`[finalize] All ${exhausted} failed shards exhausted — proceeding to coverage check`);
      // Fall through to coverage check below
    } else {
      return json({
        ok: true,
        batch_complete: false,
        transient: true,
        message: `♻️ Requeued ${requeued}/${failed.length} failed shards (${exhausted} exhausted)`,
        progress: { total: totalShards, completed: completed.length, pending: 0, failed: failed.length },
        requeued,
        exhausted,
      });
    }
  }

  // ── 4. All shards completed (or exhausted) — validate lesson coverage ──
  const { data: modules } = await sb
    .from("modules")
    .select("id")
    .eq("course_id", courseId);

  // deno-lint-ignore no-explicit-any
  const moduleIds = (modules || []).map((m: any) => m.id);

  if (moduleIds.length === 0) {
    return json({ ok: true, batch_complete: true, message: "No modules — trivially complete" });
  }

  const { data: lessons } = await sb
    .from("lessons")
    .select("id, generation_status, generation_claimed_at, content")
    .in("module_id", moduleIds);

  const totalLessons = lessons?.length || 0;
  const staleThreshold = Date.now() - STALE_CLAIM_MINUTES * 60 * 1000;

  // ── 5. Only reset STALE claims (>20 min old), not active workers ──
  // deno-lint-ignore no-explicit-any
  const staleClaimedLessons = (lessons || []).filter((l: any) => {
    if (l.generation_status !== "claimed") return false;
    if (!l.generation_claimed_at) return true; // no timestamp = definitely stale
    return new Date(l.generation_claimed_at).getTime() < staleThreshold;
  });

  if (staleClaimedLessons.length > 0) {
    await sb
      .from("lessons")
      .update({ generation_status: "pending", generation_job_id: null, generation_claimed_at: null })
      // deno-lint-ignore no-explicit-any
      .in("id", staleClaimedLessons.map((l: any) => l.id));

    return json({
      ok: true,
      batch_complete: false,
      transient: true,
      message: `Reset ${staleClaimedLessons.length} stale claimed lessons (>${STALE_CLAIM_MINUTES}min)`,
    });
  }

  // Check for non-stale active claims — still working, wait
  // deno-lint-ignore no-explicit-any
  const activeClaimedCount = (lessons || []).filter((l: any) => l.generation_status === "claimed").length;
  if (activeClaimedCount > 0) {
    return json({
      ok: true,
      batch_complete: false,
      transient: true,
      message: `⏳ ${activeClaimedCount} lessons still being processed by active workers`,
    });
  }

  // ── 6. Handle failed lessons — try to assign to a shard for healing ──
  // deno-lint-ignore no-explicit-any
  const failedLessons = (lessons || []).filter((l: any) => l.generation_status === "failed");
  if (failedLessons.length > 0) {
    // Check if these failed lessons belong to an exhausted shard
    // If so, accept partial coverage. If not, reset them to pending.
    // deno-lint-ignore no-explicit-any
    const failedLessonIds = failedLessons.map((l: any) => l.id);
    const exhaustedShardLessonIds = new Set<string>();

    for (const shard of allShards) {
      const retryCount = Number(shard.meta?.retry_count || 0);
      if (shard.status === "failed" && retryCount >= MAX_SHARD_RETRIES) {
        for (const lid of (shard.meta?.lesson_ids || [])) {
          exhaustedShardLessonIds.add(lid);
        }
      }
    }

    const healableLessonIds = failedLessonIds.filter((id: string) => !exhaustedShardLessonIds.has(id));
    if (healableLessonIds.length > 0) {
      // Reset orphan failed lessons to pending so next shard retry picks them up
      await sb
        .from("lessons")
        .update({ generation_status: "pending", generation_job_id: null, generation_claimed_at: null })
        .in("id", healableLessonIds);

      return json({
        ok: true,
        batch_complete: false,
        transient: true,
        message: `Reset ${healableLessonIds.length} healable failed lessons to pending`,
      });
    }
    // If all failed lessons are from exhausted shards, accept and proceed
    console.warn(`[finalize] ${failedLessonIds.length} failed lessons from exhausted shards — accepting partial`);
  }

  // ── 7. Coverage check ──
  let withContent = 0;
  let totalLength = 0;

  for (const l of (lessons || [])) {
    const contentStr = typeof l.content === "string"
      ? l.content
      : JSON.stringify(l.content || "");

    const isPlaceholder = l.content?._placeholder === true;
    const len = isPlaceholder ? 0 : contentStr.length;

    if (len >= MIN_CONTENT_LENGTH) {
      withContent++;
      totalLength += len;
    }
  }

  const coverage = totalLessons > 0 ? withContent / totalLessons : 0;
  const avgLength = withContent > 0 ? Math.round(totalLength / withContent) : 0;

  console.log(
    `[finalize] Coverage: ${withContent}/${totalLessons} (${(coverage * 100).toFixed(1)}%), avg_len=${avgLength}`,
  );

  if (coverage < COVERAGE_THRESHOLD) {
    return json({
      ok: true,
      batch_complete: false,
      transient: true,
      message: `Coverage ${(coverage * 100).toFixed(1)}% < ${COVERAGE_THRESHOLD * 100}% threshold`,
      quality: { coverage, avgLength, withContent, total: totalLessons },
    });
  }

  // ── 8. ALL GATES PASSED — Mark steps done & enqueue downstream ──
  console.log(
    `[finalize] ✅ Content phase complete for ${packageId.slice(0, 8)}: ` +
    `${withContent}/${totalLessons} lessons, avg_len=${avgLength}`,
  );

  // Mark fanout_learning_content as done
  await sb
    .from("package_steps")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("package_id", packageId)
    .eq("step_key", "fanout_learning_content");

  // Mark generate_learning_content as done
  await sb
    .from("package_steps")
    .update({
      status: "done",
      updated_at: new Date().toISOString(),
      meta: {
        fanout_id: fanoutId,
        total_shards: totalShards,
        total_lessons: totalLessons,
        good_lessons: withContent,
        avg_length: avgLength,
        finalized_at: new Date().toISOString(),
      },
    })
    .eq("package_id", packageId)
    .eq("step_key", "generate_learning_content");

  // Mark finalize_learning_content as done
  await sb
    .from("package_steps")
    .update({
      status: "done",
      updated_at: new Date().toISOString(),
      meta: {
        fanout_id: fanoutId,
        finalized_at: new Date().toISOString(),
      },
    })
    .eq("package_id", packageId)
    .eq("step_key", "finalize_learning_content");

  // ── 9. Enqueue downstream — deduplicated via enqueueJobOnce ──
  const downstreamJobs = [
    { job_type: "package_generate_lesson_minichecks", priority: 15 },
    { job_type: "package_generate_exam_pool", priority: 15 },
    { job_type: "package_generate_handbook", priority: 16 },
    { job_type: "package_generate_oral_exam", priority: 16 },
    { job_type: "package_build_ai_tutor_index", priority: 16 },
  ];

  let downstreamEnqueued = 0;
  for (const dj of downstreamJobs) {
    try {
      const didEnqueue = await enqueueJobOnce(sb, {
        job_type: dj.job_type,
        package_id: packageId,
        payload: {
          package_id: packageId,
          course_id: courseId,
          curriculum_id: curriculumId,
        },
        priority: dj.priority,
        max_attempts: 5,
      });
      if (didEnqueue) downstreamEnqueued++;
    } catch (e) {
      console.warn(`[finalize] Failed to enqueue ${dj.job_type}: ${(e as Error).message}`);
    }
  }

  return json({
    ok: true,
    batch_complete: true,
    message: `✅ Content finalized: ${withContent}/${totalLessons} lessons, ${downstreamEnqueued} downstream enqueued`,
    fanout_id: fanoutId,
    total_shards: totalShards,
    quality: {
      coverage: Math.round(coverage * 100),
      avgLength,
      withContent,
      total: totalLessons,
    },
    downstream_enqueued: downstreamEnqueued,
  });
});
