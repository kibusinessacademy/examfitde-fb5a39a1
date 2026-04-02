import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * package-validate-lesson-minichecks
 * 
 * Quality gate for MiniCheck questions (read-only — NO status changes):
 * - Coverage check (Learning-Track: ≥90% lessons must have MiniChecks)
 * - Min items per lesson (≥3, counted across ALL statuses)
 * - Content quality checks (explanation length, option count)
 * - Reports PASS/FAIL + quality metrics; approval via quality_council
 *
 * Job-Runner signals:
 *   NO_MINICHECKS or coverage < 10%  → retry:true, backoff_seconds:300
 *   coverage ≥ 10% but gate fails    → permanent:true
 *   gate passes                       → ok:true
 */

const MIN_ITEMS_PER_LESSON = 3;
const MIN_EXPLANATION_LENGTH = 220;
const PREREQ_COVERAGE_THRESHOLD = 0.10;

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(origin), "content-type": "application/json" },
  });
}

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

Deno.serve(async (req) => {
  const corsResp = handleCorsPreflightRequest(req);
  if (corsResp) return corsResp;

  const origin = req.headers.get("origin");
  if (req.method !== "POST") return json({ error: "Use POST" }, 405, origin);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("curriculum_id", p?.curriculum_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400, origin);
  }

  const packageId = p.package_id as string;
  const curriculumId = p.curriculum_id as string;
  const courseId = p.course_id as string | undefined;

  try {
    const { data: pkgRow } = await sb
      .from("course_packages")
      .select("track, feature_flags, course_id")
      .eq("id", packageId)
      .single();

    const featureFlags = pkgRow?.feature_flags || {};
    const hasLearningCourse = featureFlags.has_learning_course ?? (pkgRow?.track === "AUSBILDUNG_VOLL");
    const effectiveCourseId = courseId || pkgRow?.course_id;
    const mode: "lesson" | "drill" = hasLearningCourse ? "lesson" : "drill";

    const issues: Array<{ severity: string; code: string; message: string }> = [];

    // Count total MiniCheck questions (all statuses)
    const { count: totalCount } = await sb
      .from("minicheck_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .eq("mode", mode);

    if (!totalCount || totalCount === 0) {
      console.log(`[ValidateMini] ${packageId}: NO_MINICHECKS → retry`);
      return json({
        ok: false,
        retry: true,
        backoff_seconds: 300,
        error: "GATE_FAIL: NO_MINICHECKS",
        classification: "prereq_not_ready",
        reason_code: "NO_MINICHECKS",
        issues: [{ severity: "critical", code: "NO_MINICHECKS", message: `Keine MiniCheck-Fragen (${mode}) für Curriculum gefunden` }],
        total: 0,
      }, 200, origin);
    }

    // Quality checks on draft questions (read-only)
    const { data: allQuestions } = await sb
      .from("minicheck_questions")
      .select("id, lesson_id, competency_id, question_text, options, explanation, difficulty, status")
      .eq("curriculum_id", curriculumId)
      .eq("mode", mode)
      .eq("status", "draft")
      .limit(2000);

    let qualityPass = 0;
    let qualityFails = 0;
    const passedIds: string[] = [];

    for (const q of allQuestions || []) {
      let isValid = true;
      const opts = Array.isArray(q.options) ? q.options : [];
      if (opts.length !== 4) isValid = false;
      if (!q.explanation || q.explanation.length < MIN_EXPLANATION_LENGTH) isValid = false;
      if (!q.question_text || q.question_text.length < 15) isValid = false;

      if (isValid) {
        qualityPass++;
        passedIds.push(q.id);
      } else {
        qualityFails++;
      }
    }

    // Coverage check for lesson mode
    let coverage: number | null = null;

    if (mode === "lesson" && effectiveCourseId) {
      const { data: modules } = await sb
        .from("modules")
        .select("id")
        .eq("course_id", effectiveCourseId);
      const moduleIds = (modules || []).map((m: any) => m.id);

      let lessons: any[] = [];
      if (moduleIds.length > 0) {
        const { data: modLessons } = await sb
          .from("lessons")
          .select("id")
          .in("module_id", moduleIds)
          .not("content", "is", null)
          .neq("step", "mini_check");
        lessons = modLessons || [];
      }

      const totalLessons = lessons.length;
      if (totalLessons > 0) {
        const lessonIds = lessons.map((l: any) => l.id);

        // Chunked loading to avoid 1000-row default limit
        const allLessonRows: Array<{ lesson_id: string }> = [];
        for (let i = 0; i < lessonIds.length; i += 200) {
          const chunk = lessonIds.slice(i, i + 200);
          const { data: chunkRows } = await sb
            .from("minicheck_questions")
            .select("lesson_id")
            .in("lesson_id", chunk)
            .eq("mode", "lesson")
            .limit(5000);
          if (chunkRows) allLessonRows.push(...chunkRows);
        }

        const countByLesson = new Map<string, number>();
        for (const r of allLessonRows) {
          if (!r.lesson_id) continue;
          countByLesson.set(r.lesson_id, (countByLesson.get(r.lesson_id) || 0) + 1);
        }

        const coveredCount = countByLesson.size;
        coverage = coveredCount / totalLessons;

        if (coverage < 0.9) {
          issues.push({
            severity: "critical",
            code: "LOW_COVERAGE",
            message: `MiniCheck-Abdeckung: ${(coverage * 100).toFixed(0)}% der Lektionen (${coveredCount}/${totalLessons}) — mindestens 90% erforderlich`,
          });
        } else if (coverage < 0.97) {
          issues.push({
            severity: "warning",
            code: "PARTIAL_COVERAGE",
            message: `MiniCheck-Abdeckung: ${(coverage * 100).toFixed(0)}% der Lektionen (${coveredCount}/${totalLessons})`,
          });
        }

        // Min items per lesson
        let tooFew = 0;
        for (const lid of lessonIds) {
          const c = countByLesson.get(lid) || 0;
          if (c < MIN_ITEMS_PER_LESSON) tooFew++;
        }
        if (tooFew > 0) {
          issues.push({
            severity: "critical",
            code: "MIN_ITEMS_PER_LESSON",
            message: `${tooFew} Lektionen haben <${MIN_ITEMS_PER_LESSON} MiniChecks (Pflicht)`,
          });
        }
      }
    }

    if (qualityFails > 0) {
      issues.push({
        severity: "info",
        code: "QUALITY_REJECTS",
        message: `${qualityFails} Fragen fielen durch die Qualitätsprüfung`,
      });
    }

    const hasCritical = issues.some(i => i.severity === "critical");

    console.log(`[ValidateMini] ${packageId} ${mode}: ${qualityPass} passed, ${qualityFails} rejected, coverage=${coverage !== null ? (coverage * 100).toFixed(0) + '%' : 'n/a'}, critical=${hasCritical}`);

    // Gate passed
    if (!hasCritical) {
      return json({
        ok: true,
        total: totalCount,
        quality_pass: qualityPass,
        quality_fail: qualityFails,
        passed_ids: passedIds,
        issues,
      }, 200, origin);
    }

    // Gate failed — classify retry vs permanent
    const coveragePct = coverage !== null ? (coverage * 100).toFixed(0) : '?';

    if (coverage !== null && coverage < PREREQ_COVERAGE_THRESHOLD) {
      // Prerequisites not ready yet — retry with backoff
      return json({
        ok: false,
        retry: true,
        backoff_seconds: 300,
        error: `GATE_FAIL: LOW_COVERAGE ${coveragePct}% (prereqs not ready)`,
        classification: "prereq_not_ready",
        reason_code: "LOW_COVERAGE",
        coverage_state: coverage < 0.01 ? "none" : "bootstrap",
        total: totalCount,
        quality_pass: qualityPass,
        quality_fail: qualityFails,
        issues,
      }, 200, origin);
    }

    // Genuine gate failure — don't retry
    return json({
      ok: false,
      permanent: true,
      error: `GATE_FAIL: coverage=${coveragePct}%, critical_issues=${issues.filter(i => i.severity === 'critical').length}`,
      total: totalCount,
      quality_pass: qualityPass,
      quality_fail: qualityFails,
      passed_ids: passedIds,
      issues,
    }, 200, origin);

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ValidateMini] FATAL: ${msg}`);
    return json({
      ok: false,
      retry: true,
      transient: true,
      backoff_seconds: 120,
      error: `UNHANDLED_EXCEPTION: ${msg}`,
      classification: "transient_error",
    }, 200, origin);
  }
});
