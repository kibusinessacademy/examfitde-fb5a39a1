import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * package-validate-lesson-minichecks
 * 
 * Quality gate for MiniCheck questions:
 * - Minimum question count per lesson/competency
 * - Content quality checks (explanation length, option count, etc.)
 * - Coverage check (Learning-Track: ≥90% lessons must have MiniChecks)
 * - NO auto-approve: only reports PASS/FAIL + quality metrics (Fix #4)
 *   Actual approval happens in quality_council step.
 */

const MIN_ITEMS_PER_LESSON = 3;
const MIN_EXPLANATION_LENGTH = 30;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("curriculum_id", p?.curriculum_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id as string;
  const curriculumId = p.curriculum_id as string;
  const courseId = p.course_id as string | undefined;

  try {
    // Determine mode
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

    // Count total MiniCheck questions
    const { count: totalCount } = await sb
      .from("minicheck_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .eq("mode", mode);

    if (!totalCount || totalCount === 0) {
      issues.push({
        severity: "critical",
        code: "NO_MINICHECKS",
        message: `Keine MiniCheck-Fragen (${mode}) für Curriculum gefunden`,
      });
      return json({ ok: false, issues, total: 0 });
    }

    // Quality checks on individual questions (read-only — NO status changes, Fix #4)
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

      // Check option count (supports both {text}[] and string[])
      const opts = Array.isArray(q.options) ? q.options : [];
      if (opts.length !== 4) { isValid = false; }

      // Check explanation length
      if (!q.explanation || q.explanation.length < MIN_EXPLANATION_LENGTH) { isValid = false; }

      // Check question text
      if (!q.question_text || q.question_text.length < 15) { isValid = false; }

      if (isValid) {
        qualityPass++;
        passedIds.push(q.id);
      } else {
        qualityFails++;
      }
    }

    // Fix #4: NO auto-approve — just report which IDs passed validation
    // Actual status='approved' happens in quality_council step

    // Coverage check for lesson mode (Fix #5: strict thresholds)
    if (mode === "lesson" && effectiveCourseId) {
      const { data: lessons } = await sb
        .from("lessons")
        .select("id")
        .eq("course_id", effectiveCourseId)
        .not("content", "is", null);

      const totalLessons = lessons?.length || 0;
      if (totalLessons > 0) {
        const lessonIds = lessons!.map(l => l.id);
        const { data: coveredLessons } = await sb
          .from("minicheck_questions")
          .select("lesson_id")
          .in("lesson_id", lessonIds)
          .eq("mode", "lesson");

        const coveredSet = new Set((coveredLessons || []).map(c => c.lesson_id));
        const coverage = coveredSet.size / totalLessons;

        // Fix #5: Learning-Track coverage must be ≥90%
        if (coverage < 0.9) {
          issues.push({
            severity: "critical",
            code: "LOW_COVERAGE",
            message: `MiniCheck-Abdeckung: ${(coverage * 100).toFixed(0)}% der Lektionen (${coveredSet.size}/${totalLessons}) — mindestens 90% erforderlich`,
          });
        } else if (coverage < 0.97) {
          issues.push({
            severity: "warning",
            code: "PARTIAL_COVERAGE",
            message: `MiniCheck-Abdeckung: ${(coverage * 100).toFixed(0)}% der Lektionen (${coveredSet.size}/${totalLessons})`,
          });
        }

        // Fix #5: Check min items per lesson
        const { data: perLessonCounts } = await sb
          .from("minicheck_questions")
          .select("lesson_id")
          .in("lesson_id", lessonIds)
          .eq("mode", "lesson")
          .eq("status", "draft");

        if (perLessonCounts) {
          const countByLesson = new Map<string, number>();
          for (const r of perLessonCounts) {
            countByLesson.set(r.lesson_id, (countByLesson.get(r.lesson_id) || 0) + 1);
          }
          let tooFew = 0;
          for (const lid of coveredSet) {
            if ((countByLesson.get(lid) || 0) < MIN_ITEMS_PER_LESSON) tooFew++;
          }
          if (tooFew > 0) {
            issues.push({
              severity: "warning",
              code: "LOW_ITEM_COUNT",
              message: `${tooFew} Lektionen haben weniger als ${MIN_ITEMS_PER_LESSON} MiniCheck-Fragen`,
            });
          }
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

    console.log(`[ValidateMini] ${mode}: ${qualityPass} passed, ${qualityFails} rejected, critical=${hasCritical}`);

    return json({
      ok: !hasCritical,
      total: totalCount,
      quality_pass: qualityPass,
      quality_fail: qualityFails,
      passed_ids: passedIds,
      issues,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ValidateMini] FATAL: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});
