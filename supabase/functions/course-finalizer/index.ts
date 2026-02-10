import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { courseId, curriculum_id } = await req.json();
    const targetCourseId = courseId;
    if (!targetCourseId) {
      return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // PRODUCTION GATE: Check if course is already sealed (no re-finalization)
    const { data: existingCourse } = await admin.from("courses")
      .select("autopilot_status, autopilot_sealed_at")
      .eq("id", targetCourseId).single();

    if (existingCourse?.autopilot_status === 'sealed') {
      return new Response(JSON.stringify({ 
        error: "SEALED_COURSE: Kurs ist bereits versiegelt. Keine erneute Finalisierung möglich.",
        sealed_at: existingCourse.autopilot_sealed_at 
      }), { status: 409, headers });
    }

    if (existingCourse?.autopilot_status === 'finalizing') {
      return new Response(JSON.stringify({ 
        error: "PARALLEL_FINALIZE: Finalisierung läuft bereits." 
      }), { status: 409, headers });
    }

    // 1) Set status to finalizing
    await admin.from("courses").update({
      autopilot_status: "finalizing",
      updated_at: new Date().toISOString(),
    }).eq("id", targetCourseId);

    // 2) Load course + modules + lessons
    const { data: course } = await admin.from("courses").select("id, curriculum_id, title").eq("id", targetCourseId).single();
    if (!course) {
      return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers });
    }

    const curriculumId = course.curriculum_id || curriculum_id;

    const { data: modules } = await admin.from("modules").select("id, learning_field_id").eq("course_id", targetCourseId);
    const moduleIds = (modules || []).map((m: { id: string }) => m.id);

    const { data: lessons } = await admin.from("lessons")
      .select("id, title, module_id, competency_id, step_type, content")
      .in("module_id", moduleIds.length > 0 ? moduleIds : ["__none__"]);

    const allLessons = lessons || [];

    // 3) Curriculum competencies for coverage check
    const { data: learningFields } = await admin.from("learning_fields")
      .select("id").eq("curriculum_id", curriculumId);
    const lfIds = (learningFields || []).map((lf: { id: string }) => lf.id);

    const { data: competencies } = await admin.from("competencies")
      .select("id").in("learning_field_id", lfIds.length > 0 ? lfIds : ["__none__"]);
    const allCompetencyIds = new Set((competencies || []).map((c: { id: string }) => c.id));

    // 4) Analyze: duplicates, empty content, coverage
    const titleCounts: Record<string, number> = {};
    let emptyCount = 0;
    let totalWords = 0;
    const coveredCompetencies = new Set<string>();
    const stepCounts: Record<string, number> = {};

    for (const lesson of allLessons) {
      const l = lesson as { title: string; content: string | null; competency_id: string | null; step_type: string | null };
      // Title dedup
      const normTitle = (l.title || "").toLowerCase().trim();
      titleCounts[normTitle] = (titleCounts[normTitle] || 0) + 1;

      // Empty content
      const content = l.content || "";
      if (content.length < 50) emptyCount++;

      // Word count
      totalWords += content.split(/\s+/).filter(Boolean).length;

      // Coverage
      if (l.competency_id) coveredCompetencies.add(l.competency_id);

      // Step distribution
      const step = l.step_type || "unknown";
      stepCounts[step] = (stepCounts[step] || 0) + 1;
    }

    const duplicateTitles = Object.values(titleCounts).filter(c => c > 1).length;
    const avgWordCount = allLessons.length > 0 ? Math.round(totalWords / allLessons.length) : 0;

    // 5) Build issues list
    const issues: Array<{ severity: string; code: string; message: string; count?: number }> = [];

    if (duplicateTitles > 0) {
      issues.push({
        severity: "warning",
        code: "DUPLICATE_TITLES",
        message: `${duplicateTitles} Lektionen mit doppelten Titeln gefunden`,
        count: duplicateTitles,
      });
    }

    if (emptyCount > 0) {
      issues.push({
        severity: "critical",
        code: "EMPTY_CONTENT",
        message: `${emptyCount} Lektionen mit leerem/minimalem Inhalt`,
        count: emptyCount,
      });
    }

    const uncoveredCount = allCompetencyIds.size - coveredCompetencies.size;
    if (uncoveredCount > 0) {
      issues.push({
        severity: "critical",
        code: "MISSING_COMPETENCIES",
        message: `${uncoveredCount} Kompetenzen ohne Lektionen`,
        count: uncoveredCount,
      });
    }

    // 6) Calculate health score
    let healthScore = 100;
    if (duplicateTitles > 0) healthScore -= Math.min(duplicateTitles * 2, 15);
    if (emptyCount > 0) healthScore -= Math.min(emptyCount * 5, 30);
    if (uncoveredCount > 0) healthScore -= Math.min(uncoveredCount * 10, 40);
    if (avgWordCount < 100) healthScore -= 10;
    healthScore = Math.max(0, healthScore);

    const healthStatus = healthScore >= 85 ? "healthy" : healthScore >= 60 ? "warning" : "critical";

    // 7) Save snapshot
    await admin.from("course_health_snapshots").insert({
      course_id: targetCourseId,
      snapshot_type: "seal",
      lesson_count: allLessons.length,
      competency_count: allCompetencyIds.size,
      covered_competency_count: coveredCompetencies.size,
      step_distribution: stepCounts,
      duplicate_titles: duplicateTitles,
      empty_content_count: emptyCount,
      avg_word_count: avgWordCount,
      health_score: healthScore,
      health_status: healthStatus,
      issues,
      benchmarks: {
        expected_lessons: allCompetencyIds.size * 5,
        lessons_per_competency: allCompetencyIds.size > 0
          ? (allLessons.length / allCompetencyIds.size).toFixed(1)
          : 0,
      },
    });

    // 8) Seal the course
    await admin.from("courses").update({
      autopilot_status: "sealed",
      autopilot_sealed_at: new Date().toISOString(),
      status: "draft", // ready for review
      updated_at: new Date().toISOString(),
    }).eq("id", targetCourseId);

    console.log(`[Finalizer] Course ${targetCourseId.slice(0, 8)} sealed: score=${healthScore}, issues=${issues.length}`);

    return new Response(JSON.stringify({
      success: true,
      courseId: targetCourseId,
      healthScore,
      healthStatus,
      lessonCount: allLessons.length,
      competencyCoverage: `${coveredCompetencies.size}/${allCompetencyIds.size}`,
      duplicateTitles,
      emptyContent: emptyCount,
      issues,
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Finalizer] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
  }
});
