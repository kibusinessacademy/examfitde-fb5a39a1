import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * Backfill Council Versions
 * 
 * Creates initial content_versions from existing published lesson content,
 * so all legacy content is tracked in the Council pipeline.
 * 
 * POST { courseId?: string, dryRun?: boolean }
 * - courseId: specific course, or omit for all courses
 * - dryRun: preview without writing
 */

const STEP_MAP: Record<string, string> = {
  einstieg: "step_1_introduction",
  verstehen: "step_2_understanding",
  anwenden: "step_3_application",
  wiederholen: "step_4_repetition",
  mini_check: "step_5_minicheck",
};

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { courseId, dryRun = false } = await req.json().catch(() => ({}));

    // Get lessons with content but no content_versions yet
    let query = supabase
      .from("lessons")
      .select("id, step, content, module_id, modules!inner(course_id)")
      .not("content", "is", null);

    if (courseId) {
      query = query.eq("modules.course_id", courseId);
    }

    const { data: lessons, error: lessonErr } = await query.limit(1000);
    if (lessonErr) throw lessonErr;

    // Find which lessons already have content_versions
    const lessonIds = (lessons || []).map((l: { id: string }) => l.id);
    const { data: existingVersions } = await supabase
      .from("content_versions")
      .select("lesson_id, step_key")
      .in("lesson_id", lessonIds.length > 0 ? lessonIds : ["__none__"]);

    const existingSet = new Set(
      (existingVersions || []).map(
        (v: { lesson_id: string; step_key: string }) => `${v.lesson_id}:${v.step_key}`
      )
    );

    // Filter to lessons without versions
    const toBackfill = (lessons || []).filter((l: { id: string; step: string }) => {
      const stepKey = STEP_MAP[l.step] || l.step;
      return !existingSet.has(`${l.id}:${stepKey}`);
    });

    if (dryRun) {
      return new Response(
        JSON.stringify({
          dryRun: true,
          totalLessons: lessons?.length || 0,
          alreadyVersioned: existingVersions?.length || 0,
          toBackfill: toBackfill.length,
        }),
        { headers: jsonHeaders }
      );
    }

    let created = 0;
    let skipped = 0;

    for (const lesson of toBackfill) {
      const stepKey = STEP_MAP[lesson.step] || lesson.step;
      const entityType = lesson.step === "mini_check" ? "minicheck" : "lesson_step";

      const { error } = await supabase.from("content_versions").insert({
        lesson_id: lesson.id,
        step_key: stepKey,
        content_json: lesson.content,
        status: "approved", // Legacy content is grandfathered as approved
        entity_type: entityType,
        created_by: "backfill-script",
        council_round: 0,
      });

      if (error) {
        skipped++;
        console.warn(`[Backfill] Skip ${lesson.id}/${stepKey}: ${error.message}`);
      } else {
        created++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        created,
        skipped,
        totalProcessed: toBackfill.length,
        message: `✅ ${created} content_versions erstellt für bestehende Inhalte.`,
      }),
      { headers: jsonHeaders }
    );
  } catch (error) {
    console.error("[Backfill] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" } }
    );
  }
});
