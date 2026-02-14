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
 * package-queue-next — WIP-limit = 1
 *
 * Called by pg_cron every minute.
 * 1. Check pipeline_lock — if locked → return busy
 * 2. Pick next queued package
 * 3. Claim pipeline_lock atomically
 * 4. Fire build-course-package (fire-and-forget)
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // ── Step 0: Cleanup stale locks (>10 min without heartbeat) ──
    await sb.rpc("cleanup_stale_pipeline_lock");

    // ── Step 0.5: Freeze-phase gate ──
    const { count: frozenCount } = await sb
      .from("curricula")
      .select("id", { count: "exact", head: true })
      .eq("status", "frozen");

    const { count: totalPkgs } = await sb
      .from("course_packages")
      .select("id", { count: "exact", head: true });

    // During initial ramp-up, prioritize freezing curricula over building packages
    if ((totalPkgs ?? 0) < 10 && (frozenCount ?? 0) < 5) {
      return json({
        ok: true,
        skipped: true,
        reason: "Freeze-phase priority: waiting for more frozen curricula",
        frozenCount: frozenCount ?? 0,
      });
    }

    // ── Step 1: Check if pipeline is already busy ──
    const { data: lock } = await sb
      .from("pipeline_lock")
      .select("active_package_id, locked_at, locked_by, heartbeat_at")
      .eq("id", 1)
      .single();

    if (lock?.active_package_id) {
      return json({
        ok: true,
        skipped: true,
        reason: "pipeline_busy",
        active_package_id: lock.active_package_id,
        locked_by: lock.locked_by,
        locked_at: lock.locked_at,
      });
    }

    // ── Step 2: Pick next queued package (priority-based, then FIFO) ──
    let nextId: string | null = null;

    // Try priority pick first
    try {
      const { data: priorityId } = await sb.rpc("pick_next_package_by_priority", { max_active: 1 });
      if (priorityId) nextId = priorityId;
    } catch { /* rpc may not exist yet */ }

    if (!nextId) {
      // Fallback: simple FIFO from queued packages
      const { data: nextPkg } = await sb
        .from("course_packages")
        .select("id")
        .eq("status", "queued")
        .order("queue_position", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      nextId = nextPkg?.id || null;
    }

    if (!nextId) {
      return json({ ok: true, skipped: true, reason: "no_queued_packages" });
    }

    // ── Step 3: Claim pipeline lock atomically ──
    const { data: claimed } = await sb.rpc("try_claim_pipeline_lock", {
      p_package_id: nextId,
      p_locked_by: "package-queue-next",
    });

    if (!claimed) {
      return json({ ok: true, skipped: true, reason: "lock_claim_failed_race_condition" });
    }

    // ── Step 4: Fetch package details ──
    const { data: next, error } = await sb
      .from("course_packages")
      .select("id, course_id, certification_id, track, feature_flags, queue_position")
      .eq("id", nextId)
      .maybeSingle();

    if (error || !next) {
      await sb.rpc("release_pipeline_lock", { p_package_id: nextId });
      return json({ ok: false, error: "Package not found after lock claim" }, 404);
    }

    // ── Step 5: Resolve curriculum_id ──
    const { data: course } = await sb
      .from("courses")
      .select("curriculum_id")
      .eq("id", next.course_id)
      .maybeSingle();

    let curriculumId = course?.curriculum_id;
    if (!curriculumId) {
      // Try autofix
      try {
        const afRes = await fetch(`${SUPABASE_URL}/functions/v1/prebuild-autofix`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ package_id: next.id }),
        });
        const afData = await afRes.json();
        if (afData.fixes_applied > 0) {
          const { data: retry } = await sb.from("courses").select("curriculum_id").eq("id", next.course_id).maybeSingle();
          curriculumId = retry?.curriculum_id;
        }
      } catch { /* non-fatal */ }

      if (!curriculumId) {
        await sb.rpc("release_pipeline_lock", { p_package_id: nextId });
        await sb.from("course_packages").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", nextId);
        await sb.from("admin_notifications").insert({
          title: `⚠️ Paket ohne Curriculum: ${next.id.slice(0, 8)}`,
          body: `Kurs ${next.course_id} hat kein curriculum_id. Lock freigegeben.`,
          category: "ops", severity: "warning",
        });
        return json({ ok: false, error: "No curriculum_id" }, 400);
      }
    }

    // ── Step 6: Hybrid Target Engine ──
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

    if (next.certification_id) {
      const { data: catRow } = await sb
        .from("certification_catalog")
        .select("exam_complexity_score, math_ratio, oral_component, learning_field_count, certification_level")
        .eq("linked_certification_id", next.certification_id)
        .maybeSingle();
      if (catRow) certCatalogData = catRow;
    }

    const track = next.track || "AUSBILDUNG_VOLL";
    const hybridResult = calculateHybridTarget({
      durationMonths,
      track,
      examComplexityScore: certCatalogData.exam_complexity_score ?? 1.0,
      mathRatio: certCatalogData.math_ratio ?? 0.15,
      oralComponent: certCatalogData.oral_component ?? false,
      learningFieldCount: certCatalogData.learning_field_count ?? 0,
      certificationLevel: certCatalogData.certification_level ?? "ausbildung",
    });

    // ── Step 7: Ensure approved plan ──
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
          auto_created: true,
          track,
          exam_target: hybridResult.target,
          ship_target: hybridResult.shipTarget,
          difficulty_distribution: hybridResult.difficultyDistribution,
          question_type_mix: hybridResult.questionTypeMix,
        },
      });
    }

    // Ensure council_approved
    await sb
      .from("course_packages")
      .update({
        council_approved: true,
        council_approved_at: new Date().toISOString(),
        status: "building",
        build_progress: 1,
      })
      .eq("id", next.id);

    // ── Step 8: Fire build-course-package (fire-and-forget) ──
    const featureFlags = next.feature_flags || {};
    const buildBody = JSON.stringify({
      packageId: next.id,
      courseId: next.course_id,
      curriculumId,
      certificationId: next.certification_id,
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

    fetch(`${SUPABASE_URL}/functions/v1/build-course-package`, {
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
        await sb.from("admin_notifications").insert({
          title: `🔴 Build-Start fehlgeschlagen: ${next.id.slice(0, 8)}`,
          body: `HTTP ${res.status}: ${errText.slice(0, 200)}`,
          category: "ops", severity: "error",
          metadata: { package_id: next.id },
        });
      }
    }).catch(async (e) => {
      console.error(`[queue-next] Fire-and-forget error: ${(e as Error).message}`);
      // Release lock on network failure so pipeline doesn't get stuck
      await sb.rpc("release_pipeline_lock", { p_package_id: next.id });
      await sb.from("course_packages").update({ status: "failed" }).eq("id", next.id);
    });

    console.log(`[queue-next] 🔒 Locked pipeline for package ${next.id} (queue_position=${next.queue_position})`);

    return json({
      ok: true,
      started_package_id: next.id,
      queue_position: next.queue_position,
      mode: "single_lock",
      hybrid_target: hybridResult.target,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[queue-next] Error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
