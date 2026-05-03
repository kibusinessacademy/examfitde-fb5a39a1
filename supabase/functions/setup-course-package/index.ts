import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { jsonOk, jsonDomainError } from "../_shared/domain-errors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Setup Course Package – Creates course + package + approved plan for a frozen curriculum.
 * Priority is resolved from beruf_market_data SSOT (v_beruf_priority view).
 */

/** Resolve package priority from market SSOT. Falls back to 5 if no data. */
async function getMarketPriority(sb: ReturnType<typeof createClient>, berufId: string | null): Promise<{ priority: number; tier: number | null; market_score: number | null }> {
  const FALLBACK = { priority: 5, tier: null, market_score: null };
  if (!berufId) return FALLBACK;
  try {
    const { data } = await sb
      .from("v_beruf_priority")
      .select("suggested_package_priority, tier, market_score")
      .eq("beruf_id", berufId)
      .maybeSingle();
    if (!data) return FALLBACK;
    return {
      priority: Number(data.suggested_package_priority ?? 5),
      tier: data.tier ?? null,
      market_score: data.market_score ?? null,
    };
  } catch (e) {
    console.warn("[SetupPkg] Market priority lookup failed, fallback=5", e);
    return FALLBACK;
  }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonDomainError("INVALID_INPUT", "Use POST", 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const body = await req.json().catch(() => ({}));
  const curriculumId = body.curriculum_id || body.curriculumId;

  if (!curriculumId) return jsonDomainError("INVALID_INPUT", "curriculum_id required", 400);

  try {
    // 1) Check curriculum is frozen
    const { data: curr } = await sb
      .from("curricula")
      .select("id, title, beruf_id, status")
      .eq("id", curriculumId)
      .single();

    if (!curr) return jsonDomainError("CURRICULUM_NOT_FOUND", "Curriculum not found", 404);

    if (curr.status !== "frozen") {
      return jsonDomainError("CONFLICT", "Curriculum not yet frozen", 409, { retry: true });
    }

    // 2) Get beruf name
    const { data: beruf } = await sb
      .from("berufe")
      .select("bezeichnung_kurz")
      .eq("id", curr.beruf_id)
      .single();

    const berufName = beruf?.bezeichnung_kurz || curr.title;

    // 3) SSOT Guard – check for existing active package before any write
    const { data: activePackage } = await sb
      .from("course_packages")
      .select("id, status, title")
      .eq("curriculum_id", curriculumId)
      .in("status", ["building", "published"])
      .maybeSingle();

    if (activePackage) {
      console.log(`[SetupPkg] SSOT Guard: active package ${activePackage.id} (${activePackage.status}) already exists for curriculum ${curriculumId}`);
      return jsonDomainError(
        "ACTIVE_PACKAGE_EXISTS",
        "Für dieses Curriculum existiert bereits ein aktives Paket.",
        409,
        {
          existing_package_id: activePackage.id,
          existing_status: activePackage.status,
          existing_title: activePackage.title,
        },
      );
    }

    // 4) Create or get course (SSOT-hardened: unique index on curriculum_id)
    let courseId: string | null = null;

    const { data: existingCourse, error: existingCourseErr } = await sb
      .from("courses")
      .select("id")
      .eq("curriculum_id", curriculumId)
      .maybeSingle();

    if (existingCourseErr) {
      throw new Error(`Course lookup: ${existingCourseErr.message}`);
    }

    if (existingCourse?.id) {
      courseId = existingCourse.id;
    } else {
      const { data: newCourse, error: courseErr } = await sb
        .from("courses")
        .insert({
          curriculum_id: curriculumId,
          title: `ExamFit – ${berufName} Prüfungsvorbereitung`,
          status: "draft",
        })
        .select("id")
        .single();

      if (courseErr) {
        // Race condition: another request created the course first
        if ((courseErr as any).code === "23505") {
          const { data: winner, error: winnerErr } = await sb
            .from("courses")
            .select("id")
            .eq("curriculum_id", curriculumId)
            .single();
          if (winnerErr || !winner?.id) {
            throw new Error(`Course unique-race recovery failed: ${winnerErr?.message || 'winner missing'}`);
          }
          courseId = winner.id;
        } else {
          throw new Error(`Course create: ${courseErr.message}`);
        }
      } else {
        courseId = newCourse.id;
      }
    }

    if (!courseId) {
      throw new Error("Course resolve failed");
    }

    // 5) Create or get package (SSOT: curriculum_id based, not course_id)
    const { data: existingPkg } = await sb
      .from("course_packages")
      .select("id, status")
      .eq("curriculum_id", curriculumId)
      .in("status", ["planning", "queued", "building", "failed", "draft", "published"])
      .maybeSingle();

    let packageId: string;
    if (existingPkg) {
      packageId = existingPkg.id;
      if (existingPkg.status !== "planning") {
        return jsonOk({ message: "Package already exists and is beyond planning", packageId, skipped: true });
      }
    } else {
      const { data: maxQ } = await sb
        .from("course_packages")
        .select("queue_position")
        .order("queue_position", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      const nextPosition = ((maxQ?.queue_position as number) || 0) + 1;

      // Resolve priority from market SSOT
      const market = await getMarketPriority(sb, curr.beruf_id);
      console.log(`[SetupPkg] Market priority for ${berufName}: priority=${market.priority}, tier=${market.tier}, score=${market.market_score}`);

      const { data: newPkg, error: pkgErr } = await sb
        .from("course_packages")
        .insert({
          title: `ExamFit – ${berufName}`,
          course_id: courseId,
          curriculum_id: curriculumId,
          status: "planning",
          queue_position: nextPosition,
          council_approved: true,
          track: "AUSBILDUNG_VOLL",
          priority: market.priority,
          feature_flags: {
            has_learning_course: true,
            has_practice_course_h5p: false,
            has_minichecks: true,
            has_exam_trainer: true,
            has_exam_simulation: true,
            has_oral_exam_trainer: true,
            has_ai_tutor: true,
            has_handbook: true,
            ai_tutor_mode: "full",
          },
          components: {
            exam_pool: true,
            oral_exam: true,
            ai_tutor: true,
            learning_course: true,
            handbook: true,
            minichecks: true,
          },
        })
        .select("id")
        .single();
      if (pkgErr) throw new Error(`Package create: ${pkgErr.message}`);
      packageId = newPkg.id;
    }

    // 6) Create approved plan (if none exists)
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

    // 7) Acquire pipeline lock for this package
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

    // 8) Set to queued (build-course-package will pick it up)
    // SAFE_PACKAGE_STATUS_DEMOTE: planning→queued is the canonical
    // initial enqueue path of a freshly-created package, not a building→queued
    // revert. Source filter `.eq("status","planning")` makes this provably safe.
    await sb
      .from("course_packages")
      .update({ status: "queued" })
      .eq("id", packageId)
      .eq("status", "planning");

    console.log(`[SetupPkg] Created package for ${berufName}: ${packageId} (lock: ${lockAcquired ? 'acquired' : 'queued'})`);

    return jsonOk({ packageId, courseId, beruf: berufName });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = err?.code || err?.details?.code;

    if (code === "23505" && msg.includes("uniq_active_package_per_curriculum")) {
      console.warn(`[SetupPkg] 23505 caught: duplicate active package race condition`);
      const { data: winner } = await sb
        .from("course_packages")
        .select("id, status, title")
        .eq("curriculum_id", curriculumId)
        .in("status", ["building", "published"])
        .maybeSingle();

      return jsonDomainError(
        "ACTIVE_PACKAGE_EXISTS",
        "Für dieses Curriculum existiert bereits ein aktives Paket (Concurrent Insert).",
        409,
        {
          existing_package_id: winner?.id ?? null,
          existing_status: winner?.status ?? null,
          existing_title: winner?.title ?? null,
        },
      );
    }

    console.error(`[SetupPkg] Error: ${msg}`);
    return jsonDomainError("INTERNAL_ERROR", msg, 500);
  }
});
