import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Course Finalizer – Production Gate
 * 
 * 4-step quality check before sealing:
 * 1. Structure Check (steps per competency)
 * 2. Duplicate Check (title + objective similarity)
 * 3. Exam Coverage Check (competency weights)
 * 4. Final Seal (read-only lock)
 */

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { courseId, curriculum_id, dryRun } = await req.json();
    if (!courseId) {
      return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // PRODUCTION GATE: Check seal status
    const { data: existingCourse } = await admin.from("courses")
      .select("autopilot_status, autopilot_sealed_at")
      .eq("id", courseId).single();

    if (existingCourse?.autopilot_status === 'sealed') {
      return new Response(JSON.stringify({
        error: "SEALED_COURSE: Kurs ist bereits versiegelt.",
        sealed_at: existingCourse.autopilot_sealed_at
      }), { status: 409, headers });
    }

    if (existingCourse?.autopilot_status === 'finalizing') {
      return new Response(JSON.stringify({
        error: "PARALLEL_FINALIZE: Finalisierung läuft bereits."
      }), { status: 409, headers });
    }

    // Set status to finalizing
    await admin.from("courses").update({
      autopilot_status: "finalizing",
      updated_at: new Date().toISOString(),
    }).eq("id", courseId);

    // Load course
    const { data: course } = await admin.from("courses")
      .select("id, curriculum_id, title")
      .eq("id", courseId).single();
    if (!course) {
      return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers });
    }

    const curriculumId = course.curriculum_id || curriculum_id;

    // Load modules + lessons
    const { data: modules } = await admin.from("modules")
      .select("id, title, learning_field_id, sort_order, learning_field_code")
      .eq("course_id", courseId)
      .order("sort_order");

    const moduleIds = (modules || []).map((m: any) => m.id);

    const { data: lessons } = await admin.from("lessons")
      .select("id, title, module_id, competency_id, step_type, step, content, html, objectives, exam_block, weight_tag")
      .in("module_id", moduleIds.length > 0 ? moduleIds : ["__none__"])
      .order("sort_order");

    const allLessons = lessons || [];

    // Load competencies
    const { data: learningFields } = await admin.from("learning_fields")
      .select("id, title, weight_percent")
      .eq("curriculum_id", curriculumId);
    const lfIds = (learningFields || []).map((lf: any) => lf.id);

    const { data: competencies } = await admin.from("competencies")
      .select("id, title, code, learning_field_id")
      .in("learning_field_id", lfIds.length > 0 ? lfIds : ["__none__"]);

    const allCompetencyIds = new Set((competencies || []).map((c: any) => c.id));

    // ============ CHECK 1: Structure Check ============
    const structureIssues: any[] = [];
    const expectedSteps = ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"];
    const moduleMap = new Map((modules || []).map((m: any) => [m.id, m]));

    for (const mod of (modules || [])) {
      const modLessons = allLessons.filter((l: any) => l.module_id === mod.id);
      const steps = modLessons.map((l: any) => l.step || l.step_type).filter(Boolean);
      for (const expected of expectedSteps) {
        if (!steps.includes(expected)) {
          structureIssues.push({
            severity: "critical",
            code: "MISSING_STEP",
            module: mod.title,
            message: `Modul "${mod.title}": Step "${expected}" fehlt`,
          });
        }
      }
      // Check for empty content
      for (const l of modLessons) {
        const content = l.content || l.html || "";
        const plainText = content.replace(/<[^>]*>/g, "");
        const wordCount = plainText.split(/\s+/).filter(Boolean).length;
        if (wordCount < 50) {
          structureIssues.push({
            severity: "critical",
            code: "EMPTY_CONTENT",
            lesson: l.title,
            message: `Lektion "${l.title}": nur ${wordCount} Wörter (Min: 50)`,
          });
        }
      }
    }

    // ============ CHECK 2: Duplicate Check ============
    const duplicateIssues: any[] = [];
    const duplicateIds: string[] = [];

    // Title-based dedup (normalized)
    const titleGroups = new Map<string, any[]>();
    for (const l of allLessons) {
      const norm = (l.title || "").toLowerCase().trim()
        .replace(/\s+/g, " ")
        .replace(/[–—-]/g, "-");
      if (!titleGroups.has(norm)) titleGroups.set(norm, []);
      titleGroups.get(norm)!.push(l);
    }

    for (const [title, group] of titleGroups) {
      if (group.length > 1) {
        duplicateIssues.push({
          severity: "warning",
          code: "DUPLICATE_TITLE",
          title,
          count: group.length,
          lessonIds: group.map((l: any) => l.id),
          message: `"${group[0].title}" existiert ${group.length}x`,
        });
        // Mark all but the first as duplicates
        for (let i = 1; i < group.length; i++) {
          duplicateIds.push(group[i].id);
        }
      }
    }

    // Objective-based similarity (Jaccard on objectives arrays)
    const objectiveLessons = allLessons.filter((l: any) => l.objectives && l.objectives.length > 0);
    for (let i = 0; i < objectiveLessons.length; i++) {
      for (let j = i + 1; j < objectiveLessons.length; j++) {
        const a = new Set((objectiveLessons[i].objectives || []).map((o: string) => o.toLowerCase().trim()));
        const b = new Set((objectiveLessons[j].objectives || []).map((o: string) => o.toLowerCase().trim()));
        if (a.size === 0 || b.size === 0) continue;
        const intersection = new Set([...a].filter(x => b.has(x)));
        const union = new Set([...a, ...b]);
        const jaccard = intersection.size / union.size;
        if (jaccard > 0.85) {
          duplicateIssues.push({
            severity: "warning",
            code: "SIMILAR_OBJECTIVES",
            similarity: Math.round(jaccard * 100),
            lessonA: objectiveLessons[i].title,
            lessonB: objectiveLessons[j].title,
            message: `"${objectiveLessons[i].title}" & "${objectiveLessons[j].title}" – ${Math.round(jaccard * 100)}% Lernziel-Überlappung`,
          });
          if (!duplicateIds.includes(objectiveLessons[j].id)) {
            duplicateIds.push(objectiveLessons[j].id);
          }
        }
      }
    }

    // ============ CHECK 3: Exam Coverage ============
    const coverageIssues: any[] = [];
    const coveredCompetencies = new Set<string>();
    const competencyLessonCount = new Map<string, number>();
    const stepCounts: Record<string, number> = {};
    let totalWords = 0;
    let emptyCount = 0;
    let examBlockCount = 0;
    let weightTagCount = 0;

    for (const l of allLessons) {
      if (l.competency_id) {
        coveredCompetencies.add(l.competency_id);
        competencyLessonCount.set(l.competency_id, (competencyLessonCount.get(l.competency_id) || 0) + 1);
      }
      const step = l.step || l.step_type || "unknown";
      stepCounts[step] = (stepCounts[step] || 0) + 1;

      const content = l.content || l.html || "";
      const plainText = content.replace(/<[^>]*>/g, "");
      const wc = plainText.split(/\s+/).filter(Boolean).length;
      totalWords += wc;
      if (wc < 50) emptyCount++;
      if (l.exam_block) examBlockCount++;
      if (l.weight_tag) weightTagCount++;
    }

    // Missing competencies
    const missingCompetencies: any[] = [];
    for (const comp of (competencies || [])) {
      if (!coveredCompetencies.has(comp.id)) {
        const lf = (learningFields || []).find((f: any) => f.id === comp.learning_field_id);
        missingCompetencies.push({
          id: comp.id,
          code: comp.code,
          title: comp.title,
          learningField: lf?.title || "unbekannt",
        });
        coverageIssues.push({
          severity: "critical",
          code: "MISSING_COMPETENCY",
          competency: comp.title,
          message: `Kompetenz "${comp.code}: ${comp.title}" hat keine Lektionen`,
        });
      }
    }

    // Under-represented competencies (< 3 lessons)
    for (const [compId, count] of competencyLessonCount) {
      if (count < 3) {
        const comp = (competencies || []).find((c: any) => c.id === compId);
        coverageIssues.push({
          severity: "warning",
          code: "UNDERREPRESENTED",
          competency: comp?.title || compId,
          lessonCount: count,
          message: `Kompetenz "${comp?.code || '?'}: ${comp?.title || compId}" nur ${count} Lektionen (empfohlen: ≥5)`,
        });
      }
    }

    // ============ BUILD RESULTS ============
    const allIssues = [...structureIssues, ...duplicateIssues, ...coverageIssues];
    const criticalCount = allIssues.filter(i => i.severity === "critical").length;
    const warningCount = allIssues.filter(i => i.severity === "warning").length;

    // Health Score (weighted)
    let healthScore = 100;
    healthScore -= Math.min(criticalCount * 8, 40);     // Critical issues: -8 each, max -40
    healthScore -= Math.min(warningCount * 2, 20);       // Warnings: -2 each, max -20
    healthScore -= Math.min(duplicateIds.length * 1, 15); // Duplicates: -1 each, max -15
    healthScore -= Math.min(emptyCount * 5, 25);          // Empty: -5 each, max -25
    const uncoveredCount = allCompetencyIds.size - coveredCompetencies.size;
    if (uncoveredCount > 0) healthScore -= Math.min(uncoveredCount * 10, 30);
    const avgWordCount = allLessons.length > 0 ? Math.round(totalWords / allLessons.length) : 0;
    if (avgWordCount < 100) healthScore -= 5;
    healthScore = Math.max(0, healthScore);

    const healthStatus = healthScore >= 85 ? "healthy" : healthScore >= 60 ? "warning" : "critical";

    // Go/No-Go Checklist
    const goNoGo = {
      structureComplete: structureIssues.filter(i => i.code === "MISSING_STEP").length === 0,
      noDuplicates: duplicateIds.length === 0,
      fullCoverage: uncoveredCount === 0,
      noEmptyContent: emptyCount === 0,
      minAvgWords: avgWordCount >= 100,
      examBlocksPresent: examBlockCount > 0,
    };
    const isGoReady = Object.values(goNoGo).every(Boolean);

    // Save snapshot
    await admin.from("course_health_snapshots").insert({
      course_id: courseId,
      snapshot_type: "seal",
      lesson_count: allLessons.length,
      competency_count: allCompetencyIds.size,
      covered_competency_count: coveredCompetencies.size,
      step_distribution: stepCounts,
      duplicate_titles: duplicateIds.length,
      empty_content_count: emptyCount,
      avg_word_count: avgWordCount,
      health_score: healthScore,
      health_status: healthStatus,
      issues: allIssues,
      benchmarks: {
        expected_lessons: allCompetencyIds.size * 5,
        lessons_per_competency: allCompetencyIds.size > 0
          ? Number((allLessons.length / allCompetencyIds.size).toFixed(1))
          : 0,
        go_no_go: goNoGo,
        is_go_ready: isGoReady,
        duplicate_lesson_ids: duplicateIds,
        missing_competencies: missingCompetencies,
        exam_block_count: examBlockCount,
        weight_tag_count: weightTagCount,
      },
    });

    // Only seal if not dry run
    if (!dryRun) {
      if (isGoReady || healthScore >= 60) {
        await admin.from("courses").update({
          autopilot_status: "sealed",
          autopilot_sealed_at: new Date().toISOString(),
          status: "draft",
          updated_at: new Date().toISOString(),
        }).eq("id", courseId);
      } else {
        // Reset to idle if not ready
        await admin.from("courses").update({
          autopilot_status: "idle",
          updated_at: new Date().toISOString(),
        }).eq("id", courseId);
      }
    } else {
      // Reset from finalizing for dry run
      await admin.from("courses").update({
        autopilot_status: existingCourse?.autopilot_status || "idle",
        updated_at: new Date().toISOString(),
      }).eq("id", courseId);
    }

    console.log(`[Finalizer] Course ${courseId.slice(0, 8)}: score=${healthScore}, go=${isGoReady}, issues=${allIssues.length}, dupes=${duplicateIds.length}`);

    return new Response(JSON.stringify({
      success: true,
      courseId,
      dryRun: !!dryRun,
      healthScore,
      healthStatus,
      isGoReady,
      goNoGo,
      lessonCount: allLessons.length,
      competencyCoverage: `${coveredCompetencies.size}/${allCompetencyIds.size}`,
      duplicateCount: duplicateIds.length,
      duplicateLessonIds: duplicateIds,
      emptyContent: emptyCount,
      avgWordCount,
      examBlocks: examBlockCount,
      criticalIssues: criticalCount,
      warnings: warningCount,
      issues: allIssues,
      missingCompetencies,
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Finalizer] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
  }
});
