import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { calculateHybridTarget, calculateHybridTargetFromDefaults } from "../_shared/hybridExamTarget.ts";

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

    let curriculumId = course?.curriculum_id;
    if (!curriculumId) {
      // Auto-fix: try prebuild-autofix before giving up
      try {
        const afRes = await fetch(`${SUPABASE_URL}/functions/v1/prebuild-autofix`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ package_id: next.id }),
        });
        const afData = await afRes.json();
        if (afData.fixes_applied > 0) {
          // Re-check curriculum after autofix
          const { data: courseRetry } = await sb.from("courses").select("curriculum_id").eq("id", next.course_id).maybeSingle();
          curriculumId = courseRetry?.curriculum_id;
        }
      } catch { /* non-fatal */ }

      if (!curriculumId) {
        // Still no curriculum — revert to queued so it doesn't get stuck in "building"
        await sb.rpc("set_package_status", { p_id: nextId, p_status: "queued" });
        await sb.from("admin_notifications").insert({
          title: `⚠️ Paket ohne Curriculum: ${next.id.slice(0, 8)}`,
          body: `Kurs ${next.course_id} hat kein curriculum_id. Paket zurück in Queue.`,
          category: "ops", severity: "warning",
        });
        return json({ ok: false, error: "No curriculum_id for course " + next.course_id + " (auto-fix attempted)" }, 400);
      }
    }

    // ── HYBRID TARGET ENGINE v3 ──
    let durationMonths: number | null = null;
    let certCatalogData: {
      exam_complexity_score?: number;
      math_ratio?: number;
      oral_component?: boolean;
      learning_field_count?: number;
      certification_level?: string;
    } = {};

    if (curriculumId) {
      const { data: currRow } = await sb.from("curricula").select("beruf_id").eq("id", curriculumId).maybeSingle();
      if (currRow?.beruf_id) {
        const { data: berufRow } = await sb.from("berufe").select("ausbildungsdauer_monate").eq("id", currRow.beruf_id).maybeSingle();
        durationMonths = berufRow?.ausbildungsdauer_monate ?? null;
      }
    }

    // Fetch hybrid fields from certification_catalog
    if (next.certification_id) {
      const { data: catRow } = await sb
        .from("certification_catalog")
        .select("exam_complexity_score, math_ratio, oral_component, learning_field_count, certification_level")
        .eq("linked_certification_id", next.certification_id)
        .maybeSingle();
      if (catRow) certCatalogData = catRow;
    }

    const hybridResult = calculateHybridTarget({
      durationMonths,
      track: 'AUSBILDUNG_VOLL',
      examComplexityScore: certCatalogData.exam_complexity_score ?? 1.0,
      mathRatio: certCatalogData.math_ratio ?? 0.15,
      oralComponent: certCatalogData.oral_component ?? false,
      learningFieldCount: certCatalogData.learning_field_count ?? 0,
      certificationLevel: certCatalogData.certification_level ?? 'ausbildung',
    });

    const dynamicExamTarget = hybridResult.target;

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
          exam_target: dynamicExamTarget,
          ship_target: hybridResult.shipTarget,
          difficulty_distribution: hybridResult.difficultyDistribution,
          question_type_mix: hybridResult.questionTypeMix,
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
        exam_target: dynamicExamTarget,
        ship_target: hybridResult.shipTarget,
        difficulty_distribution: hybridResult.difficultyDistribution,
        question_type_mix: hybridResult.questionTypeMix,
      },
    });

    // Fire without awaiting – build-course-package enqueues jobs and returns fast
    // Use SERVICE_ROLE_KEY for reliability (anon key can be blocked by RLS)
    fetch(buildUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: buildBody,
    }).then(async (res) => {
      if (!res.ok) {
        const errText = await res.text().catch(() => "unknown");
        console.error(`[queue-next] Build returned ${res.status}: ${errText}`);
        // Alert on fire-and-forget failure
        await sb.from("admin_notifications").insert({
          title: `🔴 Build-Start fehlgeschlagen: ${next.id.slice(0, 8)}`,
          body: `HTTP ${res.status}: ${errText.slice(0, 200)}`,
          category: "ops", severity: "error",
          metadata: { package_id: next.id },
        });
      }
    }).catch(async (e) => {
      console.error(`[queue-next] Fire-and-forget build error: ${(e as Error).message}`);
      await sb.from("admin_notifications").insert({
        title: `🔴 Build-Start Netzwerkfehler: ${next.id.slice(0, 8)}`,
        body: (e as Error).message,
        category: "ops", severity: "error",
        metadata: { package_id: next.id },
      });
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
