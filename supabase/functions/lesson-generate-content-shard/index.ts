import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { isTransientLlmError } from "../_shared/llm/normalize.ts";
import { processLesson } from "../_shared/lesson-gen/process-lesson.ts";

/**
 * lesson-generate-content-shard — Generates content for a chunk of lessons
 * within a single learning field scope.
 *
 * CRITICAL RULES:
 *   - Only touches lessons listed in payload.lesson_ids (chunk-scoped)
 *   - Uses claim_lessons_for_shard(p_lesson_ids, p_job_id) — NO limit-based claiming
 *   - Skips lessons that already have usable content (>= 300 chars)
 *   - Never triggers downstream jobs (exam, handbook, etc.)
 *   - Never modifies package status
 *   - Updates only its own shard record
 *   - Meta updates use merge, not overwrite
 */

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

/** Check if lesson already has usable content (skip regeneration) */
function hasUsableContent(content: unknown): boolean {
  if (content == null) return false;
  if (typeof content === "object" && (content as Record<string, unknown>)?._placeholder === true) return false;
  const txt = typeof content === "string" ? content : JSON.stringify(content);
  const normalized = txt.trim();
  if (!normalized || normalized === "null" || normalized === "{}" || normalized === "[]") return false;
  if (normalized.includes("_placeholder")) return false;
  return normalized.length >= 300;
}

// ── Shard helpers ──

// deno-lint-ignore no-explicit-any
async function updateShardProgress(
  sb: any, packageId: string, lfId: string, fanoutId: string, chunk: number, generated: number,
) {
  await sb
    .from("package_content_shards")
    .update({ lesson_generated_count: generated, updated_at: new Date().toISOString() })
    .eq("package_id", packageId)
    .eq("learning_field_id", lfId)
    .eq("fanout_id", fanoutId)
    .eq("chunk_index", chunk);
}

