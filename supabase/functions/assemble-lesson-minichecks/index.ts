import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * assemble-lesson-minichecks
 *
 * For a given curriculum (or course), iterates all mini_check lessons,
 * calls assemble_minicheck_weighted RPC per lesson, then optionally
 * runs a publish gate to auto-publish passing sets.
 *
 * POST { curriculum_id, questions_per_set?: number, auto_publish?: boolean }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;
  const curriculumId = p?.curriculum_id as string;
  const questionsPerSet = p?.questions_per_set ?? 8;
  const autoPublish = p?.auto_publish ?? true;

  if (!curriculumId || !UUID_RE.test(curriculumId)) {
    return json({ error: "curriculum_id required (UUID)" }, 400);
  }

  const startTime = Date.now();

  try {
    // 1. Find the course for this curriculum
    const { data: course, error: courseErr } = await sb
      .from("courses")
      .select("id")
      .eq("curriculum_id", curriculumId)
      .limit(1)
      .maybeSingle();

    if (courseErr || !course) {
      return json({ error: "No course found for curriculum", detail: courseErr?.message }, 404);
    }

    const courseId = course.id;

    // 2. Get all mini_check step lessons for this course
    const { data: modules } = await sb
      .from("modules")
      .select("id")
      .eq("course_id", courseId);

    const moduleIds = (modules || []).map((m: any) => m.id);
    if (moduleIds.length === 0) {
      return json({ error: "No modules found" }, 404);
    }

    const { data: lessons } = await sb
      .from("lessons")
      .select("id, title, competency_id")
      .in("module_id", moduleIds)
      .eq("step", "mini_check")
      .order("sort_order", { ascending: true });

    if (!lessons?.length) {
      return json({ error: "No mini_check lessons found", module_count: moduleIds.length }, 404);
    }

    // 3. Check which already have sets
    const lessonIds = lessons.map((l: any) => l.id);
    const { data: existingSets } = await sb
      .from("minicheck_sets")
      .select("lesson_id")
      .in("lesson_id", lessonIds);
    const existingSet = new Set((existingSets || []).map((s: any) => s.lesson_id));

    // 4. Assemble each missing set via RPC
    let assembled = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ lesson_id: string; error: string }> = [];

    for (const lesson of lessons) {
      if (existingSet.has(lesson.id)) {
        skipped++;
        continue;
      }

      const { data: setId, error: rpcErr } = await sb.rpc(
        "assemble_minicheck_weighted",
        {
          p_lesson_id: lesson.id,
          p_course_id: courseId,
          p_questions: questionsPerSet,
        }
      );

      if (rpcErr) {
        failed++;
        errors.push({ lesson_id: lesson.id, error: rpcErr.message });
        console.warn(`[AssembleMC] Failed ${lesson.id}: ${rpcErr.message}`);
      } else {
        assembled++;
      }

      // Budget guard: 55s max
      if (Date.now() - startTime > 55_000) {
        console.log(`[AssembleMC] Time budget hit after ${assembled} assembled`);
        break;
      }
    }

    // 5. Auto-publish gate: check each under_review set
    let published = 0;
    let gateBlocked = 0;

    if (autoPublish) {
      const { data: reviewSets } = await sb
        .from("minicheck_sets")
        .select("id, lesson_id, question_count")
        .eq("course_id", courseId)
        .eq("status", "under_review");

      for (const s of reviewSets || []) {
        // Gate: min questions, check items have elite annotations
        if ((s.question_count || 0) < 3) {
          gateBlocked++;
          continue;
        }

        // Check elite quality of items
        const { data: items } = await sb
          .from("minicheck_set_items")
          .select("exam_question_id")
          .eq("minicheck_set_id", s.id);

        if (!items?.length) {
          gateBlocked++;
          continue;
        }

        const qIds = items.map((i: any) => i.exam_question_id);
        const { data: annotations } = await sb
          .from("exam_question_elite_annotations")
          .select("elite_level, elite_score")
          .in("question_id", qIds);

        const annots = annotations || [];
        const eliteCount = annots.filter(
          (a: any) => a.elite_level === "elite" || a.elite_level === "advanced"
        ).length;
        const avgScore =
          annots.length > 0
            ? annots.reduce((sum: number, a: any) => sum + (a.elite_score || 0), 0) /
              annots.length
            : 0;

        // Gate rules: >=60% elite/advanced, avg_score >= 8.0
        const elitePct = annots.length > 0 ? eliteCount / annots.length : 0;
        if (elitePct >= 0.6 && avgScore >= 8.0) {
          await sb
            .from("minicheck_sets")
            .update({ status: "approved", updated_at: new Date().toISOString() })
            .eq("id", s.id);
          published++;
        } else {
          gateBlocked++;
          console.log(
            `[AssembleMC] Gate blocked set ${s.id}: elite=${(elitePct * 100).toFixed(0)}%, avg=${avgScore.toFixed(1)}`
          );
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[AssembleMC] ✅ Done: ${assembled} assembled, ${skipped} skipped, ${published} published, ${gateBlocked} blocked, ${elapsed}ms`
    );

    return json({
      ok: true,
      curriculum_id: curriculumId,
      course_id: courseId,
      total_lessons: lessons.length,
      assembled,
      skipped,
      failed,
      published,
      gate_blocked: gateBlocked,
      elapsed_ms: elapsed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[AssembleMC] FATAL: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});
