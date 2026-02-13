import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

/**
 * package-queue-next  (Stufe 1: Fire-and-Forget)
 * 
 * Called by pg_cron every minute.
 * Picks the next eligible queued package, sets it to "building",
 * and fires build-course-package WITHOUT waiting for the response.
 * This avoids Edge Function timeouts when the build takes >150s.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // Budget guard
    const { data: budgetRow } = await sb
      .from("llm_budget")
      .select("max_active_packages")
      .limit(1)
      .maybeSingle();
    const maxActive = budgetRow?.max_active_packages ?? 4;

    // Priority-based pick, fallback to standard queue
    let nextId: string | null = null;
    const { data: priorityId } = await sb.rpc("pick_next_package_by_priority", { max_active: maxActive });
    if (priorityId) {
      nextId = priorityId;
    } else {
      const { data: stdId } = await sb.rpc("pick_next_package_to_start", { max_active: maxActive });
      nextId = stdId;
    }

    if (!nextId) {
      const { data: activeCount } = await sb.rpc("get_active_package_count");
      return json({ ok: true, skipped: true, reason: `${activeCount}/${maxActive} active, no eligible queued packages` });
    }

    // Atomically set to building
    await sb.rpc("set_package_status", { p_id: nextId, p_status: "building" });

    const { data: next, error } = await sb
      .from("course_packages")
      .select("id, course_id, certification_id, queue_position")
      .eq("id", nextId)
      .maybeSingle();

    if (error) throw error;
    if (!next) {
      return json({ ok: true, skipped: true, reason: "Package not found after pick" });
    }

    // Find curriculum_id from the course
    const { data: course } = await sb
      .from("courses")
      .select("curriculum_id")
      .eq("id", next.course_id)
      .maybeSingle();

    const curriculumId = course?.curriculum_id;
    if (!curriculumId) {
      return json({ ok: false, error: "No curriculum_id for course " + next.course_id }, 400);
    }

    // Ensure an approved plan exists
    const { data: plan } = await sb
      .from("course_package_plans")
      .select("id")
      .eq("package_id", next.id)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();

    if (!plan) {
      await sb.from("course_package_plans").insert({
        package_id: next.id,
        status: "approved",
        plan: {
          include_learning_course: true,
          include_exam_pool: true,
          include_oral_exam: true,
          include_ai_tutor: true,
          include_handbook: true,
          exam_target: 1000,
        },
      });
    }

    // Ensure council_approved
    await sb
      .from("course_packages")
      .update({ council_approved: true, council_approved_at: new Date().toISOString() })
      .eq("id", next.id);

    // ── STUFE 1: Fire-and-forget ──
    // Instead of awaiting the build response (which can timeout),
    // we fire the request and return immediately.
    const buildUrl = `${SUPABASE_URL}/functions/v1/build-course-package`;
    const buildBody = JSON.stringify({
      packageId: next.id,
      courseId: next.course_id,
      curriculumId,
      certificationId: next.certification_id,
      options: {
        include_learning_course: true,
        include_exam_pool: true,
        include_oral_exam: true,
        include_ai_tutor: true,
        include_handbook: true,
        exam_target: 1000,
      },
    });

    // Fire without awaiting – build-course-package enqueues jobs and returns fast
    fetch(buildUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: buildBody,
    }).catch(e => {
      console.error(`[queue-next] Fire-and-forget build error: ${(e as Error).message}`);
    });

    console.log(`[queue-next] Fired build for package ${next.id} (queue_position=${next.queue_position})`);

    return json({
      ok: true,
      started_package_id: next.id,
      queue_position: next.queue_position,
      mode: "fire_and_forget",
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[queue-next] Error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
