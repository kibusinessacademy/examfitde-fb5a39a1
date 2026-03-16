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
 *   - Failed shards get re-enqueued for retry
 *
 * Only when ALL checks pass does it return batch_complete=true.
 */

const MIN_CONTENT_LENGTH = 500;       // Minimum lesson content length (chars)
const COVERAGE_THRESHOLD = 0.90;      // 90% of lessons must have content
const AVG_LENGTH_THRESHOLD = 800;     // Average content length must exceed

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

  if (!packageId || !courseId || !fanoutId) {
    return json({ error: "Missing package_id, course_id, or fanout_id" }, 400);
  }

  // ── 1. Check shard progress ──
  const { data: shardProgress, error: shardErr } = await sb.rpc("get_shard_progress", {
    p_fanout_id: fanoutId,
  });

  if (shardErr) {
    return json({ ok: false, retry: true, error: `shard_progress_rpc: ${shardErr.message}` }, 500);
  }

  const progress = shardProgress as {
    total_shards: number;
    completed: number;
    failed: number;
    processing: number;
    pending: number;
    all_done: boolean;
    has_failures: boolean;
    total_lessons: number;
    generated_lessons: number;
  };

  console.log(
    `[finalize] Shard progress for ${packageId.slice(0, 8)}: ` +
    `${progress.completed}/${progress.total_shards} done, ` +
    `${progress.failed} failed, ${progress.processing} processing, ${progress.pending} pending`,
  );

  // ── 2. Handle incomplete shards ──
  if (progress.processing > 0 || progress.pending > 0) {
    return json({
      ok: true,
      batch_complete: false,
      transient: true,
      message: `⏳ ${progress.processing} shards processing, ${progress.pending} pending`,
      progress,
    });
  }

  // ── 3. Handle failed shards — requeue them ──
  if (progress.has_failures && progress.failed > 0) {
    const { data: failedShards } = await sb
      .from("package_content_shards")
      .select("id, learning_field_id, chunk_index, meta")
      .eq("fanout_id", fanoutId)
      .eq("status", "failed");

    let requeued = 0;
    for (const shard of (failedShards || [])) {
      try {
        // Reset shard to pending
        await sb
          .from("package_content_shards")
          .update({ status: "pending", last_error: null, updated_at: new Date().toISOString() })
          .eq("id", shard.id);

        // Reset failed lessons in this LF back to pending
        const { data: mods } = await sb
          .from("modules")
          .select("id")
          .eq("course_id", courseId)
          .eq("learning_field_id", shard.learning_field_id);

        if (mods && mods.length > 0) {
          await sb
            .from("lessons")
            .update({ generation_status: "pending", generation_job_id: null, generation_claimed_at: null })
            .in("module_id", mods.map((m: any) => m.id))
            .eq("generation_status", "failed");
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
            lesson_ids: shard.meta?.lesson_ids || [],
          },
          priority: 12,
          max_attempts: 5,
        });
        requeued++;
      } catch (e) {
        console.warn(`[finalize] requeue failed for shard ${shard.id}: ${(e as Error).message}`);
      }
    }

    return json({
      ok: true,
      batch_complete: false,
      transient: true,
      message: `♻️ Requeued ${requeued}/${progress.failed} failed shards`,
      progress,
      requeued,
    });
  }

  // ── 4. All shards completed — validate lesson coverage ──
  const { data: modules } = await sb
    .from("modules")
    .select("id")
    .eq("course_id", courseId);

  const moduleIds = (modules || []).map((m: any) => m.id);

  if (moduleIds.length === 0) {
    return json({ ok: true, batch_complete: true, message: "No modules — trivially complete" });
  }

  // Count total lessons and those with real content
  const { count: totalLessons } = await sb
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .in("module_id", moduleIds);

  const { data: contentStats } = await sb
    .from("lessons")
    .select("id, content")
    .in("module_id", moduleIds);

  let withContent = 0;
  let totalLength = 0;
  let emptyLessons: string[] = [];

  for (const l of (contentStats || [])) {
    const contentStr = typeof l.content === "string"
      ? l.content
      : JSON.stringify(l.content || "");

    const isPlaceholder = l.content?._placeholder === true;
    const len = isPlaceholder ? 0 : contentStr.length;

    if (len >= MIN_CONTENT_LENGTH) {
      withContent++;
      totalLength += len;
    } else {
      emptyLessons.push(l.id);
    }
  }

  const total = totalLessons ?? contentStats?.length ?? 0;
  const coverage = total > 0 ? withContent / total : 0;
  const avgLength = withContent > 0 ? Math.round(totalLength / withContent) : 0;

  const coverageOk = coverage >= COVERAGE_THRESHOLD;
  const avgLengthOk = avgLength >= AVG_LENGTH_THRESHOLD;

  console.log(
    `[finalize] Coverage: ${withContent}/${total} (${(coverage * 100).toFixed(1)}%), ` +
    `avg_len=${avgLength}, empty=${emptyLessons.length}`,
  );

  if (!coverageOk || !avgLengthOk) {
    return json({
      ok: true,
      batch_complete: false,
      transient: true,
      message: `Quality gates not met: coverage=${(coverage * 100).toFixed(1)}% (need ${COVERAGE_THRESHOLD * 100}%), avg_len=${avgLength} (need ${AVG_LENGTH_THRESHOLD})`,
      progress,
      quality: { coverage, avgLength, withContent, total, emptyLessons: emptyLessons.length },
    });
  }

  // ── 5. ALL GATES PASSED — Content phase complete ──
  console.log(
    `[finalize] ✅ Content phase complete for ${packageId.slice(0, 8)}: ` +
    `${withContent}/${total} lessons, avg_len=${avgLength}`,
  );

  return json({
    ok: true,
    batch_complete: true,
    message: `✅ Content phase finalized: ${withContent}/${total} lessons, avg_len=${avgLength}`,
    progress,
    quality: {
      coverage: Math.round(coverage * 100),
      avgLength,
      withContent,
      total,
    },
  });
});
