import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { prereqDone } from "../_shared/prereq-done.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

/** Safe admin notification — never throws, handles uuid cast issues */
async function notify(sb: any, title: string, body: string, category: string, severity: string, entityType: string, entityId: string) {
  try {
    // Use raw SQL to handle uuid casting properly
    await sb.rpc("admin_notify", {
      p_title: title,
      p_body: body,
      p_category: category,
      p_severity: severity,
      p_entity_type: entityType,
      p_entity_id: entityId,
    });
  } catch (_) {
    // Fallback: try direct insert
    try {
      await sb.from("admin_notifications").insert({
        title, body, category, severity,
        entity_type: entityType,
        entity_id: entityId,
      });
    } catch (_2) {
      console.warn(`[auto-publish] notification insert failed (non-critical): ${title}`);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id as string;
  let courseId = p.course_id as string | undefined;

  // ── Payload-decoupling: resolve missing course_id from package ──
  if (!courseId || !/^[0-9a-f]{8}-/i.test(courseId)) {
    const { data: pkg } = await sb
      .from("course_packages")
      .select("course_id")
      .eq("id", packageId)
      .maybeSingle();
    if (!pkg?.course_id) {
      return json({ error: "Could not resolve course_id for package" }, 400);
    }
    courseId = pkg.course_id;
    console.log(`[auto-publish] Resolved course_id=${courseId} from package`);
  }

  // ── Top-level try/catch to prevent bare 500s ──
  try {
    if (!(await prereqDone(sb, packageId, "run_integrity_check"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: run_integrity_check" }, 409);
    }

    // ══════════════════════════════════════════════════════════════
    // QUALITY GATE v2 — LESSON STATUS GUARD (fail-closed)
    // Published packages must NOT contain draft lessons with failing QC.
    // ══════════════════════════════════════════════════════════════
    {
      // Resolve course_id → modules → lessons
      const { data: modRows } = await sb.from("modules").select("id").eq("course_id", courseId);
      const moduleIds = (modRows || []).map((m: any) => m.id);
      if (moduleIds.length > 0) {
        // Get failed lesson IDs for metadata
        const { data: failedLessons } = await sb
          .from("lessons")
          .select("id, title, qc_status")
          .in("module_id", moduleIds)
          .eq("status", "draft")
          .in("qc_status", ["tier1_failed", "needs_revision"]);

        const draftFailedCount = failedLessons?.length ?? 0;

        if (draftFailedCount > 0) {
          const failedIds = (failedLessons || []).map((l: any) => l.id);
          console.log(`[auto-publish] 🛑 LESSON_QC_GATE: ${draftFailedCount} lessons are draft+failed`);

          // Read current publish_retry_count from package meta
          const { data: pkgMeta } = await sb.from("course_packages")
            .select("meta").eq("id", packageId).maybeSingle();
          const currentMeta = (pkgMeta as any)?.meta || {};
          const retryCount = (currentMeta.publish_retry_count ?? 0) + 1;
          const maxRetries = 2;

          // Set status to publish_failed (not quality_gate_failed) + store failed lesson metadata
          await sb.from("course_packages").update({
            status: "publish_failed",
            meta: {
              ...currentMeta,
              publish_fail_reason: "LESSON_QC_GATE_FAILED",
              failed_lesson_ids: failedIds,
              failed_lesson_count: draftFailedCount,
              publish_retry_count: retryCount,
              auto_repair_eligible: retryCount <= maxRetries,
              last_publish_fail_at: new Date().toISOString(),
            },
          }).eq("id", packageId);

          await notify(sb, "🛑 Lesson-QC Gate: Publish blockiert",
            `${draftFailedCount} Lessons sind draft + failed. Auto-Repair ${retryCount <= maxRetries ? "wird gestartet" : "ausgeschöpft"} (Versuch ${retryCount}/${maxRetries})`,
            "quality", "error", "course_package", packageId);

          // Auto-enqueue repair job if within retry limit
          if (retryCount <= maxRetries) {
            try {
              await sb.from("job_queue").insert({
                job_type: "package_repair_failed_lessons",
                status: "pending",
                payload: {
                  package_id: packageId,
                  course_id: courseId,
                  failed_lesson_ids: failedIds,
                  publish_retry_count: retryCount,
                },
                max_attempts: 3,
              });
              console.log(`[auto-publish] 📋 Enqueued package_repair_failed_lessons (retry ${retryCount}/${maxRetries})`);
            } catch (enqErr) {
              console.warn(`[auto-publish] Failed to enqueue repair job: ${(enqErr as Error).message}`);
            }
          }

          return json({
            ok: false, retry: false,
            error: "LESSON_QC_GATE_FAILED",
            draft_failed_count: draftFailedCount,
            failed_lesson_ids: failedIds,
            publish_retry_count: retryCount,
            auto_repair_enqueued: retryCount <= maxRetries,
          }, 422);
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // QUALITY GATE v2 — COUNCIL CONSISTENCY GUARD (fail-closed)
    // council_approved MUST align with quality_council step status.
    // ══════════════════════════════════════════════════════════════
    {
      const councilStepDone = await prereqDone(sb, packageId, "quality_council");
      if (!councilStepDone) {
        console.log(`[auto-publish] 🛑 COUNCIL_GATE: quality_council step not done`);
        return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: quality_council" }, 409);
      }
    }

    // ── PUBLISH-GATE: validate approved question count ──
    const { data: publishGate } = await sb.rpc("validate_publish_readiness", { p_package_id: packageId });
    if (publishGate && !publishGate.ok) {
      console.log(`[auto-publish] 🛑 PUBLISH-GATE blocked: ${publishGate.error} (approved=${publishGate.approved_questions}/${publishGate.total_questions})`);
      await sb.from("course_packages").update({ status: "quality_gate_failed" }).eq("id", packageId);
      await notify(sb, "🛑 Publish-Gate: Keine approved Questions",
        `${publishGate.error}: ${publishGate.approved_questions}/${publishGate.total_questions} approved`,
        "quality", "error", "course_package", packageId);
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
    // FAIL-CLOSED GUARD: integrity_report MUST exist
    // If run_integrity_check is done but report is NULL, a trigger
    // or race condition cleared it. Re-queue integrity AND block
    // the package to prevent any publish path from proceeding.
    // ═══════════════════════════════════════════════════════════
    if (!integrityReport) {
      console.error(`[auto-publish] FAIL-CLOSED: integrity_report is NULL for package ${packageId.slice(0, 8)} despite run_integrity_check=done. Re-queuing integrity step + blocking package.`);

      // Re-queue integrity check step
      await sb.from("package_steps").update({
        status: "queued",
        started_at: null,
        finished_at: null,
        last_error: "INTEGRITY_REPORT_MISSING_AFTER_DONE",
        meta: {
          heal_reason: "auto_publish_detected_null_report",
          healed_at: new Date().toISOString(),
          auto_requeued_by: "package-auto-publish",
          last_progress_note: "Report was NULL at auto_publish time — re-running integrity check",
        },
      }).eq("package_id", packageId).eq("step_key", "run_integrity_check");

      // Block package + clear integrity_passed
      await sb.from("course_packages").update({
        integrity_passed: false,
        blocked_reason: "pipeline_repair_required",
        updated_at: new Date().toISOString(),
      }).eq("id", packageId);

      // Admin notification (P0)
      await notify(sb, "🚨 Auto-Publish: Integrity Report fehlt (fail-closed)",
        `Package ${packageId.slice(0, 8)}: run_integrity_check war done, aber integrity_report=NULL. Step re-queued, Package blocked.`,
        "quality", "error", "course_package", packageId);

      return json({
        ok: false, retry: true,
        code: "INTEGRITY_REPORT_MISSING_AFTER_DONE",
        error: "Integrity report missing although integrity step is done. Step re-queued, package blocked.",
        action: "re_queued_integrity_check",
      }, 409);
    }

    // ═══════════════════════════════════════════════════════════
    // COURSE_READY ENFORCEMENT — hard fails block ALL modes
    // Matches ANY COURSE_READY gate version (v1.0, v1.4, etc.)
    // ═══════════════════════════════════════════════════════════
    const gateVersion = integrityReport?.gate_version;
    const hardFails = integrityReport?.v3?.hard_fail_reasons || [];
    const isCourseReadyGate = typeof gateVersion === "string" && gateVersion.startsWith("COURSE_READY_");

    if (isCourseReadyGate && hardFails.length > 0) {
      console.log(`[auto-publish] 🛑 COURSE_READY blocked (${gateVersion}): ${hardFails.length} hard fail(s)`);
      for (const hf of hardFails) console.log(`  ❌ ${hf}`);

      await sb.from("course_packages").update({ status: "quality_gate_failed" }).eq("id", packageId);
      await notify(sb, "🛑 Auto-Publish blocked by COURSE_READY",
        `${hardFails.length} blocker(s): ${hardFails.slice(0, 3).join("; ")}`,
        "quality", "error", "course_package", packageId);

      return json({
        ok: false, retry: false,
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
        const { data: courseData } = await sb.from("courses").select("curriculum_id").eq("id", courseId).maybeSingle();
        const curriculumId = (courseData as any)?.curriculum_id;
        let liveQuestionCount = 0;
        if (curriculumId) {
          const { count } = await sb.from("exam_questions").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId).neq("status", "rejected").not("qc_status", "in", "(tier1_failed,rejected)");
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
        await notify(sb, "⚠️ Quality Gate failed",
          `Package blocked. quality_score=${qualityReport.score ?? "?"}`,
          "quality", "warning", "course_package", packageId);
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
              await notify(sb, "⚠️ Difficulty Distribution Warning",
                `easy=${easyPct.toFixed(0)}% (max 15%), hardish=${hardishPct.toFixed(0)}% (min 40%)`,
                "quality", "warning", "course_package", packageId);
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
      const { error: pErr } = await sb
        .from("course_packages")
        .update({ status: "published", council_approved: true, published_at: new Date().toISOString() })
        .eq("id", packageId);
      if (pErr) throw pErr;
    }

    // ═══════════════════════════════════════════════════════════
    // POST-CONDITION: Verify package is actually published.
    // This prevents the False-Success class where the step reports
    // ok=true but the actual status update was silently blocked.
    // ═══════════════════════════════════════════════════════════
    const { data: postCheck } = await sb
      .from("course_packages")
      .select("status")
      .eq("id", packageId)
      .maybeSingle();

    if ((postCheck as any)?.status !== "published") {
      const actualStatus = (postCheck as any)?.status ?? "UNKNOWN";
      console.error(`[auto-publish] POST_CONDITION_FAILED: package ${packageId.slice(0, 8)} status is ${actualStatus} after publish attempt`);
      return json({
        ok: false,
        retry: false,
        error: "POST_CONDITION_FAILED",
        expected: "published",
        actual: actualStatus,
      }, 422);
    }

    // ── Log excellence level ──
    const excellenceList = integrityReport?.v3?.excellence || [];
    const badge = excellenceList.length >= 3 ? "🏆 Excellence" : excellenceList.length > 0 ? "🥇 Gold" : "✅ Ready";

    await notify(sb, `🚀 ${badge} Package published`,
      `COURSE_READY passed. Score: ${integrityReport?.score ?? "?"}/100. ${excellenceList.length} excellence criteria met.`,
      "package_review", "info", "course_package", packageId);

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
        body: JSON.stringify({ package_id: packageId, curriculum_id: (pkgQ as any)?.curriculum_id ?? "", course_id: courseId, track: (pkgQ as any)?.track ?? "AUSBILDUNG_VOLL", reason: "post_publish" }),
      });
      const triggerBody = await triggerRes.json().catch(() => ({}));
      console.log(`[auto-publish] E2E trigger: ${triggerRes.status}`, triggerBody);
    } catch (e) {
      console.warn(`[auto-publish] E2E trigger failed (non-critical):`, e);
    }

    return json({ ok: true, badge, integrity_score: integrityReport?.score ?? 100, excellence: excellenceList });
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? String(e);
    console.error(`[auto-publish] FATAL:`, e);
    // Persist error for observability
    try {
      await sb.from("package_steps").update({
        last_error: `auto-publish crash: ${msg.slice(0, 2000)}`,
      }).eq("package_id", packageId).eq("step_key", "auto_publish");
    } catch (_) { /* best-effort */ }
    return json({ error: msg }, 500);
  }
});