// deno-lint-ignore no-explicit-any
async function updateShardError(
  sb: any, packageId: string, lfId: string, fanoutId: string, chunk: number, error: string,
) {
  await sb
    .from("package_content_shards")
    .update({
      status: "failed",
      last_error: error.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("package_id", packageId)
    .eq("learning_field_id", lfId)
    .eq("fanout_id", fanoutId)
    .eq("chunk_index", chunk);
}

// deno-lint-ignore no-explicit-any
async function mergeShardMeta(
  sb: any, packageId: string, lfId: string, fanoutId: string, chunk: number,
  patch: Record<string, unknown>,
) {
  // Use atomic JSONB merge RPC to avoid read-modify-write race conditions
  const { error } = await sb.rpc("merge_package_content_shard_meta", {
    p_package_id: packageId,
    p_learning_field_id: lfId,
    p_fanout_id: fanoutId,
    p_chunk_index: chunk,
    p_patch: patch,
  });
  if (error) {
    console.warn(`[shard] mergeShardMeta RPC failed, falling back: ${error.message}`);
    // Fallback: non-atomic merge (better than nothing)
    const { data: row } = await sb
      .from("package_content_shards")
      .select("meta")
      .eq("package_id", packageId)
      .eq("learning_field_id", lfId)
      .eq("fanout_id", fanoutId)
      .eq("chunk_index", chunk)
      .maybeSingle();
    await sb
      .from("package_content_shards")
      .update({ meta: { ...(row?.meta || {}), ...patch }, updated_at: new Date().toISOString() })
      .eq("package_id", packageId)
      .eq("learning_field_id", lfId)
      .eq("fanout_id", fanoutId)
      .eq("chunk_index", chunk);
  }
}

// deno-lint-ignore no-explicit-any
async function markLessonStatus(sb: any, lessonId: string, status: string) {
  const patch: Record<string, unknown> = { generation_status: status };
  // Clear claim fields when transitioning away from "claimed"
  if (status === "generated" || status === "failed" || status === "pending") {
    patch.generation_job_id = null;
    patch.generation_claimed_at = null;
  }
  await sb.from("lessons").update(patch).eq("id", lessonId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const startMs = Date.now();
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await assertSchemaReady("lesson-generate-content-shard", sb);

    const body = await req.json().catch(() => ({}));
    const p = body.payload || body;

    const packageId = p.package_id;
    const courseId = p.course_id;
    const curriculumId = p.curriculum_id;
    const learningFieldId = p.learning_field_id;
    const fanoutId = p.fanout_id;
    const chunkIndex = p.chunk_index || 1;
    const jobId = p.job_id || body.job_id;

    if (!packageId || !courseId || !learningFieldId || !fanoutId) {
      return json({ error: "Missing required: package_id, course_id, learning_field_id, fanout_id" }, 400);
    }

    // ── Validate lesson_ids from payload (chunk-scoped) ──
    const lessonIdsFromPayload: string[] = Array.isArray(p.lesson_ids) ? p.lesson_ids : [];

    if (lessonIdsFromPayload.length === 0) {
      await updateShardError(sb, packageId, learningFieldId, fanoutId, chunkIndex,
        "missing lesson_ids in shard payload");
      return json({ ok: false, error: "Missing lesson_ids in shard payload" }, 400);
    }

    // ── Unified claimJobId — used everywhere for consistency ──
    const claimJobId = jobId || crypto.randomUUID();

    // ── Mark shard as processing ──
    await sb
      .from("package_content_shards")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
        claimed_by_job_id: claimJobId,
        updated_at: new Date().toISOString(),
      })
      .eq("package_id", packageId)
      .eq("learning_field_id", learningFieldId)
      .eq("fanout_id", fanoutId)
      .eq("chunk_index", chunkIndex);

    // ── Atomically claim lessons (chunk-scoped via lesson_ids) ──
    const { data: claimedIds, error: claimErr } = await sb.rpc("claim_lessons_for_shard", {
      p_lesson_ids: lessonIdsFromPayload,
      p_job_id: claimJobId,
    });

    if (claimErr) {
      console.error(`[shard] claim error: ${claimErr.message}`);
      await updateShardError(sb, packageId, learningFieldId, fanoutId, chunkIndex, claimErr.message);
      return json({ ok: false, error: `claim_failed: ${claimErr.message}` }, 500);
    }

    const claimedLessonIds = ((claimedIds || []) as { id: string }[]).map(r => r.id);

    // ── Load lesson data for all payload lessons ──
    const { data: allLessonsRaw } = await sb
      .from("lessons")
      .select("id, title, module_id, competency_id, step, content, generation_status")
      .in("id", lessonIdsFromPayload);

    // Build Map for O(1) lookups instead of O(n²) .find() in loop
    // deno-lint-ignore no-explicit-any
    const lessonMap = new Map((allLessonsRaw || []).map((l: any) => [l.id, l]));

    // Check which lessons already have usable content
    let skippedWithContent = 0;
    const lessonsToGenerate: string[] = [];

    for (const [, lesson] of lessonMap) {
      if (hasUsableContent(lesson.content) && lesson.generation_status !== "failed") {
        // Already has good content — mark as generated + clear stale claim fields
        await sb
          .from("lessons")
          .update({ generation_status: "generated", generation_job_id: null, generation_claimed_at: null })
          .eq("id", lesson.id);
        skippedWithContent++;
      } else if (claimedLessonIds.includes(lesson.id)) {
        lessonsToGenerate.push(lesson.id);
      }
    }

    if (lessonsToGenerate.length === 0 && skippedWithContent > 0) {
      await mergeShardMeta(sb, packageId, learningFieldId, fanoutId, chunkIndex, {
        skipped_with_content: skippedWithContent,
        generated: 0,
        elapsed_ms: Date.now() - startMs,
      });

      await sb
        .from("package_content_shards")
        .update({
          status: "completed",
          lesson_generated_count: skippedWithContent,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("package_id", packageId)
        .eq("learning_field_id", learningFieldId)
        .eq("fanout_id", fanoutId)
        .eq("chunk_index", chunkIndex);

      return json({
        ok: true,
        batch_complete: true,
        generated: 0,
        skipped_with_content: skippedWithContent,
        message: "All lessons already have usable content",
      });
    }

    if (lessonsToGenerate.length === 0) {
      await mergeShardMeta(sb, packageId, learningFieldId, fanoutId, chunkIndex, {
        skipped: true,
        reason: "no_claimable_lessons",
      });

      await sb
        .from("package_content_shards")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("package_id", packageId)
        .eq("learning_field_id", learningFieldId)
        .eq("fanout_id", fanoutId)
        .eq("chunk_index", chunkIndex);

      return json({
        ok: true,
        batch_complete: true,
        generated: 0,
        message: "No claimable lessons in scope",
      });
    }

    console.log(
      `[shard] Processing ${lessonsToGenerate.length} lessons (${skippedWithContent} skipped) ` +
      `for LF ${learningFieldId.slice(0, 8)} pkg ${packageId.slice(0, 8)} chunk ${chunkIndex}`,
    );

    // ── Process each lesson ──
    let generated = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const lessonId of lessonsToGenerate) {
      try {
        const lesson = lessonMap.get(lessonId);
        if (!lesson) {
          await markLessonStatus(sb, lessonId, "failed");
          failed++;
          continue;
        }

        // Use the shared processLesson function
        const result = await processLesson(sb, {
          lesson_id: lessonId,
          package_id: packageId,
          course_id: courseId,
          curriculum_id: curriculumId,
          certification_id: p.certification_id || null,
          competency_id: lesson.competency_id,
          learning_field_id: learningFieldId,
          step_key: lesson.step || "verstehen",
        }, startMs);

        // processLesson returns a Response — safely check result
        if (result && typeof result === "object") {
          let resOk = false;
          if (result instanceof Response) {
            try {
              const resBody = await result.clone().json();
              resOk = result.ok && resBody.ok !== false;
              if (!resOk) {
                errors.push(`${lessonId.slice(0, 8)}: ${(resBody.error || "unknown").slice(0, 100)}`);
              }
            } catch {
              resOk = result.ok;
            }
          } else {
            // deno-lint-ignore no-explicit-any
            resOk = (result as any).ok !== false;
          }

          if (resOk) {
            await markLessonStatus(sb, lessonId, "generated");
            generated++;
          } else {
            await markLessonStatus(sb, lessonId, "failed");
            failed++;
          }
        } else {
          await markLessonStatus(sb, lessonId, "failed");
          failed++;
          errors.push(`${lessonId.slice(0, 8)}: processLesson returned invalid result`);
        }

        // Update shard progress periodically
        if ((generated + failed) % 5 === 0) {
          await updateShardProgress(sb, packageId, learningFieldId, fanoutId, chunkIndex,
            generated + skippedWithContent);
        }
      } catch (e) {
        await markLessonStatus(sb, lessonId, "failed");
        failed++;
        errors.push(`${lessonId.slice(0, 8)}: ${((e as Error).message || String(e)).slice(0, 100)}`);
      }
    }

    // ── Update shard final status ──
    const totalGenerated = generated + skippedWithContent;
    const shardStatus = failed > 0 && generated === 0 ? "failed" : "completed";

    await mergeShardMeta(sb, packageId, learningFieldId, fanoutId, chunkIndex, {
      generated,
      failed,
      skipped_with_content: skippedWithContent,
      total_claimed: lessonsToGenerate.length,
      elapsed_ms: Date.now() - startMs,
    });

    await sb
      .from("package_content_shards")
      .update({
        status: shardStatus,
        lesson_generated_count: totalGenerated,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: errors.length > 0 ? errors.slice(0, 3).join("; ") : null,
      })
      .eq("package_id", packageId)
      .eq("learning_field_id", learningFieldId)
      .eq("fanout_id", fanoutId)
      .eq("chunk_index", chunkIndex);

    // ── Auto-reconcile package progress from artifact SSOT ──
    if (generated > 0) {
      try {
        await sb.rpc("reconcile_package_progress", { p_package_id: packageId });
        console.log(`[shard] Progress reconciled for ${packageId.slice(0, 8)}`);
      } catch (reconcileErr) {
        console.warn(`[shard] reconcile_package_progress failed (non-fatal): ${(reconcileErr as Error)?.message?.slice(0, 100)}`);
      }
    }

    console.log(
      `[shard] Done: LF ${learningFieldId.slice(0, 8)} — ${generated}/${lessonsToGenerate.length} generated, ` +
      `${skippedWithContent} skipped, ${failed} failed, ${Date.now() - startMs}ms`,
    );

    return json({
      ok: true,
      batch_complete: true,
      generated,
      skipped_with_content: skippedWithContent,
      failed,
      total: lessonIdsFromPayload.length,
      elapsed_ms: Date.now() - startMs,
    });
  } catch (outerErr) {
    const msg = (outerErr as Error).message || String(outerErr);
    const isTransient = isTransientLlmError(outerErr) ||
      msg.includes("timeout") || msg.includes("AbortError");
    console.error(`[shard] UNHANDLED: ${msg.slice(0, 300)}`);
    return json({
      ok: false,
      retry: isTransient,
      transient: isTransient,
      error: `UNHANDLED: ${msg.slice(0, 200)}`,
      elapsed_ms: Date.now() - startMs,
    }, isTransient ? 503 : 500);
  }
});
