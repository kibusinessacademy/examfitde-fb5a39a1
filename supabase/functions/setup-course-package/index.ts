import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

/**
 * Setup Course Package – Creates course + package + approved plan for a frozen curriculum.
 * Called by job-runner after generate_curriculum_content has frozen the curriculum.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const body = await req.json().catch(() => ({}));
  const curriculumId = body.curriculum_id || body.curriculumId;

  if (!curriculumId) return json({ error: "curriculum_id required" }, 400);

  try {
    // 1) Check curriculum is frozen (prereq)
    const { data: curr } = await sb
      .from("curricula")
      .select("id, title, beruf_id, status")
      .eq("id", curriculumId)
      .single();

    if (!curr) return json({ error: "Curriculum not found" }, 404);

    if (curr.status !== "frozen") {
      // Prereq not met – signal retry
      return json({ error: "Curriculum not yet frozen", retry: true }, 409);
    }

    // 2) Get beruf name
    const { data: beruf } = await sb
      .from("berufe")
      .select("bezeichnung_kurz")
      .eq("id", curr.beruf_id)
      .single();

    const berufName = beruf?.bezeichnung_kurz || curr.title;

    // 3) Create or get course
    const { data: existingCourse } = await sb
      .from("courses")
      .select("id")
      .eq("curriculum_id", curriculumId)
      .maybeSingle();

    let courseId: string;
    if (existingCourse) {
      courseId = existingCourse.id;
    } else {
      const { data: newCourse, error: courseErr } = await sb
        .from("courses")
        .insert({
          curriculum_id: curriculumId,
          title: berufName,
          description: `Prüfungsvorbereitung für ${berufName}`,
          status: "draft",
        })
        .select("id")
        .single();
      if (courseErr) throw new Error(`Course create: ${courseErr.message}`);
      courseId = newCourse.id;
    }

    // 4) Create or get package
    const { data: existingPkg } = await sb
      .from("course_packages")
      .select("id, status")
      .eq("course_id", courseId)
      .maybeSingle();

    let packageId: string;
    if (existingPkg) {
      packageId = existingPkg.id;
      if (existingPkg.status !== "planning") {
        return json({ message: "Package already exists and is beyond planning", packageId, skipped: true });
      }
    } else {
      const { data: maxQ } = await sb
        .from("course_packages")
        .select("queue_position")
        .order("queue_position", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      const nextPosition = ((maxQ?.queue_position as number) || 0) + 1;

      const { data: newPkg, error: pkgErr } = await sb
        .from("course_packages")
        .insert({
          title: `ExamFit – ${berufName}`,
          course_id: courseId,
          curriculum_id: curriculumId,
          status: "planning",
          queue_position: nextPosition,
          council_approved: true,
          track: "EXAM_FIRST",
          feature_flags: {
            has_learning_course: false,
            has_practice_course_h5p: false,
            has_minichecks: false,
            has_exam_trainer: true,
            has_exam_simulation: true,
            has_oral_exam_trainer: true,
            has_ai_tutor: true,
            has_handbook: false,
            ai_tutor_mode: "limited_exam",
          },
          components: {
            exam_pool: true,
            oral_exam: true,
            ai_tutor: true,
          },
        })
        .select("id")
        .single();
      if (pkgErr) throw new Error(`Package create: ${pkgErr.message}`);
      packageId = newPkg.id;
    }

    // 5) Create approved plan (if none exists)
    const { data: existingPlan } = await sb
      .from("course_package_plans")
      .select("id")
      .eq("package_id", packageId)
      .eq("status", "approved")
      .maybeSingle();

    if (!existingPlan) {
      await sb.from("course_package_plans").insert({
        package_id: packageId,
        version: 1,
        status: "approved",
        decided_by: { system: "batch-pipeline", reason: "auto-approved" },
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

    // 6) Acquire pipeline lock for this package
    const { data: lockRow } = await sb
      .from("pipeline_lock")
      .select("active_package_id")
      .eq("id", 1)
      .single();

    const lockAcquired = !lockRow?.active_package_id;
    if (lockAcquired) {
      await sb
        .from("pipeline_lock")
        .update({ active_package_id: packageId, locked_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() })
        .eq("id", 1);
    }

    // 7) Set to queued (build-course-package will pick it up)
    await sb
      .from("course_packages")
      .update({ status: "queued" })
      .eq("id", packageId)
      .eq("status", "planning");

    console.log(`[SetupPkg] Created package for ${berufName}: ${packageId} (lock: ${lockAcquired ? 'acquired' : 'queued'})`);

    return json({
      success: true,
      packageId,
      courseId,
      beruf: berufName,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SetupPkg] Error: ${msg}`);
    return json({ error: msg }, 500);
  }
});
