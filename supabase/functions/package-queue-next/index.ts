import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { calculateHybridTarget } from "../_shared/hybridExamTarget.ts";

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
 * package-queue-next — Per-Package Isolation, NO global gates
 *
 * Uses claim_next_queued_package() RPC which:
 * 1. Iterates queued packages in FIFO order (FOR UPDATE SKIP LOCKED)
 * 2. Checks per-package: is THIS curriculum frozen?
 * 3. If not frozen → blocks only THIS package, tries next
 * 4. If frozen → claims it atomically, returns it
 *
 * No global draft/frozen counts. No global hard-stops.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // ── Step 0: Cleanup stale locks ──
    await sb.rpc("cleanup_stale_pipeline_lock").catch(() => {});

    // ── Step 1: Check WIP capacity ──
    const { data: activeIds } = await sb.rpc("get_active_pipeline_packages").catch(() => ({ data: null }));
    const currentActive = (activeIds as string[] | null) ?? [];

    const { data: capRow } = await sb
      .from("pipeline_capacity")
      .select("max_wip")
      .eq("id", true)
      .maybeSingle();

    const maxActive = capRow?.max_wip ?? 2;

    if (currentActive.length >= maxActive) {
      return json({
        ok: true,
        skipped: true,
        reason: `pipeline_full (${currentActive.length}/${maxActive} active)`,
        active_packages: currentActive,
      });
    }

    // ── Step 2: Atomic per-package claim via RPC ──
    // This RPC iterates queued packages, checks per-package curriculum status,
    // blocks non-frozen ones individually, and claims the first buildable one.
    const { data: claimed, error: claimErr } = await sb.rpc("claim_next_queued_package");

    if (claimErr) {
      console.error("[queue-next] claim RPC error:", claimErr.message);
      return json({ ok: false, error: claimErr.message }, 500);
    }

    const pkg = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!pkg?.package_id) {
      return json({
        ok: true,
        skipped: true,
        reason: "no_buildable_package (all queued packages blocked or none queued)",
      });
    }

    const nextId = pkg.package_id;
    const curriculumId = pkg.curriculum_id;

    // ── Step 3: Register in pipeline slot registry ──
    const { data: slotClaimed } = await sb.rpc("claim_pipeline_slot", {
      p_package_id: nextId,
    }).catch(() => ({ data: false }));

    // Also set legacy single-lock for backward compat
    await sb.rpc("try_claim_pipeline_lock", {
      p_package_id: nextId,
      p_locked_by: "package-queue-next",
    }).catch(() => {});

    // ── Step 4: Hybrid Target Engine ──
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

    if (pkg.certification_id) {
      const { data: catRow } = await sb
        .from("certification_catalog")
        .select("exam_complexity_score, math_ratio, oral_component, learning_field_count, certification_level")
        .eq("linked_certification_id", pkg.certification_id)
        .maybeSingle();
      if (catRow) certCatalogData = catRow;
    }

    const track = pkg.track || "AUSBILDUNG_VOLL";
    const hybridResult = calculateHybridTarget({
      durationMonths,
      track,
      examComplexityScore: certCatalogData.exam_complexity_score ?? 1.0,
      mathRatio: certCatalogData.math_ratio ?? 0.15,
      oralComponent: certCatalogData.oral_component ?? false,
      learningFieldCount: certCatalogData.learning_field_count ?? 0,
      certificationLevel: certCatalogData.certification_level ?? "ausbildung",
    });

    // ── Step 5: Ensure approved plan ──
    const { data: plan } = await sb
      .from("course_package_plans")
      .select("id")
      .eq("package_id", nextId)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();

    if (!plan) {
      await sb.from("course_package_plans").insert({
        package_id: nextId,
        status: "approved",
        plan: {
          auto_created: true,
          track,
          exam_target: hybridResult.target,
          ship_target: hybridResult.shipTarget,
          difficulty_distribution: hybridResult.difficultyDistribution,
          question_type_mix: hybridResult.questionTypeMix,
        },
      });
    }

    // ── Step 6: Start build-course-package (await, no fire-and-forget) ──
    const featureFlags = pkg.feature_flags || {};
    const buildBody = JSON.stringify({
      packageId: nextId,
      courseId: pkg.course_id,
      curriculumId,
      certificationId: pkg.certification_id,
      options: {
        include_learning_course: featureFlags.has_learning_course ?? (track === "AUSBILDUNG_VOLL"),
        include_exam_pool: featureFlags.has_exam_trainer ?? true,
        include_oral_exam: featureFlags.has_oral_exam_trainer ?? (track === "AUSBILDUNG_VOLL"),
        include_ai_tutor: featureFlags.has_ai_tutor ?? (track === "AUSBILDUNG_VOLL"),
        include_handbook: featureFlags.has_handbook ?? (track === "AUSBILDUNG_VOLL"),
        exam_target: hybridResult.target,
        ship_target: hybridResult.shipTarget,
        difficulty_distribution: hybridResult.difficultyDistribution,
        question_type_mix: hybridResult.questionTypeMix,
      },
    });

    const buildRes = await fetch(`${SUPABASE_URL}/functions/v1/build-course-package`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: buildBody,
    });

    if (!buildRes.ok) {
      const errText = await buildRes.text().catch(() => "unknown");
      console.error(`[queue-next] Build start failed ${buildRes.status}: ${errText}`);

      await sb.from("ops_alerts").insert({
        source: "package-queue-next",
        severity: "error",
        message: `Build-Start failed for ${nextId.slice(0, 8)}: HTTP ${buildRes.status}`,
        payload: { package_id: nextId, status: buildRes.status, error: errText.slice(0, 800) },
      }).catch(() => {});

      await sb.from("course_packages").update({
        status: "failed",
        last_error: `Build start HTTP ${buildRes.status}: ${errText.slice(0, 250)}`,
      }).eq("id", nextId).catch(() => {});

      await sb.rpc("release_pipeline_slot", { p_package_id: nextId }).catch(() => {});
      await sb.rpc("release_pipeline_lock", { p_package_id: nextId }).catch(() => {});

      return json({ ok: false, error: `Build-Start failed: HTTP ${buildRes.status}` }, 502);
    }

    console.log(`[queue-next] ✅ Build started for package ${nextId} (queue_pos=${pkg.queue_position}, curriculum=${curriculumId})`);

    return json({
      ok: true,
      started_package_id: nextId,
      queue_position: pkg.queue_position,
      mode: "per_package_isolation",
      hybrid_target: hybridResult.target,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[queue-next] Error:", msg);
    await sb.from("ops_alerts").insert({
      source: "package-queue-next",
      severity: "error",
      message: `Unhandled error: ${msg}`,
    }).catch(() => {});
    return json({ ok: false, error: msg }, 500);
  }
});
