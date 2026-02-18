import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}
async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (d1?.status === "done") return true;
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status === "done";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("course_id", p?.course_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id as string;
  const courseId = p.course_id as string;

  if (!(await prereqDone(sb, packageId, "run_integrity_check"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: run_integrity_check" }, 409);
  }

  // Quality gate (if available)
  const { data: pkgQ } = await sb
    .from("course_packages")
    .select("quality_report, integrity_report, feature_flags, pipeline_mode")
    .eq("id", packageId)
    .maybeSingle();

  const qualityReport = (pkgQ as any)?.quality_report;
  const isFactoryMode = (pkgQ as any)?.pipeline_mode === "factory";

  // In factory mode, quality gate failures are warnings (not blockers)
  // In production mode, quality gate failures block publishing
  if (qualityReport && qualityReport.status === "failed") {
    if (isFactoryMode) {
      console.log(`[auto-publish] Factory mode — bypassing quality gate (score=${qualityReport.score}, badge=${qualityReport.badge})`);
    } else {
      try {
        await sb.from("admin_notifications").insert({
          title: "⚠️ Quality Gate failed",
          body: `Package blocked. quality_score=${qualityReport.score ?? "?"}`,
          category: "quality",
          severity: "warning",
          entity_type: "course_package",
          entity_id: packageId,
        });
      } catch (_) { /* non-critical */ }
      return json({ ok: false, retry: false, error: "QUALITY_GATE_FAILED", quality: qualityReport }, 422);
    }
  }

  // Review gate (auto-approve unless flag requires manual review)
  const requiresManualReview = Boolean((pkgQ as any)?.feature_flags?.requires_manual_review);

  const { data: review } = await sb
    .from("course_package_reviews")
    .select("status")
    .eq("course_package_id", packageId)
    .maybeSingle();

  if (!review || review.status !== "approved") {
    const currentStatus = review?.status || "no_review";
    if (requiresManualReview) {
      return json({
        ok: false,
        retry: false,
        error: `REVIEW_GATE: status=${currentStatus}. Admin approval required.`,
        review_status: currentStatus,
      }, 202);
    }

    // Auto-approve: try update first, then insert if no row exists
    try {
      if (review) {
        await sb.from("course_package_reviews")
          .update({ status: "approved", notes: "Auto-approved by pipeline" })
          .eq("course_package_id", packageId);
      } else {
        await sb.from("course_package_reviews")
          .insert({
            course_package_id: packageId,
            status: "approved",
            notes: "Auto-approved by pipeline to prevent blocking",
          });
      }
    } catch (_) { /* non-critical — proceed to publish */ }
  }

  // Integrity hard-fail gate (only blocks in production mode)
  // isFactoryMode already determined above from pkgQ

  const integrityReport = (pkgQ as any)?.integrity_report;
  const hardFails = integrityReport?.v3?.hard_fail_reasons || [];

  // Live question count (integrity report may be stale)
  const { data: courseData } = await sb
    .from("courses").select("curriculum_id").eq("id", courseId).maybeSingle();
  const curriculumId = (courseData as any)?.curriculum_id;
  let liveQuestionCount = integrityReport?.v3?.stats?.questionCount ?? 0;
  if (curriculumId) {
    const { count } = await sb
      .from("exam_questions").select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId);
    liveQuestionCount = count ?? liveQuestionCount;
  }

  // Factory mode: bypass SOME hard-fails but enforce absolute minimum (50 questions)
  const FACTORY_MIN_QUESTIONS = 850;
  if (Array.isArray(hardFails) && hardFails.length > 0) {
    if (isFactoryMode && liveQuestionCount >= FACTORY_MIN_QUESTIONS) {
      console.log(`[auto-publish] Factory mode — bypassing ${hardFails.length} hard-fails (live=${liveQuestionCount} questions): ${hardFails.join(", ")}`);
    } else if (isFactoryMode && liveQuestionCount < FACTORY_MIN_QUESTIONS) {
      return json({ ok: false, retry: false, error: `FACTORY_FLOOR_BLOCK: Only ${liveQuestionCount} questions (min ${FACTORY_MIN_QUESTIONS})`, hard_fail_reasons: hardFails }, 422);
    } else {
      return json({ ok: false, retry: false, error: "V3_HARD_FAILS", hard_fail_reasons: hardFails }, 422);
    }
  }

  // ── Calculate estimated_duration from lesson count ──
  const { data: courseModules } = await sb.from("modules").select("id").eq("course_id", courseId);
  const moduleIds = (courseModules || []).map((m: any) => m.id);
  let estimatedDuration = 0;
  if (moduleIds.length > 0) {
    const { count: lessonCount } = await sb.from("lessons")
      .select("id", { count: "exact", head: true })
      .in("module_id", moduleIds);
    // ~10 min per lesson average
    estimatedDuration = (lessonCount || 0) * 10;
  }

  // Publish course with consistent status
  const { error: cErr } = await sb
    .from("courses")
    .update({
      publishing_status: "publish_ready",
      status: "published",
      estimated_duration: estimatedDuration > 0 ? estimatedDuration : undefined,
    })
    .eq("id", courseId);
  if (cErr) throw cErr;

  const { error: pErr } = await sb
    .from("course_packages")
    .update({ status: "published", build_progress: 100, council_approved: true, published_at: new Date().toISOString() })
    .eq("id", packageId);
  if (pErr) throw pErr;

  try {
    await sb.from("admin_notifications").insert({
      title: "🚀 Package published",
      body: "Course package has been published successfully.",
      category: "package_review",
      severity: "info",
      entity_type: "course_package",
      entity_id: packageId,
    });
  } catch (_) { /* non-critical */ }

  return json({ ok: true });
});
