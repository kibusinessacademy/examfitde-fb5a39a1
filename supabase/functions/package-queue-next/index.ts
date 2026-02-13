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
 * package-queue-next
 * Called after a package finishes (auto_publish done).
 * Finds the next queued package and invokes build-course-package for it.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Use completion-first RPC with aging
    const { data: budgetRow } = await sb
      .from("llm_budget")
      .select("max_active_packages")
      .limit(1)
      .maybeSingle();
    const maxActive = budgetRow?.max_active_packages ?? 4;

    const { data: nextId } = await sb.rpc("pick_next_package_to_start", { max_active: maxActive });

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
      // Auto-create an approved plan
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

    // Invoke build-course-package
    const { data: buildResult, error: buildErr } = await sb.functions.invoke(
      "build-course-package",
      {
        body: {
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
        },
      }
    );

    if (buildErr) throw buildErr;

    console.log(`[queue-next] Started build for package ${next.id} (queue_position=${next.queue_position})`);

    return json({
      ok: true,
      started_package_id: next.id,
      queue_position: next.queue_position,
      build: buildResult,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[queue-next] Error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
