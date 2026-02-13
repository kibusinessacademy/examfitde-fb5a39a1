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
  const { data, error } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (error) throw error;
  return data?.status === "done";
}

// ── Export JSON builder (sanitized for ChatGPT review) ──────────────
async function buildExportJson(sb: ReturnType<typeof createClient>, packageId: string, courseId: string, curriculumId: string, report: Record<string, unknown>) {
  // Package metadata
  const { data: pkg } = await sb.from("course_packages").select("id, course_id, title, status, created_at, build_progress").eq("id", packageId).single();

  // Course
  const { data: course } = await sb.from("courses").select("id, slug, curriculum_id, status").eq("id", courseId).single();

  // Build steps
  const { data: steps } = await sb.from("course_package_build_steps").select("step_key, status").eq("package_id", packageId).order("sort_order");

  // Curriculum summary
  const { data: curriculum } = await sb.from("curricula").select("id, certification_id, title").eq("id", curriculumId).single();
  const { data: topics } = await sb.from("curriculum_topics").select("id, learning_field_id").eq("curriculum_id", curriculumId);
  const { data: lfs } = await sb.from("curriculum_learning_fields").select("id, title, weight").eq("curriculum_id", curriculumId);

  // Lessons
  const { data: modules } = await sb.from("course_modules").select("id").eq("course_id", courseId);
  const moduleIds = (modules || []).map(m => m.id);
  let lessonCount = 0;
  let sampleLessons: unknown[] = [];
  if (moduleIds.length > 0) {
    const { count } = await sb.from("lessons").select("id", { count: "exact", head: true }).in("module_id", moduleIds);
    lessonCount = count || 0;
    const { data: samples } = await sb.from("lessons").select("id, title, lesson_type").in("module_id", moduleIds).limit(5);
    sampleLessons = samples || [];
  }

  // Exam questions (sanitized – no correct answers)
  const { data: examQs } = await sb.from("exam_questions").select("id, question_text, options, difficulty, bloom_level, topic_id").eq("curriculum_id", curriculumId).limit(20);
  const sanitizedQuestions = (examQs || []).map(q => ({
    id: q.id,
    question_text: q.question_text,
    options: Array.isArray(q.options) ? (q.options as any[]).map((o: any) => ({ text: o.text || o })) : [],
    difficulty: q.difficulty,
    bloom_level: q.bloom_level,
  }));
  const { count: examTotal } = await sb.from("exam_questions").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId);

  // Oral exam scenarios
  const { data: oralScenarios } = await sb.from("oral_exam_scenarios").select("id, title, situation_description").eq("curriculum_id", curriculumId).limit(10);
  const { count: oralTotal } = await sb.from("oral_exam_scenarios").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId);

  // AI Tutor index
  const { data: tutorIdx } = await sb.from("ai_tutor_context_index").select("id, index_version, created_at, stats").eq("package_id", packageId).order("created_at", { ascending: false }).limit(1).maybeSingle();

  // Handbook
  const { data: hbChapters } = await sb.from("handbook_chapters").select("id, title").eq("course_id", courseId);
  const { data: hbSections } = await sb.from("handbook_sections").select("id, title, chapter_id").eq("course_id", courseId).limit(5);

  return {
    _meta: { generated_at: new Date().toISOString(), version: "1.0", purpose: "ChatGPT review export" },
    package: {
      id: pkg?.id, course_id: pkg?.course_id, title: pkg?.title,
      status: pkg?.status, created_at: pkg?.created_at,
      completed_steps: (steps || []).filter(s => s.status === "done").map(s => s.step_key),
      all_steps: (steps || []).map(s => ({ key: s.step_key, status: s.status })),
    },
    curriculum: {
      id: curriculum?.id, certification_id: curriculum?.certification_id, title: curriculum?.title,
      topic_count: (topics || []).length,
      learning_fields: (lfs || []).map(lf => ({ title: lf.title, weight: lf.weight })),
    },
    lessons: {
      module_count: moduleIds.length,
      lesson_count: lessonCount,
      sample_lessons: sampleLessons,
    },
    exam: {
      target: 1000,
      generated_count: examTotal || 0,
      sample_questions: sanitizedQuestions,
    },
    oral: {
      scenario_count: oralTotal || 0,
      sample_scenarios: oralScenarios || [],
    },
    tutor: {
      index_exists: !!tutorIdx,
      index_version: tutorIdx?.index_version,
      last_built_at: tutorIdx?.created_at,
      stats: tutorIdx?.stats,
    },
    handbook: {
      chapter_count: (hbChapters || []).length,
      section_count: (hbSections || []).length,
      sample_sections: hbSections || [],
    },
    integrity: {
      passed: report?.passed,
      score: report?.score,
      warnings: report?.warnings,
      issues: report?.issues,
    },
    links: {
      admin_workspace_url: `/admin/studio/${packageId}`,
      course_public_url: course?.slug ? `/course/${course.slug}` : null,
    },
  };
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

  const packageId = p.package_id;
  const options = p.options || {};

  // Resolve course_id and curriculum_id from package
  let courseId = p.course_id;
  let curriculumId = p.curriculum_id;

  if (!courseId || !curriculumId) {
    const { data: pkg, error: pkgErr } = await sb
      .from("course_packages").select("course_id").eq("id", packageId).single();
    if (pkgErr || !pkg) return json({ error: "Package not found" }, 404);
    courseId = pkg.course_id;

    const { data: crs, error: crsErr } = await sb
      .from("courses").select("curriculum_id").eq("id", courseId).single();
    if (crsErr || !crs) return json({ error: "Course not found" }, 404);
    curriculumId = crs.curriculum_id;
  }

  const unlockFail = async (msg: string, report?: unknown) => {
    await sb.from("course_packages").update({
      status: "failed",
      integrity_passed: false,
      integrity_report: report || { error: msg },
    }).eq("id", packageId);
    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "run_integrity_check", p_status: "failed",
      p_log: { error: msg, report },
    });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    // Prereq: handbook must be done
    if (!(await prereqDone(sb, packageId, "generate_handbook"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: generate_handbook" }, 409);
    }

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "run_integrity_check", p_status: "running",
      p_log: { note: "Running validate_course_integrity_v2" },
    });

    // Call the enhanced integrity check
    const { data, error } = await sb.rpc("validate_course_integrity_v2", {
      p_curriculum_id: curriculumId,
    });

    if (error) throw error;

    const report = data as Record<string, unknown>;
    const passed = Boolean(report?.passed);
    const score = Number(report?.score ?? 0);

    // Build human-readable summary for the step log
    const summary = {
      score,
      passed,
      lessons: `${(report?.lessons as any)?.actual || 0}/${(report?.lessons as any)?.expected || 0}`,
      exam_questions: `${(report?.exam as any)?.total || 0}/${(report?.exam as any)?.target || 1000}`,
      oral_scenarios: `${(report?.oral as any)?.total || 0}/${(report?.oral as any)?.target || 20}`,
      handbook_chapters: `${(report?.handbook as any)?.chapters || 0}/${(report?.handbook as any)?.target || 5}`,
      tutor_index: Boolean(report?.tutor_index),
      issues: ((report?.issues as any[]) || []).length,
      warnings: ((report?.warnings as any[]) || []).length,
    };

    if (!passed) {
      // ── FAILED: block + create review + notify ──
      await unlockFail(`Integrity Score ${score}/100 – ${summary.issues} critical issues`, report);

      // Upsert review as queued/blocked
      await sb.from("course_package_reviews").upsert({
        course_package_id: packageId,
        status: "queued",
        integrity_score: score,
        integrity_report: report,
        notes: `Integrity failed – score ${score}/100, ${summary.issues} issues`,
      }, { onConflict: "course_package_id" });

      // Admin notification
      await sb.from("admin_notifications").insert({
        title: `❌ Package blocked – Score ${score}`,
        body: `Integrity check failed for package. ${summary.issues} critical issues found.`,
        category: "package_review",
        severity: "warn",
        entity_type: "course_package",
        entity_id: packageId,
      });

      // === Auto-Gap-Closer Trigger ===
      const autoFixTarget = options.autofix_target_score || 60;
      const shouldAutoFix = options.auto_gap_close !== false;

      if (shouldAutoFix) {
        try {
          const { data: existingRun } = await sb.from("autofix_runs")
            .select("id, created_at").eq("package_id", packageId).eq("status", "running").maybeSingle();
          const { data: recentRun } = await sb.from("autofix_runs")
            .select("id, created_at").eq("package_id", packageId)
            .in("status", ["running", "succeeded", "stopped"])
            .gte("created_at", new Date(Date.now() - 6 * 3600_000).toISOString())
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          const { data: queuedJob } = await sb.from("job_queue")
            .select("id").eq("job_type", "auto_gap_close")
            .in("status", ["pending", "processing"])
            .contains("payload", { package_id: packageId } as any)
            .limit(1).maybeSingle();

          if (!existingRun && !recentRun && !queuedJob && curriculumId) {
            await sb.from("job_queue").insert({
              job_type: "auto_gap_close", status: "pending",
              payload: { package_id: packageId, course_id: courseId, curriculum_id: curriculumId, target_score: autoFixTarget, max_rounds: 3, budget_eur: 2.0, triggered_by: "integrity_check_auto" },
              max_attempts: 1,
            });
          }
        } catch (autoErr) {
          console.error("[IntegrityCheck] Auto-Gap-Closer trigger failed (non-fatal):", (autoErr as Error).message);
        }
      }

      return json({ ok: false, error: `Integrity check failed (score: ${score})`, report, auto_gap_close_triggered: shouldAutoFix ?? false }, 422);
    }

    // ── PASSED: ready_for_review + export + notify ──
    await sb.from("course_packages").update({
      integrity_passed: true,
      integrity_report: report,
      status: "ready_for_review",
      build_progress: 95,
    }).eq("id", packageId);

    // Generate export JSON
    let exportJson: unknown = null;
    try {
      exportJson = await buildExportJson(sb, packageId, courseId, curriculumId, report);
    } catch (expErr) {
      console.error("[IntegrityCheck] Export JSON build failed (non-fatal):", (expErr as Error).message);
      exportJson = { error: "export_build_failed", message: (expErr as Error).message };
    }

    // Upsert review as ready
    await sb.from("course_package_reviews").upsert({
      course_package_id: packageId,
      status: "ready",
      integrity_score: score,
      integrity_report: report,
      export_json: exportJson,
    }, { onConflict: "course_package_id" });

    // Admin notification
    await sb.from("admin_notifications").insert({
      title: `✅ Package ready for review – Score ${score}`,
      body: `Integrity passed. Review & approve to publish.`,
      category: "package_review",
      severity: "info",
      entity_type: "course_package",
      entity_id: packageId,
    });

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "run_integrity_check", p_status: "done",
      p_log: { ok: true, ...summary, review_status: "ready_for_review" },
    });

    return json({ ok: true, score, summary, review_status: "ready_for_review" });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    await unlockFail(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
