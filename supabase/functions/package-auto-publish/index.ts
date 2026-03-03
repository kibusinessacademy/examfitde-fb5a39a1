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

  // ── PUBLISH-GATE: validate approved question count ──
  const { data: publishGate } = await sb.rpc("validate_publish_readiness", { p_package_id: packageId });
  if (publishGate && !publishGate.ok) {
    console.log(`[auto-publish] 🛑 PUBLISH-GATE blocked: ${publishGate.error} (approved=${publishGate.approved_questions}/${publishGate.total_questions})`);
    await sb.from("course_packages").update({ status: "quality_gate_failed" }).eq("id", packageId);
    try {
      await sb.from("admin_notifications").insert({
        title: "🛑 Publish-Gate: Keine approved Questions",
        body: `${publishGate.error}: ${publishGate.approved_questions}/${publishGate.total_questions} approved`,
        category: "quality", severity: "error",
        entity_type: "course_package", entity_id: packageId,
      });
    } catch (_) { /* non-critical */ }
    return json({ ok: false, retry: false, error: publishGate.error, ...publishGate }, 422);
  }

  // ── Load package data ──
  const { data: pkgQ } = await sb
    .from("course_packages")
    .select("quality_report, integrity_report, feature_flags, pipeline_mode, curriculum_id")
    .eq("id", packageId)
    .maybeSingle();

  const integrityReport = (pkgQ as any)?.integrity_report;
  const isFactoryMode = (pkgQ as any)?.pipeline_mode === "factory";

  // ═══════════════════════════════════════════════════════════
  // COURSE_READY ENFORCEMENT — hard fails block ALL modes
  // Factory mode can ONLY bypass quality_report (soft QA),
  // but NEVER bypass COURSE_READY structural gates.
  // ═══════════════════════════════════════════════════════════
  const gateVersion = integrityReport?.gate_version;
  const hardFails = integrityReport?.v3?.hard_fail_reasons || [];

  if (gateVersion === "COURSE_READY_v1.0" && hardFails.length > 0) {
    console.log(`[auto-publish] 🛑 COURSE_READY blocked: ${hardFails.length} hard fail(s)`);
    for (const hf of hardFails) console.log(`  ❌ ${hf}`);

    // Set status to quality_gate_failed
    await sb.from("course_packages").update({ status: "quality_gate_failed" }).eq("id", packageId);

    try {
      await sb.from("admin_notifications").insert({
        title: "🛑 Auto-Publish blocked by COURSE_READY",
        body: `${hardFails.length} blocker(s): ${hardFails.slice(0, 3).join("; ")}`,
        category: "quality",
        severity: "error",
        entity_type: "course_package",
        entity_id: packageId,
      });
    } catch (_) { /* non-critical */ }

    return json({
      ok: false,
      retry: false,
      error: "COURSE_READY_GATE_FAILED",
      gate_version: gateVersion,
      hard_fail_count: hardFails.length,
      hard_fail_reasons: hardFails,
      integrity_score: integrityReport?.score ?? 0,
    }, 422);
  }

  // ── Legacy gate (pre-COURSE_READY reports) ──
  if (!gateVersion && Array.isArray(hardFails) && hardFails.length > 0) {
    if (isFactoryMode) {
      // Factory mode: check minimum question floor
      const { data: courseData } = await sb.from("courses").select("curriculum_id").eq("id", courseId).maybeSingle();
      const curriculumId = (courseData as any)?.curriculum_id;
      let liveQuestionCount = 0;
      if (curriculumId) {
        const { count } = await sb.from("exam_questions").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId);
        liveQuestionCount = count ?? 0;
      }
      const FACTORY_MIN_QUESTIONS = 850;
      if (liveQuestionCount >= FACTORY_MIN_QUESTIONS) {
        console.log(`[auto-publish] Factory mode — bypassing ${hardFails.length} legacy hard-fails (live=${liveQuestionCount} questions)`);
      } else {
        return json({ ok: false, retry: false, error: `FACTORY_FLOOR_BLOCK: Only ${liveQuestionCount} questions (min ${FACTORY_MIN_QUESTIONS})`, hard_fail_reasons: hardFails }, 422);
      }
    } else {
      return json({ ok: false, retry: false, error: "V3_HARD_FAILS", hard_fail_reasons: hardFails }, 422);
    }
  }

  // ── Quality report gate (soft QA — factory can bypass) ──
  const qualityReport = (pkgQ as any)?.quality_report;
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
      await sb.from("course_packages").update({ status: "quality_gate_failed" }).eq("id", packageId);
      return json({ ok: false, retry: false, error: "QUALITY_GATE_FAILED", quality: qualityReport }, 422);
    }
  }

  // ── Review gate ──
  const requiresManualReview = Boolean((pkgQ as any)?.feature_flags?.requires_manual_review);
  const { data: review } = await sb
    .from("course_package_reviews")
    .select("status")
    .eq("course_package_id", packageId)
    .maybeSingle();

  if (!review || review.status !== "approved") {
    if (requiresManualReview) {
      return json({ ok: false, retry: false, error: `REVIEW_GATE: status=${review?.status || "no_review"}. Admin approval required.` }, 202);
    }
    try {
      if (review) {
        await sb.from("course_package_reviews").update({ status: "approved", notes: "Auto-approved by pipeline (COURSE_READY passed)" }).eq("course_package_id", packageId);
      } else {
        await sb.from("course_package_reviews").insert({ course_package_id: packageId, status: "approved", notes: "Auto-approved — COURSE_READY gate passed" });
      }
    } catch (_) { /* non-critical */ }
  }

  // ── Calculate estimated_duration ──
  const { data: courseModules } = await sb.from("modules").select("id").eq("course_id", courseId);
  const moduleIds = (courseModules || []).map((m: any) => m.id);
  let estimatedDuration = 0;
  if (moduleIds.length > 0) {
    const { count: lessonCount } = await sb.from("lessons").select("id", { count: "exact", head: true }).in("module_id", moduleIds);
    estimatedDuration = (lessonCount || 0) * 10;
  }

  // ── Difficulty Distribution Gate (SSOT: easy≤15%, hardish≥40%) ──
  const { data: courseData2 } = await sb.from("courses").select("curriculum_id").eq("id", courseId).maybeSingle();
  const publishCurrId = (courseData2 as any)?.curriculum_id;
  if (publishCurrId) {
    let diffStats: any = null;
    try {
      const res = await sb.rpc("get_difficulty_distribution", { p_curriculum_id: publishCurrId });
      diffStats = res.data;
    } catch (_) { /* non-critical */ }
    if (diffStats && Array.isArray(diffStats)) {
      const totalQ = diffStats.reduce((s: number, d: any) => s + (d.count || 0), 0);
      if (totalQ > 0) {
        const easyCount = diffStats.find((d: any) => d.difficulty === "easy")?.count || 0;
        const hardCount = diffStats.find((d: any) => d.difficulty === "hard")?.count || 0;
        const vhCount = diffStats.find((d: any) => d.difficulty === "very_hard")?.count || 0;
        const easyPct = (easyCount / totalQ) * 100;
        const hardishPct = ((hardCount + vhCount) / totalQ) * 100;
        if (easyPct > 20 || hardishPct < 35) {
          console.log(`[auto-publish] ⚠️ Difficulty skew: easy=${easyPct.toFixed(1)}% hardish=${hardishPct.toFixed(1)}%`);
          if (!isFactoryMode) {
            try {
              await sb.from("admin_notifications").insert({
                title: "⚠️ Difficulty Distribution Warning",
                body: `easy=${easyPct.toFixed(0)}% (max 15%), hardish=${hardishPct.toFixed(0)}% (min 40%)`,
                category: "quality", severity: "warning",
                entity_type: "course_package", entity_id: packageId,
              });
            } catch (_) { /* non-critical */ }
          }
        }
      }
    }
  }

  // ── Publish (atomic version switch) ──
  const { error: cErr } = await sb
    .from("courses")
    .update({ publishing_status: "publish_ready", status: "published", estimated_duration: estimatedDuration > 0 ? estimatedDuration : undefined })
    .eq("id", courseId);
  if (cErr) throw cErr;

  // Use atomic publish RPC if package has product_id (versioned), fallback to direct update
  const { data: pkgVersion } = await sb
    .from("course_packages")
    .select("product_id")
    .eq("id", packageId)
    .maybeSingle();

  if ((pkgVersion as any)?.product_id) {
    const { data: publishResult, error: publishErr } = await sb.rpc("publish_package_version", { p_package_id: packageId });
    if (publishErr) throw publishErr;
    console.log(`[auto-publish] Atomic version switch:`, publishResult);
  } else {
    // Legacy path for non-versioned packages
    const { error: pErr } = await sb
      .from("course_packages")
      .update({ status: "published", build_progress: 100, council_approved: true, published_at: new Date().toISOString() })
      .eq("id", packageId);
    if (pErr) throw pErr;
  }

  // ── Log excellence level ──
  const excellenceList = integrityReport?.v3?.excellence || [];
  const badge = excellenceList.length >= 3 ? "🏆 Excellence" : excellenceList.length > 0 ? "🥇 Gold" : "✅ Ready";

  try {
    await sb.from("admin_notifications").insert({
      title: `🚀 ${badge} Package published`,
      body: `COURSE_READY passed. Score: ${integrityReport?.score ?? "?"}/100. ${excellenceList.length} excellence criteria met.`,
      category: "package_review",
      severity: "info",
      entity_type: "course_package",
      entity_id: packageId,
    });
  } catch (_) { /* non-critical */ }

  // ── Trigger post-publish Learner E2E (non-blocking) ──
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const internalSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const triggerRes = await fetch(`${supabaseUrl}/functions/v1/ops-trigger-learner-e2e`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-job-runner-key": internalSecret,
      },
      body: JSON.stringify({ package_id: packageId, curriculum_id: (pkgQ as any)?.curriculum_id ?? "", course_id: courseId, track: "EXAM_FIRST", reason: "post_publish" }),
    });
    const triggerBody = await triggerRes.json().catch(() => ({}));
    console.log(`[auto-publish] E2E trigger: ${triggerRes.status}`, triggerBody);
  } catch (e) {
    console.warn(`[auto-publish] E2E trigger failed (non-critical):`, e);
  }

  return json({ ok: true, badge, integrity_score: integrityReport?.score ?? 100, excellence: excellenceList });
});
