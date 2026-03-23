import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const job = body?.job;
    if (!job?.id || !job?.payload?.lesson_id) {
      return json({ error: "Missing job or lesson_id" }, 400);
    }

    const lessonId = job.payload.lesson_id as string;
    const packageId = job.package_id as string | null;

    // Mark job as running
    await sb.from("job_queue")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", job.id);

    // Load lesson
    const { data: lesson, error: lessonErr } = await sb
      .from("lessons")
      .select("id, title, content, needs_regen, qc_status")
      .eq("id", lessonId)
      .maybeSingle();

    if (lessonErr) throw lessonErr;
    if (!lesson) {
      await sb.from("job_queue").update({
        status: "failed",
        updated_at: new Date().toISOString(),
        last_error: `Lesson not found: ${lessonId}`,
      }).eq("id", job.id);
      return json({ ok: false, error: `Lesson not found: ${lessonId}` });
    }

    const content = typeof lesson.content === "string" ? lesson.content.trim() : "";

    // Case 1: Content exists and is non-empty → clear needs_regen flag
    if (content.length > 0 && lesson.qc_status !== "tier1_failed") {
      await sb.from("lessons").update({
        needs_regen: false,
        updated_at: new Date().toISOString(),
      }).eq("id", lessonId);

      await sb.from("job_queue").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      return json({
        ok: true,
        repaired: true,
        mode: "clear_flag_only",
        lesson_id: lessonId,
        package_id: packageId,
      });
    }

    // Case 2: Content empty or tier1_failed → escalate, don't loop
    await sb.from("job_queue").update({
      status: "failed",
      updated_at: new Date().toISOString(),
      last_error: content.length === 0
        ? "LESSON_CONTENT_EMPTY_REQUIRES_EXPLICIT_REGEN"
        : "LESSON_TIER1_FAILED_REQUIRES_REGEN",
    }).eq("id", job.id);

    return json({
      ok: false,
      repaired: false,
      escalated: true,
      reason: content.length === 0
        ? "LESSON_CONTENT_EMPTY_REQUIRES_EXPLICIT_REGEN"
        : "LESSON_TIER1_FAILED_REQUIRES_REGEN",
      lesson_id: lessonId,
      package_id: packageId,
    });
  } catch (err) {
    console.error("[lesson-regen-repair]", err);
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
