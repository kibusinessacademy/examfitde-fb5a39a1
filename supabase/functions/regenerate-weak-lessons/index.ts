import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * regenerate-weak-lessons — Selective Re-Run
 *
 * Resets lessons in specified modules back to placeholder state,
 * marks old content_versions as "superseded", and resets the
 * pipeline step so generate-learning-content picks them up again.
 *
 * Body: { courseId, moduleIds: string[], packageId }
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { courseId, moduleIds, packageId } = await req.json().catch(() => ({} as any));

  if (!courseId || !moduleIds?.length || !packageId) {
    return json({ error: "courseId, moduleIds[], packageId required" }, 400);
  }

  try {
    // 1. Find all lesson IDs in target modules
    const { data: lessons, error: lErr } = await sb
      .from("lessons")
      .select("id, title, step")
      .in("module_id", moduleIds);

    if (lErr) throw lErr;
    if (!lessons?.length) return json({ error: "No lessons found in target modules" }, 404);

    const lessonIds = lessons.map((l: any) => l.id);
    console.log(`[regenerate-weak] Found ${lessonIds.length} lessons to reset in ${moduleIds.length} modules`);

    // 2. Mark old content_versions as superseded (batch of 100)
    let superseded = 0;
    for (let i = 0; i < lessonIds.length; i += 100) {
      const chunk = lessonIds.slice(i, i + 100);
      const { count } = await sb
        .from("content_versions")
        .update({ status: "superseded" })
        .in("lesson_id", chunk)
        .neq("status", "superseded")
        .select("id", { count: "exact", head: true });
      superseded += count ?? 0;
    }
    console.log(`[regenerate-weak] Superseded ${superseded} old content_versions`);

    // 3. Reset lesson content to placeholder via individual RPC calls (batch of 100)
    let reset = 0;
    for (let i = 0; i < lessonIds.length; i += 100) {
      const chunk = lessonIds.slice(i, i + 100);
      for (const lid of chunk) {
        try {
          await sb.rpc("pipeline_write_lesson_content_v2" as any, {
            p_lesson_id: lid,
            p_content: { _placeholder: true, _regenerating: true, reset_at: new Date().toISOString() },
            p_source: 'regenerate-weak-lessons',
          });
          reset++;
        } catch (e: any) {
          console.warn(`Reset failed for ${lid}: ${e.message}`);
        }
      }
    }
    console.log(`[regenerate-weak] Reset ${reset} lessons to placeholder`);

    // 4. Reset pipeline step to trigger re-processing
    await sb
      .from("package_steps")
      .update({ status: "pending", started_at: null, completed_at: null, error: null, attempts: 0 })
      .eq("package_id", packageId)
      .eq("step_key", "generate_learning_content");

    await sb
      .from("course_package_build_steps")
      .update({ status: "pending", started_at: null, completed_at: null, error: null })
      .eq("package_id", packageId)
      .eq("step_key", "generate_learning_content");

    // 5. Also reset downstream steps that depend on content
    const downstreamSteps = [
      "validate_learning_content",
      "generate_exam_pool",
      "validate_exam_pool",
      "build_ai_tutor_index",
      "quality_council",
      "auto_publish",
    ];
    for (const step of downstreamSteps) {
      await sb
        .from("package_steps")
        .update({ status: "pending", started_at: null, completed_at: null, error: null, attempts: 0 })
        .eq("package_id", packageId)
        .eq("step_key", step);
    }

    // 6. Set package back to "building" so pipeline picks it up
    await sb
      .from("course_packages")
      .update({ status: "building" })
      .eq("id", packageId);

    return json({
      ok: true,
      lessonsReset: lessonIds.length,
      contentVersionsSuperseded: superseded,
      modulesAffected: moduleIds.length,
      nextStep: "Pipeline will auto-regenerate on next pipeline-runner cycle",
      moduleDetails: moduleIds.map((mid: string) => {
        const count = lessons.filter((l: any) => l.module_id === mid).length;
        return { moduleId: mid, lessonCount: count };
      }),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[regenerate-weak] Error:", msg);
    return json({ error: msg }, 500);
  }
});
