import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * ExamFit 7-Gate Quality System
 * 
 * Gate 1: SSOT Curriculum Gate (curriculum_id, competency_id, learning_field_id, frozen status, foreign content)
 * Gate 2: Dedup & Structure Gate (5 steps per competency, hash-based dedup)
 * Gate 3: MiniCheck Struct Gate (structured questions with explanations)
 * Gate 4: Prüfungsrelevanz Gate (exam_block per competency)
 * Gate 5: Gewichtungs Gate (weight_tag + exam_relevance_score)
 * Gate 6: Bloat-Protection Gate (max lessons per field/course)
 * Gate 7: Mastery-Berechenbarkeit Gate (competency_id + mastery_weight on minichecks)
 */

interface GateResult {
  gate: number;
  name: string;
  status: "passed" | "failed" | "warning";
  score: number;
  issues: GateIssue[];
}

interface GateIssue {
  severity: "critical" | "warning" | "info";
  code: string;
  message: string;
  lessonId?: string;
  competencyId?: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { courseId, fix } = await req.json();
    if (!courseId) return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Load course
    const { data: course } = await admin.from("courses")
      .select("id, curriculum_id, status, autopilot_status, publishing_status")
      .eq("id", courseId).single();
    if (!course) return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers });

    // Load curriculum
    const { data: curriculum } = await admin.from("curricula")
      .select("id, status, beruf_id, title")
      .eq("id", course.curriculum_id).single();

    // Load modules + lessons
    const { data: modules } = await admin.from("modules")
      .select("id, title, sort_order, learning_field_id, learning_field_code")
      .eq("course_id", courseId).order("sort_order");
    const moduleIds = (modules || []).map((m: any) => m.id);

    const { data: lessons } = await admin.from("lessons")
      .select("id, title, module_id, competency_id, step, content, sort_order, exam_block, weight_tag, minicheck_parsed, quarantine_status, content_hash, exam_relevance_score, mastery_weight, quality_flags")
      .in("module_id", moduleIds.length > 0 ? moduleIds : ["__none__"])
      .order("sort_order");
    const allLessons = (lessons || []).filter((l: any) => l.quarantine_status !== "quarantined");
    const quarantinedLessons = (lessons || []).filter((l: any) => l.quarantine_status === "quarantined");

    // Load competencies + learning fields
    let competencies: any[] = [];
    let learningFields: any[] = [];
    if (course.curriculum_id) {
      const { data: lfs } = await admin.from("learning_fields")
        .select("id, title, code, weight_percent").eq("curriculum_id", course.curriculum_id);
      learningFields = lfs || [];
      const lfIds = learningFields.map((lf: any) => lf.id);
      if (lfIds.length > 0) {
        const { data: comps } = await admin.from("competencies")
          .select("id, title, code, learning_field_id")
          .in("learning_field_id", lfIds);
        competencies = comps || [];
      }
    }

    // Load disallowed keywords
    const { data: disallowedKws } = await admin.from("disallowed_keywords")
      .select("keyword, category")
      .eq("curriculum_id", course.curriculum_id);
    const disallowedKeywords = (disallowedKws || []).map((k: any) => k.keyword.toLowerCase());

    const gates: GateResult[] = [];

    // ═══════════════ GATE 1: SSOT Curriculum Gate ═══════════════
    const gate1Issues: GateIssue[] = [];
    
    // Check curriculum frozen
    if (!curriculum || curriculum.status !== "frozen") {
      gate1Issues.push({ severity: "critical", code: "CURRICULUM_NOT_FROZEN", message: `Curriculum Status: ${curriculum?.status || 'missing'} (erwartet: frozen)` });
    }

    const validCompIds = new Set(competencies.map((c: any) => c.id));
    const validLfIds = new Set(learningFields.map((lf: any) => lf.id));

    for (const l of allLessons) {
      if (!l.competency_id) {
        gate1Issues.push({ severity: "critical", code: "MISSING_COMPETENCY_REF", message: `"${l.title}": keine competency_id`, lessonId: l.id });
      } else if (!validCompIds.has(l.competency_id)) {
        gate1Issues.push({ severity: "critical", code: "INVALID_COMPETENCY_REF", message: `"${l.title}": competency_id existiert nicht im SSOT`, lessonId: l.id });
      }

      // Foreign content check
      if (disallowedKeywords.length > 0 && l.content?.html) {
        const text = l.content.html.replace(/<[^>]*>/g, "").toLowerCase();
        const found = disallowedKeywords.filter((kw: string) => text.includes(kw));
        if (found.length > 0) {
          gate1Issues.push({
            severity: "critical", code: "FOREIGN_CONTENT",
            message: `"${l.title}": Fachfremde Keywords: ${found.join(", ")}`,
            lessonId: l.id,
          });
          // Auto-quarantine if fix mode
          if (fix) {
            await admin.from("lessons").update({
              quarantine_status: "quarantined",
              quarantine_reason: `Fachfremde Keywords: ${found.join(", ")}`,
              quarantined_at: new Date().toISOString(),
              quality_flags: [...(l.quality_flags || []), "foreign_content_detected"],
            }).eq("id", l.id);
          }
        }
      }
    }

    const gate1Score = gate1Issues.filter(i => i.severity === "critical").length === 0 ? 100 : Math.max(0, 100 - gate1Issues.length * 15);
    gates.push({ gate: 1, name: "SSOT Curriculum Gate", status: gate1Issues.some(i => i.severity === "critical") ? "failed" : "passed", score: gate1Score, issues: gate1Issues });

    // ═══════════════ GATE 2: Dedup & Structure Gate ═══════════════
    const gate2Issues: GateIssue[] = [];
    const expectedSteps = ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"];
    const compStepMap = new Map<string, Map<string, any[]>>();

    for (const l of allLessons) {
      if (!l.competency_id || !l.step) continue;
      if (!compStepMap.has(l.competency_id)) compStepMap.set(l.competency_id, new Map());
      const stepMap = compStepMap.get(l.competency_id)!;
      if (!stepMap.has(l.step)) stepMap.set(l.step, []);
      stepMap.get(l.step)!.push(l);
    }

    let dupCount = 0;
    const dupLessonIds: string[] = [];
    for (const comp of competencies) {
      const stepMap = compStepMap.get(comp.id);
      for (const expected of expectedSteps) {
        const lessonsForStep = stepMap?.get(expected) || [];
        if (lessonsForStep.length === 0) {
          gate2Issues.push({ severity: "critical", code: "MISSING_STEP", message: `${comp.code}: Step "${expected}" fehlt`, competencyId: comp.id });
        } else if (lessonsForStep.length > 1) {
          dupCount += lessonsForStep.length - 1;
          // Keep the one with most content, mark rest
          const sorted = lessonsForStep.sort((a: any, b: any) => {
            const wA = (a.content?.html || "").replace(/<[^>]*>/g, "").split(/\s+/).length;
            const wB = (b.content?.html || "").replace(/<[^>]*>/g, "").split(/\s+/).length;
            return wB - wA;
          });
          for (let i = 1; i < sorted.length; i++) {
            dupLessonIds.push(sorted[i].id);
            gate2Issues.push({ severity: "critical", code: "DUPLICATE_STEP", message: `${comp.code}/${expected}: Duplikat "${sorted[i].title}"`, lessonId: sorted[i].id });
          }
        }
      }
    }

    // Content hash dedup
    const hashMap = new Map<string, any[]>();
    for (const l of allLessons) {
      const html = l.content?.html || "";
      const plain = html.replace(/<[^>]*>/g, "").trim();
      if (plain.length < 50) continue;
      // Simple hash: first 200 chars normalized
      const hash = plain.substring(0, 200).replace(/\s+/g, " ").toLowerCase();
      if (!hashMap.has(hash)) hashMap.set(hash, []);
      hashMap.get(hash)!.push(l);
    }
    for (const [, group] of hashMap) {
      if (group.length > 1) {
        gate2Issues.push({ severity: "warning", code: "CONTENT_HASH_DUP", message: `Identischer Content in ${group.length} Lektionen: ${group.map((l: any) => l.title).join(", ")}` });
      }
    }

    // Auto-quarantine duplicates if fix mode
    if (fix && dupLessonIds.length > 0) {
      for (const id of dupLessonIds) {
        await admin.from("lessons").update({
          quarantine_status: "quarantined",
          quarantine_reason: "Duplikat (auto-dedup Gate 2)",
          quarantined_at: new Date().toISOString(),
        }).eq("id", id);
      }
    }

    const gate2Score = Math.max(0, 100 - gate2Issues.filter(i => i.severity === "critical").length * 10 - gate2Issues.filter(i => i.severity === "warning").length * 3);
    gates.push({ gate: 2, name: "Dedup & Struktur Gate", status: gate2Issues.some(i => i.severity === "critical") ? "failed" : gate2Issues.length > 0 ? "warning" : "passed", score: gate2Score, issues: gate2Issues });

    // ═══════════════ GATE 3: MiniCheck Struct Gate ═══════════════
    const gate3Issues: GateIssue[] = [];
    const miniCheckLessons = allLessons.filter((l: any) => l.step === "mini_check");

    let miniChecksParsed = 0;
    let miniChecksUnparsed = 0;
    for (const l of miniCheckLessons) {
      if (!l.minicheck_parsed) {
        miniChecksUnparsed++;
        gate3Issues.push({ severity: "critical", code: "MINICHECK_UNPARSED", message: `"${l.title}": nicht strukturiert geparsed`, lessonId: l.id });
      } else {
        miniChecksParsed++;
      }
    }

    // Verify actual questions exist and are structured
    if (miniChecksParsed > 0) {
      const parsedIds = miniCheckLessons.filter((l: any) => l.minicheck_parsed).map((l: any) => l.id);
      const { data: mcQuestions } = await admin.from("minicheck_questions")
        .select("id, lesson_id, question, answers, correct_index, explanation_correct, explanation_wrong, difficulty")
        .in("lesson_id", parsedIds);

      const questionsByLesson = new Map<string, any[]>();
      for (const q of (mcQuestions || [])) {
        if (!questionsByLesson.has(q.lesson_id)) questionsByLesson.set(q.lesson_id, []);
        questionsByLesson.get(q.lesson_id)!.push(q);
      }

      for (const l of miniCheckLessons.filter((l: any) => l.minicheck_parsed)) {
        const qs = questionsByLesson.get(l.id) || [];
        if (qs.length < 3) {
          gate3Issues.push({ severity: "critical", code: "MINICHECK_TOO_FEW", message: `"${l.title}": nur ${qs.length} Fragen (min: 3)`, lessonId: l.id });
        }
        for (const q of qs) {
          if (!q.explanation_correct) {
            gate3Issues.push({ severity: "warning", code: "MINICHECK_NO_EXPLANATION", message: `Frage in "${l.title}": keine Erklärung`, lessonId: l.id });
          }
          if (!q.difficulty) {
            gate3Issues.push({ severity: "warning", code: "MINICHECK_NO_DIFFICULTY", message: `Frage in "${l.title}": keine Schwierigkeit`, lessonId: l.id });
          }
        }
      }
    }

    const gate3Score = Math.max(0, 100 - gate3Issues.filter(i => i.severity === "critical").length * 12 - gate3Issues.filter(i => i.severity === "warning").length * 3);
    gates.push({ gate: 3, name: "MiniCheck Struct Gate", status: gate3Issues.some(i => i.severity === "critical") ? "failed" : gate3Issues.length > 0 ? "warning" : "passed", score: gate3Score, issues: gate3Issues });

    // ═══════════════ GATE 4: Prüfungsrelevanz Gate ═══════════════
    const gate4Issues: GateIssue[] = [];
    const compsWithExamBlock = new Set<string>();
    for (const l of allLessons) {
      if (l.exam_block && l.competency_id) {
        const eb = typeof l.exam_block === "object" ? l.exam_block : {};
        if (eb.ihk_typical_question || eb.typical_trap || eb.scoring_hint) {
          compsWithExamBlock.add(l.competency_id);
        }
      }
    }
    for (const comp of competencies) {
      if (!compsWithExamBlock.has(comp.id)) {
        gate4Issues.push({ severity: "critical", code: "NO_EXAM_BLOCK", message: `${comp.code}: kein Prüfungsbezug-Block`, competencyId: comp.id });
      }
    }

    const gate4Score = competencies.length > 0 ? Math.round((compsWithExamBlock.size / competencies.length) * 100) : 0;
    gates.push({ gate: 4, name: "Prüfungsrelevanz Gate", status: gate4Issues.length === 0 ? "passed" : gate4Score >= 50 ? "warning" : "failed", score: gate4Score, issues: gate4Issues });

    // ═══════════════ GATE 5: Gewichtungs Gate ═══════════════
    const gate5Issues: GateIssue[] = [];
    let weightedCount = 0;
    let scoredCount = 0;
    for (const l of allLessons) {
      if (l.weight_tag) weightedCount++;
      else gate5Issues.push({ severity: "warning", code: "MISSING_WEIGHT_TAG", message: `"${l.title}": kein weight_tag`, lessonId: l.id });
      if ((l.exam_relevance_score || 0) > 0) scoredCount++;
    }

    const gate5Score = allLessons.length > 0 ? Math.round(((weightedCount + scoredCount) / (allLessons.length * 2)) * 100) : 0;
    gates.push({ gate: 5, name: "Gewichtungs Gate", status: gate5Issues.length === 0 ? "passed" : gate5Score >= 60 ? "warning" : "failed", score: gate5Score, issues: gate5Issues });

    // ═══════════════ GATE 6: Bloat-Protection Gate ═══════════════
    const gate6Issues: GateIssue[] = [];
    const MAX_LESSONS_PER_COURSE = 150;
    const MAX_LESSONS_PER_LF = 20;

    if (allLessons.length > MAX_LESSONS_PER_COURSE) {
      gate6Issues.push({ severity: "critical", code: "COURSE_BLOAT", message: `${allLessons.length} Lektionen (max: ${MAX_LESSONS_PER_COURSE})` });
    }

    // Check per learning field
    const lessonsByModule = new Map<string, number>();
    for (const l of allLessons) {
      lessonsByModule.set(l.module_id, (lessonsByModule.get(l.module_id) || 0) + 1);
    }
    for (const mod of (modules || [])) {
      const count = lessonsByModule.get(mod.id) || 0;
      if (count > MAX_LESSONS_PER_LF) {
        gate6Issues.push({ severity: "warning", code: "LF_BLOAT", message: `Modul "${mod.title}": ${count} Lektionen (max: ${MAX_LESSONS_PER_LF})` });
      }
    }

    // Check 1 lesson per step/competency (already covered in Gate 2 but explicit count here)
    const gate6Score = gate6Issues.some(i => i.severity === "critical") ? 30 : gate6Issues.length > 0 ? 70 : 100;
    gates.push({ gate: 6, name: "Bloat-Protection Gate", status: gate6Issues.some(i => i.severity === "critical") ? "failed" : gate6Issues.length > 0 ? "warning" : "passed", score: gate6Score, issues: gate6Issues });

    // ═══════════════ GATE 7: Mastery-Berechenbarkeit Gate ═══════════════
    const gate7Issues: GateIssue[] = [];
    for (const l of miniCheckLessons) {
      if (!l.competency_id) {
        gate7Issues.push({ severity: "critical", code: "MC_NO_COMPETENCY", message: `MiniCheck "${l.title}": keine competency_id`, lessonId: l.id });
      }
      if (!l.mastery_weight || l.mastery_weight <= 0) {
        gate7Issues.push({ severity: "warning", code: "MC_NO_MASTERY_WEIGHT", message: `MiniCheck "${l.title}": kein mastery_weight`, lessonId: l.id });
      }
    }

    const gate7Score = gate7Issues.filter(i => i.severity === "critical").length === 0
      ? Math.max(0, 100 - gate7Issues.length * 10) : Math.max(0, 50 - gate7Issues.filter(i => i.severity === "critical").length * 15);
    gates.push({ gate: 7, name: "Mastery Gate", status: gate7Issues.some(i => i.severity === "critical") ? "failed" : gate7Issues.length > 0 ? "warning" : "passed", score: gate7Score, issues: gate7Issues });

    // ═══════════════ COMPOSITE SCORE ═══════════════
    const weights = [20, 20, 20, 20, 10, 5, 5]; // Gate weights summing to 100
    const qualityScore = Math.round(gates.reduce((s, g, i) => s + g.score * (weights[i] / 100), 0));

    // Determine publishing status based on gates
    const allPassed = gates.every(g => g.status === "passed");
    const anyCritical = gates.some(g => g.status === "failed");
    let newPublishingStatus = "draft";
    if (allPassed && qualityScore >= 85) {
      newPublishingStatus = "publishable";
    } else if (!anyCritical) {
      // Determine furthest gate passed
      const lastPassed = gates.reduce((max, g) => g.status === "passed" ? Math.max(max, g.gate) : max, 0);
      const statusMap: Record<number, string> = {
        1: "ssot_validated", 2: "structurally_valid", 3: "minicheck_valid",
        4: "exam_ready", 5: "weighted", 6: "bloat_checked", 7: "mastery_ready",
      };
      newPublishingStatus = statusMap[lastPassed] || "draft";
    } else {
      newPublishingStatus = "quality_failed";
    }

    // Save gate results
    await admin.from("quality_gate_results").delete().eq("course_id", courseId);
    const gateRows = gates.map(g => ({
      course_id: courseId,
      gate_number: g.gate,
      gate_name: g.name,
      status: g.status,
      score: g.score,
      issues: g.issues,
      checked_at: new Date().toISOString(),
    }));
    await admin.from("quality_gate_results").insert(gateRows);

    // Build quality report
    const qualityReport = {
      ssot_valid: gates[0].status === "passed",
      structure_valid: gates[1].status === "passed",
      minicheck_structured: gates[2].status === "passed",
      exam_blocks_complete: gates[3].status === "passed",
      weighting_complete: gates[4].status === "passed",
      bloat_ok: gates[5].status === "passed",
      mastery_calculable: gates[6].status === "passed",
      duplicate_count: dupCount,
      bloat_score: gates[5].score,
      final_status: anyCritical ? "blocked" : allPassed ? "publishable" : "warning",
      checked_at: new Date().toISOString(),
    };

    // Update course
    await admin.from("courses").update({
      quality_score: qualityScore,
      quality_report: qualityReport,
      publishing_status: newPublishingStatus,
      updated_at: new Date().toISOString(),
    }).eq("id", courseId);

    // Also save to health snapshots for history
    const stepCounts: Record<string, number> = {};
    for (const l of allLessons) { const s = l.step || "unknown"; stepCounts[s] = (stepCounts[s] || 0) + 1; }
    const totalWords = allLessons.reduce((s: number, l: any) => {
      const html = l.content?.html || "";
      return s + html.replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
    }, 0);
    const avgWords = allLessons.length > 0 ? Math.round(totalWords / allLessons.length) : 0;

    await admin.from("course_health_snapshots").insert({
      course_id: courseId, snapshot_type: "quality_gate",
      lesson_count: allLessons.length,
      competency_count: competencies.length,
      covered_competency_count: new Set(allLessons.filter((l: any) => l.competency_id).map((l: any) => l.competency_id)).size,
      step_distribution: stepCounts,
      duplicate_titles: dupCount,
      empty_content_count: allLessons.filter((l: any) => {
        const wc = (l.content?.html || "").replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
        return wc < 50;
      }).length,
      avg_word_count: avgWords,
      health_score: qualityScore, health_status: qualityScore >= 85 ? "healthy" : qualityScore >= 60 ? "warning" : "critical",
      issues: gates.flatMap(g => g.issues),
      benchmarks: {
        gates: gates.map(g => ({ gate: g.gate, name: g.name, status: g.status, score: g.score, issueCount: g.issues.length })),
        quality_report: qualityReport,
        publishing_status: newPublishingStatus,
        quarantined_lessons: quarantinedLessons.length,
        auto_fixed_duplicates: fix ? dupLessonIds.length : 0,
      },
    });

    console.log(`[QualityGate] Course ${courseId.slice(0, 8)}: score=${qualityScore}, status=${newPublishingStatus}, gates=${gates.map(g => `G${g.gate}:${g.status}`).join(",")}`);

    return new Response(JSON.stringify({
      success: true, courseId,
      qualityScore, publishingStatus: newPublishingStatus,
      gates: gates.map(g => ({ gate: g.gate, name: g.name, status: g.status, score: g.score, issueCount: g.issues.length })),
      gateDetails: gates,
      qualityReport,
      stats: {
        totalLessons: allLessons.length,
        quarantinedLessons: quarantinedLessons.length,
        duplicatesFound: dupCount,
        autoFixed: fix ? dupLessonIds.length : 0,
        miniChecksParsed, miniChecksUnparsed,
        competencies: competencies.length,
        avgWordCount: avgWords,
      },
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[QualityGate] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
  }
});
