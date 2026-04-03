import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { enqueueJob } from "../_shared/enqueue.ts";

/**
 * fanout-learning-content — Creates shard records per learning field
 * and enqueues parallel lesson_generate_content_shard jobs.
 *
 * This replaces the old monolithic package_generate_learning_content
 * dispatcher with a structured, trackable fan-out.
 *
 * Flow:
 *   1. Verify scaffold is done
 *   2. Group lessons by learning_field (via modules)
 *   3. Create fanout_id + shard records in package_content_shards
 *   4. Enqueue one lesson_generate_content_shard per learning field
 *   5. Return shard count for step completion tracking
 */

const MAX_LESSONS_PER_SHARD = 30; // Chunk large learning fields

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
  await assertSchemaReady("fanout-learning-content", sb);

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  let courseId = p.course_id;
  let curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;

  if (!packageId) {
    return json({ error: "Missing package_id" }, 400);
  }

  // ── Payload-decoupling: resolve missing identifiers from package ──
  if (!courseId || !curriculumId) {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", packageId)
      .maybeSingle();
    if (!pkg) {
      return json({ error: `Package ${packageId} not found` }, 404);
    }
    curriculumId = curriculumId || pkg.curriculum_id;

    if (!courseId) {
      const { data: course } = await sb
        .from("courses")
        .select("id")
        .eq("curriculum_id", curriculumId)
        .limit(1)
        .maybeSingle();
      if (!course) {
        return json({ error: `No course found for curriculum ${curriculumId}` }, 404);
      }
      courseId = course.id;
    }
    console.log(`[fanout] Resolved from package: course_id=${courseId}, curriculum_id=${curriculumId}`);
  }

  // ── Prereq: scaffold must be done ──
  const { data: scaffoldStep } = await sb
    .from("package_steps")
    .select("status")
    .eq("package_id", packageId)
    .eq("step_key", "scaffold_learning_course")
    .maybeSingle();

  if (scaffoldStep?.status !== "done") {
    return json({
      ok: false,
      retry: true,
      error: "PREREQ_NOT_DONE: scaffold_learning_course",
    }, 409);
  }

  // ── Check for existing active fanout ──
  const { data: existingShards } = await sb
    .from("package_content_shards")
    .select("id, fanout_id, status, learning_field_id, chunk_index, meta")
    .eq("package_id", packageId)
    .in("status", ["pending", "processing", "claimed"]);

  if (existingShards && existingShards.length > 0) {
    const fanoutId = existingShards[0].fanout_id;

    // ── DEADLOCK GUARD: Check if shard jobs actually exist ──
    const { data: activeShardJobs } = await sb
      .from("job_queue")
      .select("id")
      .eq("package_id", packageId)
      .eq("job_type", "lesson_generate_content_shard")
      .in("status", ["pending", "queued", "processing"])
      .limit(1);

    const hasActiveJobs = activeShardJobs && activeShardJobs.length > 0;

    if (hasActiveJobs) {
      // Jobs still running — normal "wait" response
      return json({
        ok: true,
        batch_complete: false,
        message: `Fan-out already active (fanout_id=${fanoutId}, ${existingShards.length} shards active)`,
        fanout_id: fanoutId,
        active_shards: existingShards.length,
      });
    }

    // ── DEADLOCK RECOVERY: Pending shards exist but no jobs → re-enqueue shard jobs ──
    console.warn(
      `[fanout] DEADLOCK_RECOVERY: ${existingShards.length} pending shards but 0 active jobs for package=${packageId.slice(0, 8)} fanout=${fanoutId.slice(0, 8)}`,
    );

    const pendingShards = existingShards.filter((s: any) => s.status === "pending");
    let revived = 0;
    const now = Date.now();

    for (let i = 0; i < pendingShards.length; i++) {
      const shard = pendingShards[i];
      const lessonIds = (shard.meta as any)?.lesson_ids || [];
      try {
        await enqueueJob(sb, {
          job_type: "lesson_generate_content_shard",
          package_id: packageId,
          payload: {
            package_id: packageId,
            course_id: courseId,
            curriculum_id: curriculumId,
            certification_id: certificationId,
            learning_field_id: shard.learning_field_id,
            chunk_index: shard.chunk_index,
            fanout_id: fanoutId,
            lesson_ids: lessonIds,
            revived: true,
          },
          priority: 12,
          run_after: new Date(now + i * 100).toISOString(),
          max_attempts: 5,
        });
        revived++;
      } catch (e) {
        console.error(`[fanout] revive enqueue failed shard=${shard.id}: ${(e as Error).message}`);
      }
    }

    console.log(`[fanout] DEADLOCK_RECOVERY: revived ${revived}/${pendingShards.length} shard jobs`);

    return json({
      ok: true,
      batch_complete: false,
      deadlock_recovery: true,
      revived_shards: revived,
      total_pending: pendingShards.length,
      fanout_id: fanoutId,
    });
  }

  // ── Gather lessons grouped by learning field ──
  const { data: modules } = await sb
    .from("modules")
    .select("id, learning_field_id")
    .eq("course_id", courseId);

  if (!modules || modules.length === 0) {
    return json({ ok: false, error: "No modules found for course" }, 400);
  }

  const moduleIds = modules.map((m: any) => m.id);
  const { data: lessons } = await sb
    .from("lessons")
    .select("id, module_id")
    .in("module_id", moduleIds);

  if (!lessons || lessons.length === 0) {
    return json({ ok: true, batch_complete: true, message: "No lessons to generate" });
  }

  // Build module → learning_field mapping
  const moduleToLF = new Map<string, string>();
  for (const m of modules) {
    moduleToLF.set(m.id, m.learning_field_id || m.id);
  }

  // Group lessons by learning field
  const lfLessons = new Map<string, string[]>();
  for (const l of lessons) {
    const lfId = moduleToLF.get(l.module_id) || l.module_id;
    if (!lfLessons.has(lfId)) lfLessons.set(lfId, []);
    lfLessons.get(lfId)!.push(l.id);
  }

  // ── Create fan-out ──
  const fanoutId = crypto.randomUUID();
  const shardRows: any[] = [];
  const shardJobs: { learningFieldId: string; chunkIndex: number; lessonIds: string[] }[] = [];

  for (const [lfId, lessonIds] of lfLessons) {
    // Chunk large learning fields
    const chunks = Math.ceil(lessonIds.length / MAX_LESSONS_PER_SHARD);

    for (let ci = 0; ci < chunks; ci++) {
      const chunkLessons = lessonIds.slice(ci * MAX_LESSONS_PER_SHARD, (ci + 1) * MAX_LESSONS_PER_SHARD);

      shardRows.push({
        package_id: packageId,
        course_id: courseId,
        learning_field_id: lfId,
        fanout_id: fanoutId,
        chunk_index: ci + 1,
        chunk_count: chunks,
        status: "pending",
        lesson_target_count: chunkLessons.length,
        lesson_generated_count: 0,
        meta: {
          lesson_ids: chunkLessons,
          chunk_size: chunkLessons.length,
          generation_version: 1,
        },
      });

      shardJobs.push({
        learningFieldId: lfId,
        chunkIndex: ci + 1,
        lessonIds: chunkLessons,
      });
    }
  }

  // Insert shard records
  const { error: insertErr } = await sb
    .from("package_content_shards")
    .insert(shardRows);

  if (insertErr) {
    console.error(`[fanout] Failed to insert shards: ${insertErr.message}`);
    return json({ ok: false, error: `shard_insert_failed: ${insertErr.message}` }, 500);
  }

  // ── Enqueue shard jobs (staggered) ──
  let enqueued = 0;
  const errors: string[] = [];
  const now = Date.now();

  for (let i = 0; i < shardJobs.length; i++) {
    const sj = shardJobs[i];
    try {
      await enqueueJob(sb, {
        job_type: "lesson_generate_content_shard",
        package_id: packageId,
        payload: {
          package_id: packageId,
          course_id: courseId,
          curriculum_id: curriculumId,
          certification_id: certificationId,
          learning_field_id: sj.learningFieldId,
          chunk_index: sj.chunkIndex,
          fanout_id: fanoutId,
          lesson_ids: sj.lessonIds,
        },
        priority: 12,
        run_after: new Date(now + i * 50).toISOString(),
        max_attempts: 5,
      });
      enqueued++;
    } catch (e) {
      const msg = (e as Error).message || String(e);
      errors.push(`LF ${sj.learningFieldId.slice(0, 8)}: ${msg.slice(0, 100)}`);
    }
  }

  // ── Enqueue finalize barrier ──
  try {
    await enqueueJob(sb, {
      job_type: "package_finalize_learning_content",
      package_id: packageId,
      payload: {
        package_id: packageId,
        course_id: courseId,
        curriculum_id: curriculumId,
        fanout_id: fanoutId,
        expected_shards: shardJobs.length,
      },
      priority: 10,
      // Run after a delay to give shards time to start
      run_after: new Date(now + 60_000).toISOString(),
      max_attempts: 20, // Will poll repeatedly until all shards done
    });
  } catch (e) {
    console.warn(`[fanout] Failed to enqueue finalize: ${(e as Error).message}`);
  }

  console.log(
    `[fanout] Created ${shardRows.length} shards for ${packageId.slice(0, 8)}, ` +
    `fanout_id=${fanoutId.slice(0, 8)}, enqueued=${enqueued}, errors=${errors.length}`,
  );

  return json({
    ok: true,
    batch_complete: true, // fanout step itself is done
    fanout_id: fanoutId,
    total_shards: shardRows.length,
    total_lessons: lessons.length,
    learning_fields: lfLessons.size,
    enqueued,
    errors: errors.length > 0 ? errors : undefined,
  });
});
