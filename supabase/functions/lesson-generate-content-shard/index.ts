import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { isTransientLlmError } from "../_shared/llm/normalize.ts";
import { processLesson } from "../_shared/lesson-gen/process-lesson.ts";

/**
 * lesson-generate-content-shard — Generates content for a single learning field scope.
 *
 * Architecture:
 *   1. Atomically claim lessons via claim_lessons_for_shard RPC
 *   2. Generate content for each claimed lesson (reuses processLesson)
 *   3. Update shard progress in package_content_shards
 *   4. Mark generation_status on each lesson
 *
 * CRITICAL RULES:
 *   - Only touches lessons in its learning_field_id scope
 *   - Never triggers downstream jobs (exam, handbook, etc.)
 *   - Never modifies package status
 *   - Updates only its own shard record
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

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
      return new Response(
        JSON.stringify({ error: "Missing required: package_id, course_id, learning_field_id, fanout_id" }),
        { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    // ── Mark shard as processing ──
    await sb
      .from("package_content_shards")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
        claimed_by_job_id: jobId || null,
        updated_at: new Date().toISOString(),
      })
      .eq("package_id", packageId)
      .eq("learning_field_id", learningFieldId)
      .eq("fanout_id", fanoutId)
      .eq("chunk_index", chunkIndex);

    // ── Atomically claim lessons ──
    const { data: claimedIds, error: claimErr } = await sb.rpc("claim_lessons_for_shard", {
      p_course_id: courseId,
      p_learning_field_id: learningFieldId,
      p_job_id: jobId || crypto.randomUUID(),
      p_limit: 50,
    });

    if (claimErr) {
      console.error(`[shard] claim error: ${claimErr.message}`);
      await updateShardError(sb, packageId, learningFieldId, fanoutId, chunkIndex, claimErr.message);
      return new Response(
        JSON.stringify({ ok: false, error: `claim_failed: ${claimErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    const lessonIds = (claimedIds || []) as string[];

    if (lessonIds.length === 0) {
      // No lessons to claim — might already be generated
      await sb
        .from("package_content_shards")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          meta: { skipped: true, reason: "no_claimable_lessons" },
        })
        .eq("package_id", packageId)
        .eq("learning_field_id", learningFieldId)
        .eq("fanout_id", fanoutId)
        .eq("chunk_index", chunkIndex);

      return new Response(
        JSON.stringify({
          ok: true,
          batch_complete: true,
          generated: 0,
          message: "No claimable lessons in scope",
        }),
        { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    console.log(
      `[shard] Processing ${lessonIds.length} lessons for LF ${learningFieldId.slice(0, 8)} ` +
      `pkg ${packageId.slice(0, 8)} chunk ${chunkIndex}`,
    );

    // ── Process each lesson ──
    let generated = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const lessonId of lessonIds) {
      try {
        // Load lesson data
        const { data: lesson } = await sb
          .from("lessons")
          .select("id, title, module_id, competency_id, step, content")
          .eq("id", lessonId)
          .single();

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
        }, startMs);

        // Parse result to check success
        const resBody = await result.json().catch(() => ({}));
        if (result.ok && resBody.ok !== false) {
          await markLessonStatus(sb, lessonId, "generated");
          generated++;
        } else {
          await markLessonStatus(sb, lessonId, "failed");
          failed++;
          errors.push(`${lessonId.slice(0, 8)}: ${(resBody.error || "unknown").slice(0, 100)}`);
        }

        // Update shard progress periodically
        if ((generated + failed) % 5 === 0) {
          await updateShardProgress(sb, packageId, learningFieldId, fanoutId, chunkIndex, generated);
        }
      } catch (e) {
        await markLessonStatus(sb, lessonId, "failed");
        failed++;
        errors.push(`${lessonId.slice(0, 8)}: ${((e as Error).message || String(e)).slice(0, 100)}`);
      }
    }

    // ── Update shard final status ──
    const shardStatus = failed > 0 && generated === 0 ? "failed" : "completed";
    await sb
      .from("package_content_shards")
      .update({
        status: shardStatus,
        lesson_generated_count: generated,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: errors.length > 0 ? errors.slice(0, 3).join("; ") : null,
        meta: {
          generated,
          failed,
          total_claimed: lessonIds.length,
          elapsed_ms: Date.now() - startMs,
        },
      })
      .eq("package_id", packageId)
      .eq("learning_field_id", learningFieldId)
      .eq("fanout_id", fanoutId)
      .eq("chunk_index", chunkIndex);

    console.log(
      `[shard] Done: LF ${learningFieldId.slice(0, 8)} — ${generated}/${lessonIds.length} generated, ` +
      `${failed} failed, ${Date.now() - startMs}ms`,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        batch_complete: true,
        generated,
        failed,
        total: lessonIds.length,
        elapsed_ms: Date.now() - startMs,
      }),
      { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  } catch (outerErr) {
    const msg = (outerErr as Error).message || String(outerErr);
    const isTransient = isTransientLlmError(outerErr) ||
      msg.includes("timeout") || msg.includes("AbortError");
    console.error(`[shard] UNHANDLED: ${msg.slice(0, 300)}`);
    return new Response(
      JSON.stringify({
        ok: false,
        retry: isTransient,
        transient: isTransient,
        error: `UNHANDLED: ${msg.slice(0, 200)}`,
        elapsed_ms: Date.now() - startMs,
      }),
      { status: isTransient ? 503 : 500, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }
});

// ── Helpers ──

async function markLessonStatus(sb: any, lessonId: string, status: string) {
  await sb
    .from("lessons")
    .update({ generation_status: status })
    .eq("id", lessonId);
}

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
