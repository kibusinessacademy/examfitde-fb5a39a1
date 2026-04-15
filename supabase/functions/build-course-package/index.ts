import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { calculateHybridTarget } from "../_shared/hybridExamTarget.ts";

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

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const body = await req.json().catch(() => ({}));
  const { packageId, courseId, curriculumId, certificationId, options } = body;

  try {
    assertUuid("package_id", packageId);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  // ── WIP Guard: Prevent priority bypass ──
  // Check if the system has capacity before allowing a new build.
  // Already-building packages (re-bootstrap) and rebuilds are always allowed.
  const { data: wipAllowed, error: wipErr } = await sb.rpc("check_wip_allows_build", { p_package_id: packageId });
  if (wipErr) {
    console.warn(`[BuildPkg] WIP check failed (non-fatal): ${wipErr.message}`);
  } else if (wipAllowed === false) {
    console.log(`[BuildPkg] ⛔ WIP limit reached — rejecting build for ${packageId.slice(0, 8)}`);
    return json({ ok: false, error: "WIP_LIMIT_REACHED", detail: "System is at capacity. Package will be built when a slot opens." }, 429);
  }
  console.log(`[BuildPkg] Bootstrapping package ${packageId.slice(0, 8)} (WIP check passed)`);
  
  // Update pipeline_lock heartbeat if we happen to be the active package (backwards compat)
  try { await sb.rpc("heartbeat_pipeline_lock", { p_package_id: packageId }); } catch (_) { /* ignore */ }

  // ── Pre-Build Autofix ──
  try {
    const afRes = await fetch(`${SUPABASE_URL}/functions/v1/prebuild-autofix`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ package_id: packageId }),
    });
    const afData = await afRes.json();
    if (afData.fixes_applied > 0) {
      console.log(`[BuildPkg] Autofix applied ${afData.fixes_applied} fixes`);
    }
  } catch (afErr) {
    console.warn(`[BuildPkg] Autofix call failed (non-fatal):`, afErr);
  }

  // ── Global try/catch: ensure slot + lock cleanup on ANY error ──
  try {
    // Fetch package
    const { data: pkgRow, error: pkgErr } = await sb
      .from("course_packages")
      .select("id, course_id, certification_id, track, feature_flags")
      .eq("id", packageId)
      .single();

    if (pkgErr || !pkgRow) {
      await sb.rpc("release_pipeline_lock", { p_package_id: packageId });
      await sb.from("pipeline_active_packages").delete().eq("package_id", packageId);
      return json({ error: "Package not found" }, 404);
    }

    const effectiveCourseId = courseId || pkgRow.course_id;
    const effectiveCertId = certificationId || pkgRow.certification_id;
    const featureFlags = pkgRow.feature_flags || {};
    const track = pkgRow.track || "AUSBILDUNG_VOLL";

    // Resolve curriculum_id
    let effectiveCurriculumId = curriculumId;
    if (!effectiveCurriculumId && effectiveCourseId) {
      const { data: courseRow } = await sb
        .from("courses")
        .select("curriculum_id")
        .eq("id", effectiveCourseId)
        .single();
      effectiveCurriculumId = courseRow?.curriculum_id || null;
    }

    // FIX 4: Block if required IDs are missing instead of enqueuing broken jobs
    if (!effectiveCurriculumId || !effectiveCourseId) {
      await sb.from("course_packages").update({
        status: "blocked",
        blocked_reason: "awaiting_source_data",
        updated_at: new Date().toISOString(),
      }).eq("id", packageId);
      try { await sb.rpc("release_pipeline_lock", { p_package_id: packageId }); } catch (_) { /* ignore */ }
      try { await sb.from("pipeline_active_packages").delete().eq("package_id", packageId); } catch (_) { /* ignore */ }
      return json({ ok: false, error: "MISSING_REQUIRED_IDS", detail: { effectiveCourseId, effectiveCurriculumId } }, 409);
    }

    // ── Council plan gate (auto-create if council_approved) ──
    let { data: planRow } = await sb
      .from("course_package_plans")
      .select("id")
      .eq("package_id", packageId)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!planRow) {
      const { data: pkgCheck } = await sb
        .from("course_packages")
        .select("council_approved")
        .eq("id", packageId)
        .single();

      if (pkgCheck?.council_approved) {
        const { data: newPlan, error: planInsErr } = await sb
          .from("course_package_plans")
          .insert({
            package_id: packageId,
            status: "approved",
            plan: { auto_created: true, track, feature_flags: featureFlags },
          })
          .select("id")
          .maybeSingle();
        if (planInsErr || !newPlan) {
          await sb.rpc("release_pipeline_lock", { p_package_id: packageId });
          await sb.from("pipeline_active_packages").delete().eq("package_id", packageId);
          return json({ error: "Could not create build plan: " + (planInsErr?.message || "unknown") }, 400);
        }
        planRow = newPlan;
      } else {
        await sb.rpc("release_pipeline_lock", { p_package_id: packageId });
        await sb.from("pipeline_active_packages").delete().eq("package_id", packageId);
        return json({ error: "No approved course_package_plan found (Council approval required)." }, 400);
      }
    }

    // ── Hybrid Target Engine ──
    let ausbildungsDauer: number | null = null;
    let certCatalogData: {
      exam_complexity_score?: number;
      math_ratio?: number;
      oral_component?: boolean;
      learning_field_count?: number;
      certification_level?: string;
    } = {};

    if (effectiveCurriculumId) {
      const { data: currRow } = await sb.from("curricula").select("beruf_id").eq("id", effectiveCurriculumId).maybeSingle();
      if (currRow?.beruf_id) {
        const { data: berufRow } = await sb.from("berufe").select("ausbildungsdauer_monate").eq("id", currRow.beruf_id).maybeSingle();
        ausbildungsDauer = berufRow?.ausbildungsdauer_monate ?? null;
      }
    }

    if (effectiveCertId) {
      const { data: catRow } = await sb
        .from("certification_catalog")
        .select("exam_complexity_score, math_ratio, oral_component, learning_field_count, certification_level")
        .eq("linked_certification_id", effectiveCertId)
        .maybeSingle();
      if (catRow) certCatalogData = catRow;
    }

    const hybridResult = calculateHybridTarget({
      durationMonths: ausbildungsDauer,
      track,
      examComplexityScore: certCatalogData.exam_complexity_score ?? 1.0,
      mathRatio: certCatalogData.math_ratio ?? 0.15,
      oralComponent: certCatalogData.oral_component ?? false,
      learningFieldCount: certCatalogData.learning_field_count ?? 0,
      certificationLevel: certCatalogData.certification_level ?? "ausbildung",
    });

    console.log(`[BuildPkg] Hybrid Target: ${hybridResult.target} (ship: ${hybridResult.shipTarget})`);

    // ── Elite Override: robust didaktik detection ──
    // wantDidaktik fires if: full track, force_elite, OR feature_flags signal learning
    const forceElite = featureFlags.force_elite === true;
    const isFullTrack = track === "AUSBILDUNG_VOLL";
    const flagsWantLearning = featureFlags.has_learning_course === true;
    const wantDidaktik = isFullTrack || forceElite || flagsWantLearning;
    const wantEliteHarden = isFullTrack || forceElite || flagsWantLearning;

    // Build options from feature_flags + Hybrid Engine
    // When force_elite is set, didaktik components are always included
    const opts = {
      include_learning_course: wantDidaktik || (featureFlags.has_learning_course ?? false),
      include_exam_pool: featureFlags.has_exam_trainer ?? true,
      include_oral_exam: featureFlags.has_oral_exam_trainer ?? (isFullTrack || forceElite),
      include_ai_tutor: featureFlags.has_ai_tutor ?? (isFullTrack || forceElite),
      include_handbook: featureFlags.has_handbook ?? wantDidaktik,
      exam_target: hybridResult.target,
      ship_target: hybridResult.shipTarget,
      ausbildungsdauer_monate: ausbildungsDauer,
      difficulty_distribution: hybridResult.difficultyDistribution,
      question_type_mix: hybridResult.questionTypeMix,
      ...(options || {}),
    };

    // ── Define pipeline steps (sequential per STEP_ORDER) ──
    // Phase 1: Scaffold + Content Generation
    const contentSteps: Array<{ step_key: string; job_type: string }> = [];
    // ALWAYS include scaffolding — even EXAM_FIRST needs course structure
    contentSteps.push({ step_key: "scaffold_learning_course", job_type: "package_scaffold_learning_course" });
    if (opts.include_learning_course) {
      contentSteps.push({ step_key: "generate_glossary", job_type: "package_generate_glossary" });
      contentSteps.push({ step_key: "generate_learning_content", job_type: "package_generate_learning_content" });
      contentSteps.push({ step_key: "validate_learning_content", job_type: "package_validate_learning_content" });
    }
    if (opts.include_exam_pool) {
      contentSteps.push({ step_key: "auto_seed_exam_blueprints", job_type: "package_auto_seed_exam_blueprints" });
      contentSteps.push({ step_key: "validate_blueprints", job_type: "package_validate_blueprints" });
      contentSteps.push({ step_key: "generate_exam_pool", job_type: "package_generate_exam_pool" });
      contentSteps.push({ step_key: "validate_exam_pool", job_type: "package_validate_exam_pool" });
    }
    if (opts.include_ai_tutor) {
      contentSteps.push({ step_key: "build_ai_tutor_index", job_type: "package_build_ai_tutor_index" });
      contentSteps.push({ step_key: "validate_tutor_index", job_type: "package_validate_tutor_index" });
    }
    if (opts.include_oral_exam) {
      contentSteps.push({ step_key: "generate_oral_exam", job_type: "package_generate_oral_exam" });
      contentSteps.push({ step_key: "validate_oral_exam", job_type: "package_validate_oral_exam" });
    }

    // MiniChecks: MANDATORY for AUSBILDUNG_VOLL — never skip for Elite packages
    // force_elite or full track always includes minichecks regardless of feature_flags
    const includeMiniChecks = wantDidaktik || (featureFlags.has_minichecks ?? false);
    if (includeMiniChecks) {
      contentSteps.push({ step_key: "generate_lesson_minichecks", job_type: "package_generate_lesson_minichecks" });
      contentSteps.push({ step_key: "validate_lesson_minichecks", job_type: "package_validate_lesson_minichecks" });
    }

    // Handbook: MANDATORY for AUSBILDUNG_VOLL — wantDidaktik forces inclusion
    if (opts.include_handbook || wantDidaktik) {
      contentSteps.push({ step_key: "generate_handbook", job_type: "package_generate_handbook" });
      contentSteps.push({ step_key: "validate_handbook", job_type: "package_validate_handbook" });
    }

    // Elite Hardening: full pipeline (all phases) for AUSBILDUNG_VOLL / force_elite
    if (wantEliteHarden) {
      contentSteps.push({ step_key: "elite_harden", job_type: "package_elite_harden" });
    } else if (opts.include_exam_pool) {
      // EXAM_FIRST: still needs SSOT-based elite annotations (deterministic, no AI)
      // This ensures elite metrics are computed from blueprint/competency data
      contentSteps.push({ step_key: "elite_harden", job_type: "package_elite_harden" });
    }

    // Phase 2: Quality gates
    const gateSteps: Array<{ step_key: string; job_type: string }> = [
      { step_key: "run_integrity_check", job_type: "package_run_integrity_check" },
      { step_key: "quality_council", job_type: "package_quality_council" },
      { step_key: "auto_publish", job_type: "package_auto_publish" },
    ];

    const allSteps = [...contentSteps, ...gateSteps];

    // Init build steps
    await sb.rpc("init_course_package_steps", {
      p_package_id: packageId,
      p_steps: allSteps.map((s) => s.step_key),
    });

    // Heartbeat again before enqueuing jobs
    await sb.rpc("heartbeat_pipeline_lock", { p_package_id: packageId });

    // ── NO job creation here! pipeline-runner is the sole job creator ──
    // Steps are initialized above via init_course_package_steps.
    // pipeline-runner will pick up queued steps and enqueue worker jobs.

    // Ensure priority ≤ 10 so the pipeline-runner's Priority Gate picks it up
    const { data: currentPkg } = await sb
      .from("course_packages")
      .select("priority")
      .eq("id", packageId)
      .single();
    const ensuredPriority = (currentPkg?.priority ?? 100) > 10 ? 5 : currentPkg?.priority;

    // Mark package as building (pipeline-runner will acquire lease and process)
    await sb
      .from("course_packages")
      .update({ status: "building", priority: ensuredPriority })
      .eq("id", packageId);

    console.log(`[BuildPkg] ✅ ${allSteps.length} steps initialized for ${packageId.slice(0, 8)} — pipeline-runner will enqueue jobs`);

    return json({ ok: true, steps: allSteps.length, packageId, pipeline_lock: "held" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[BuildPkg] FATAL: ${msg}`);

    // Fail package, release slot + lock
    await sb.from("course_packages").update({
      status: "failed",
      updated_at: new Date().toISOString(),
    }).eq("id", packageId);
    await sb.from("pipeline_active_packages").delete().eq("package_id", packageId);
    await sb.rpc("release_pipeline_lock", { p_package_id: packageId });

    return json({ ok: false, error: msg }, 500);
  }
});
