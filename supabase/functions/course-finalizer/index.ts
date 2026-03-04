import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Course Finalizer – Production Gate (v2)
 *
 * 6-step quality check before sealing:
 * 1. Structure Check (5 steps per competency)
 * 2. Duplicate Check (quarantined lessons excluded)
 * 3. MiniCheck Validation (parsed questions exist)
 * 4. Exam Block Check (exam_block present per competency)
 * 5. Weight Tag Check (all lessons tagged)
 * 6. Coverage + Final Seal
 */

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { courseId, curriculum_id, dryRun } = await req.json();
    if (!courseId) return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // PRODUCTION GUARD: Check seal status
    const { data: existingCourse } = await admin.from("courses")
      .select("autopilot_status, autopilot_sealed_at, curriculum_id")
      .eq("id", courseId).single();

    if (existingCourse?.autopilot_status === "sealed") {
      return new Response(JSON.stringify({
        error: "SEALED_COURSE: Kurs ist bereits versiegelt.",
        sealed_at: existingCourse.autopilot_sealed_at,
      }), { status: 409, headers });
    }
    if (existingCourse?.autopilot_status === "finalizing") {
      return new Response(JSON.stringify({
        error: "PARALLEL_FINALIZE: Finalisierung läuft bereits.",
      }), { status: 409, headers });
    }

    // Lock to finalizing
    await admin.from("courses").update({
      autopilot_status: "finalizing", updated_at: new Date().toISOString(),
    }).eq("id", courseId);

    const curriculumId = existingCourse?.curriculum_id || curriculum_id;

    // Load modules + active lessons (exclude quarantined)
    const { data: modules } = await admin.from("modules")
      .select("id, title, sort_order, learning_field_id, learning_field_code")
      .eq("course_id", courseId).order("sort_order");
    const moduleIds = (modules || []).map((m: any) => m.id);

    const { data: lessons } = await admin.from("lessons")
      .select("id, title, module_id, competency_id, step, content, sort_order, exam_block, weight_tag, minicheck_parsed, quarantine_status")
      .in("module_id", moduleIds.length > 0 ? moduleIds : ["__none__"])
      .is("quarantine_status", null) // only active lessons
      .order("sort_order");
    const allLessons = lessons || [];

    // Load quarantined count for stats
    const { count: quarantinedCount } = await admin.from("lessons")
      .select("id", { count: "exact", head: true })
      .in("module_id", moduleIds.length > 0 ? moduleIds : ["__none__"])
      .eq("quarantine_status", "quarantined");

    // Load competencies
    let competencies: any[] = [];
    let learningFields: any[] = [];
    if (curriculumId) {
      const { data: lfs } = await admin.from("learning_fields")
        .select("id, title, weight_percent").eq("curriculum_id", curriculumId);
      learningFields = lfs || [];
      const lfIds = learningFields.map((lf: any) => lf.id);
      if (lfIds.length > 0) {
        const { data: comps } = await admin.from("competencies")
          .select("id, title, code, learning_field_id")
          .in("learning_field_id", lfIds);
        competencies = comps || [];
      }
    }
    const allCompetencyIds = new Set(competencies.map((c: any) => c.id));

    // ============ CHECK 1: Structure (5 steps per competency) ============
    const structureIssues: any[] = [];
    const expectedSteps = ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"];
    const compStepMap = new Map<string, Set<string>>();

    for (const l of allLessons) {
      if (!l.competency_id || !l.step) continue;
      if (!compStepMap.has(l.competency_id)) compStepMap.set(l.competency_id, new Set());
      compStepMap.get(l.competency_id)!.add(l.step);
    }

    for (const comp of competencies) {
      const steps = compStepMap.get(comp.id) || new Set();
      for (const expected of expectedSteps) {
        if (!steps.has(expected)) {
          structureIssues.push({
            severity: "critical", code: "MISSING_STEP",
            competency: `${comp.code}: ${comp.title}`, step: expected,
            message: `Kompetenz "${comp.code}": Step "${expected}" fehlt`,
          });
        }
      }
    }

    // Check for empty content (< 50 words)
    let emptyCount = 0;
    let totalWords = 0;
    for (const l of allLessons) {
      const html = l.content?.html || "";
      const plain = html.replace(/<[^>]*>/g, "");
      const wc = plain.split(/\s+/).filter(Boolean).length;
      totalWords += wc;
      if (wc < 50) {
        emptyCount++;
        structureIssues.push({
          severity: "critical", code: "EMPTY_CONTENT",
          lesson: l.title, message: `Lektion "${l.title}": nur ${wc} Wörter (Min: 50)`,
        });
      }
    }

    // ============ CHECK 2: Active Duplicates ============
    const duplicateIssues: any[] = [];
    const compStepCount = new Map<string, number>();
    for (const l of allLessons) {
      if (!l.competency_id || !l.step) continue;
      const key = `${l.competency_id}::${l.step}`;
      compStepCount.set(key, (compStepCount.get(key) || 0) + 1);
    }
    let activeDupes = 0;
    for (const [key, count] of compStepCount) {
      if (count > 1) {
        activeDupes += count - 1;
        duplicateIssues.push({
          severity: "critical", code: "ACTIVE_DUPLICATE",
          key, count, message: `${key}: ${count} aktive Lektionen (soll: 1). QC-Worker Dedup nicht gelaufen?`,
        });
      }
    }

    // ============ CHECK 3: MiniCheck Validation ============
    const miniCheckIssues: any[] = [];
    const miniCheckLessons = allLessons.filter((l: any) => l.step === "mini_check");
    let miniChecksParsed = 0;
    let miniChecksUnparsed = 0;

    for (const l of miniCheckLessons) {
      if (l.minicheck_parsed) {
        miniChecksParsed++;
      } else {
        miniChecksUnparsed++;
        miniCheckIssues.push({
          severity: "critical", code: "MINICHECK_UNPARSED",
          lessonId: l.id, lesson: l.title,
          message: `MiniCheck "${l.title}": nicht geparsed → keine strukturierten Fragen`,
        });
      }
    }

    // Verify actual questions exist
    if (miniChecksParsed > 0) {
      const parsedIds = miniCheckLessons.filter((l: any) => l.minicheck_parsed).map((l: any) => l.id);
      const { count: qCount } = await admin.from("minicheck_questions")
        .select("id", { count: "exact", head: true })
        .in("lesson_id", parsedIds);
      if ((qCount || 0) === 0) {
        miniCheckIssues.push({
          severity: "critical", code: "MINICHECK_NO_QUESTIONS",
          message: `${miniChecksParsed} MiniChecks als geparsed markiert, aber 0 Fragen in minicheck_questions`,
        });
      }
    }

    // ============ CHECK 4: Exam Block ============
    const examBlockIssues: any[] = [];
    const compsWithExamBlock = new Set<string>();
    let examBlockCount = 0;
    for (const l of allLessons) {
      if (l.exam_block && l.competency_id) {
        compsWithExamBlock.add(l.competency_id);
        examBlockCount++;
      }
    }
    for (const comp of competencies) {
      if (!compsWithExamBlock.has(comp.id)) {
        examBlockIssues.push({
          severity: "warning", code: "NO_EXAM_BLOCK",
          competency: `${comp.code}: ${comp.title}`,
          message: `Kompetenz "${comp.code}" hat keinen Prüfungsbezug-Block`,
        });
      }
    }

    // ============ CHECK 5: Weight Tags ============
    const weightIssues: any[] = [];
    let weightedCount = 0;
    let unweightedCount = 0;
    for (const l of allLessons) {
      if (l.weight_tag) weightedCount++;
      else unweightedCount++;
    }
    if (unweightedCount > 0) {
      weightIssues.push({
        severity: "warning", code: "MISSING_WEIGHT_TAG",
        count: unweightedCount,
        message: `${unweightedCount} Lektionen ohne Gewichtung (weight_tag)`,
      });
    }

    // ============ CHECK 6: Coverage ============
    const coverageIssues: any[] = [];
    const coveredCompetencies = new Set<string>();
    for (const l of allLessons) {
      if (l.competency_id) coveredCompetencies.add(l.competency_id);
    }
    const missingCompetencies: any[] = [];
    for (const comp of competencies) {
      if (!coveredCompetencies.has(comp.id)) {
        const lf = learningFields.find((f: any) => f.id === comp.learning_field_id);
        missingCompetencies.push({ id: comp.id, code: comp.code, title: comp.title, learningField: lf?.title });
        coverageIssues.push({
          severity: "critical", code: "MISSING_COMPETENCY",
          message: `Kompetenz "${comp.code}: ${comp.title}" hat keine Lektionen`,
        });
      }
    }

    // ============ BUILD RESULTS ============
    const allIssues = [...structureIssues, ...duplicateIssues, ...miniCheckIssues, ...examBlockIssues, ...weightIssues, ...coverageIssues];
    const criticalCount = allIssues.filter(i => i.severity === "critical").length;
    const warningCount = allIssues.filter(i => i.severity === "warning").length;

    // Health Score
    let healthScore = 100;
    healthScore -= Math.min(criticalCount * 8, 40);
    healthScore -= Math.min(warningCount * 2, 20);
    healthScore -= Math.min(activeDupes * 3, 15);
    healthScore -= Math.min(emptyCount * 5, 25);
    healthScore -= Math.min(miniChecksUnparsed * 4, 20);
    const uncoveredCount = allCompetencyIds.size - coveredCompetencies.size;
    if (uncoveredCount > 0) healthScore -= Math.min(uncoveredCount * 10, 30);
    const avgWordCount = allLessons.length > 0 ? Math.round(totalWords / allLessons.length) : 0;
    if (avgWordCount < 100) healthScore -= 5;
    healthScore = Math.max(0, healthScore);

    const healthStatus = healthScore >= 85 ? "healthy" : healthScore >= 60 ? "warning" : "critical";

    // Go/No-Go (HARD gates)
    const goNoGo = {
      structureComplete: structureIssues.filter(i => i.code === "MISSING_STEP").length === 0,
      noDuplicates: activeDupes === 0,
      fullCoverage: uncoveredCount === 0,
      noEmptyContent: emptyCount === 0,
      miniChecksParsed: miniChecksUnparsed === 0,
      examBlocksPresent: examBlockIssues.length === 0,
      weightTagsPresent: unweightedCount === 0,
      minAvgWords: avgWordCount >= 100,
    };
    const isGoReady = Object.values(goNoGo).every(Boolean);

    // Save snapshot
    const stepCounts: Record<string, number> = {};
    for (const l of allLessons) { const s = l.step || "unknown"; stepCounts[s] = (stepCounts[s] || 0) + 1; }

    await admin.from("course_health_snapshots").insert({
      course_id: courseId, snapshot_type: "seal",
      lesson_count: allLessons.length,
      competency_count: allCompetencyIds.size,
      covered_competency_count: coveredCompetencies.size,
      step_distribution: stepCounts,
      duplicate_titles: activeDupes,
      empty_content_count: emptyCount,
      avg_word_count: avgWordCount,
      health_score: healthScore, health_status: healthStatus,
      issues: allIssues,
      benchmarks: {
        expected_lessons: allCompetencyIds.size * 5,
        go_no_go: goNoGo, is_go_ready: isGoReady,
        missing_competencies: missingCompetencies,
        exam_block_count: examBlockCount,
        weight_tagged: weightedCount,
        minicheck_parsed: miniChecksParsed,
        minicheck_unparsed: miniChecksUnparsed,
        quarantined_lessons: quarantinedCount || 0,
      },
    });

    // Seal decision + publishing_status + quality_score
    if (!dryRun) {
      if (isGoReady) {
        await admin.from("courses").update({
          autopilot_status: "sealed",
          autopilot_sealed_at: new Date().toISOString(),
          quality_score: healthScore,
          publishing_status: "publishable",
          status: "draft",
          updated_at: new Date().toISOString(),
        }).eq("id", courseId);
      } else {
        await admin.from("courses").update({
          autopilot_status: "idle",
          quality_score: healthScore,
          publishing_status: "quality_failed",
          updated_at: new Date().toISOString(),
        }).eq("id", courseId);
      }
    } else {
      await admin.from("courses").update({
        autopilot_status: existingCourse?.autopilot_status || "idle",
        quality_score: healthScore,
        updated_at: new Date().toISOString(),
      }).eq("id", courseId);
    }

    console.log(`[Finalizer] Course ${courseId.slice(0, 8)}: score=${healthScore}, go=${isGoReady}, critical=${criticalCount}, warnings=${warningCount}`);

    return new Response(JSON.stringify({
      success: true, courseId, dryRun: !!dryRun,
      healthScore, healthStatus, isGoReady, goNoGo,
      lessonCount: allLessons.length,
      quarantinedLessons: quarantinedCount || 0,
      competencyCoverage: `${coveredCompetencies.size}/${allCompetencyIds.size}`,
      activeDuplicates: activeDupes,
      miniCheckStatus: { parsed: miniChecksParsed, unparsed: miniChecksUnparsed },
      examBlocks: examBlockCount,
      weightTags: { tagged: weightedCount, untagged: unweightedCount },
      emptyContent: emptyCount, avgWordCount,
      criticalIssues: criticalCount, warnings: warningCount,
      issues: allIssues, missingCompetencies,
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Finalizer] Error:", msg);
    // Try to reset status on error
    try {
      const { courseId } = await req.clone().json().catch(() => ({}));
      if (courseId) {
        const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        await admin.from("courses").update({ autopilot_status: "idle", updated_at: new Date().toISOString() }).eq("id", courseId);
      }
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
  }
});
