import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * QC Snapshot API – SSOT-conforme Snapshots für externe AI-Qualitätskontrolle.
 * 
 * Admin-only. Returns structured JSON snapshots for:
 * - course: Full course with modules, lessons, minichecks, audits
 * - exam_trainer: Exam questions + blueprints for a curriculum
 * - ai_tutor: AI tutor config, logs, session stats
 * - oral_exam: Oral exam scenarios + evaluation criteria
 * - handbook: Handbook chapters + exercises
 * 
 * POST body: { action: string, curriculumId?: string, courseId?: string }
 */

const ACTIONS = [
  "course",
  "exam_trainer",
  "ai_tutor",
  "oral_exam",
  "handbook",
  "full_audit",        // all of the above combined
] as const;

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  const auth = await validateAuth(req, true);
  if (auth.error) {
    return auth.error === "Admin access required"
      ? forbiddenResponse(auth.error, origin ?? undefined)
      : unauthorizedResponse(auth.error, origin ?? undefined);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { action, courseId, curriculumId } = body;

    if (!action || !ACTIONS.includes(action)) {
      return new Response(JSON.stringify({ error: `Invalid action. Must be one of: ${ACTIONS.join(", ")}` }), { status: 400, headers });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let snapshot: any = { action, generatedAt: new Date().toISOString(), version: "1.0.0" };

    // Resolve curriculumId from courseId if needed
    let resolvedCurriculumId = curriculumId;
    if (courseId && !curriculumId) {
      const { data: course } = await sb.from("courses").select("curriculum_id").eq("id", courseId).single();
      if (course) resolvedCurriculumId = course.curriculum_id;
    }

    if (action === "course" || action === "full_audit") {
      if (!courseId) return new Response(JSON.stringify({ error: "courseId required for course snapshot" }), { status: 400, headers });
      snapshot.course = await buildCourseSnapshot(sb, courseId);
    }

    if (action === "exam_trainer" || action === "full_audit") {
      if (!resolvedCurriculumId && !courseId) return new Response(JSON.stringify({ error: "curriculumId or courseId required" }), { status: 400, headers });
      snapshot.examTrainer = await buildExamTrainerSnapshot(sb, resolvedCurriculumId);
    }

    if (action === "ai_tutor" || action === "full_audit") {
      snapshot.aiTutor = await buildAITutorSnapshot(sb);
    }

    if (action === "oral_exam" || action === "full_audit") {
      snapshot.oralExam = await buildOralExamSnapshot(sb, resolvedCurriculumId);
    }

    if (action === "handbook" || action === "full_audit") {
      snapshot.handbook = await buildHandbookSnapshot(sb, resolvedCurriculumId);
    }

    // Log the QC request
    await sb.from("ai_usage_log").insert({
      job_type: `qc_snapshot_${action}`,
      model: "snapshot",
      input_tokens: 0,
      output_tokens: JSON.stringify(snapshot).length,
      cost_eur: 0,
      success: true,
      metadata: { action, courseId, curriculumId: resolvedCurriculumId, userId: auth.user!.id },
    }).then(() => {});

    return new Response(JSON.stringify(snapshot), { headers });
  } catch (error) {
    console.error("[qc-snapshot] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Snapshot generation failed" }),
      { status: 500, headers }
    );
  }
});

// ============ Snapshot Builders ============

async function buildCourseSnapshot(sb: any, courseId: string) {
  // Course + curriculum
  const { data: course } = await sb
    .from("courses")
    .select("*, curricula(id, title, version, status, frozen_at, curriculum_typ)")
    .eq("id", courseId)
    .single();
  if (!course) throw new Error("Course not found");

  // Modules
  const { data: modules } = await sb
    .from("modules")
    .select("*")
    .eq("course_id", courseId)
    .order("sort_order");

  // Lessons
  const { data: lessons } = await sb
    .from("lessons")
    .select("*, modules!inner(id, title, sort_order)")
    .eq("modules.course_id", courseId)
    .order("sort_order");

  // MiniChecks
  const lessonIds = (lessons || []).map((l: any) => l.id);
  let miniChecks: any[] = [];
  if (lessonIds.length > 0) {
    const { data } = await sb.from("minicheck_questions").select("*").in("lesson_id", lessonIds);
    miniChecks = data || [];
  }

  // Latest quality audit
  const { data: audit } = await sb
    .from("course_quality_audits")
    .select("*")
    .eq("course_id", courseId)
    .order("audited_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Build lesson analysis
  const lessonAnalysis = (lessons || []).map((l: any) => {
    const lMiniChecks = miniChecks.filter((q: any) => q.lesson_id === l.id);
    const plainText = (l.html || "").replace(/<[^>]*>/g, "");
    const wordCount = plainText.split(/\s+/).filter(Boolean).length;

    return {
      id: l.id,
      title: l.title,
      step: l.step,
      sortOrder: l.sort_order,
      moduleTitle: l.modules?.title,
      moduleSortOrder: l.modules?.sort_order,
      objectives: l.objectives || [],
      wordCount,
      hasExamBlock: !!l.exam_block,
      weightTag: l.weight_tag || null,
      miniCheckCount: lMiniChecks.length,
      miniChecks: lMiniChecks.map((q: any) => ({
        id: q.id,
        questionText: q.question_text || q.question,
        questionType: q.question_type,
        correctAnswer: q.correct_answer,
        options: q.options,
        explanation: q.explanation,
      })),
      contentPreview: plainText.substring(0, 500),
    };
  });

  // Validation checks
  const validationIssues: string[] = [];
  const expectedSteps = ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"];

  for (const mod of (modules || [])) {
    const modLessons = lessonAnalysis.filter((l: any) => l.moduleTitle === mod.title);
    const steps = modLessons.map((l: any) => l.step);
    for (const expected of expectedSteps) {
      if (!steps.includes(expected)) {
        validationIssues.push(`Module "${mod.title}": missing step "${expected}"`);
      }
    }
    for (const l of modLessons) {
      if (l.wordCount < 50) validationIssues.push(`Lesson "${l.title}": very short (${l.wordCount} words)`);
      if (l.step === "mini_check" && l.miniCheckCount < 3) {
        validationIssues.push(`Lesson "${l.title}": mini_check has only ${l.miniCheckCount} questions (min 3)`);
      }
    }
  }

  return {
    course: {
      id: course.id,
      title: course.title,
      description: course.description,
      status: course.status,
      estimatedDuration: course.estimated_duration,
    },
    curriculum: course.curricula ? {
      id: course.curricula.id,
      title: course.curricula.title,
      version: course.curricula.version,
      status: course.curricula.status,
      frozenAt: course.curricula.frozen_at,
      type: course.curricula.curriculum_typ,
    } : null,
    stats: {
      totalModules: (modules || []).length,
      totalLessons: lessonAnalysis.length,
      totalMiniChecks: miniChecks.length,
      totalWordCount: lessonAnalysis.reduce((s: number, l: any) => s + l.wordCount, 0),
      lessonsWithExamBlock: lessonAnalysis.filter((l: any) => l.hasExamBlock).length,
      lessonsWithWeightTag: lessonAnalysis.filter((l: any) => l.weightTag).length,
      avgWordCount: Math.round(lessonAnalysis.reduce((s: number, l: any) => s + l.wordCount, 0) / Math.max(lessonAnalysis.length, 1)),
    },
    modules: (modules || []).map((m: any) => ({
      id: m.id, title: m.title, sortOrder: m.sort_order,
      learningFieldCode: m.learning_field_code,
    })),
    lessons: lessonAnalysis,
    qualityAudit: audit ? {
      score: audit.overall_score,
      grade: audit.overall_grade,
      auditedAt: audit.audited_at,
      dimensions: audit.dimensions,
      criticalIssues: audit.critical_issues,
      recommendations: audit.recommendations,
    } : null,
    validationIssues,
  };
}

async function buildExamTrainerSnapshot(sb: any, curriculumId: string) {
  // Exam questions
  const { data: questions } = await sb
    .from("exam_questions")
    .select("*")
    .eq("curriculum_id", curriculumId)
    .order("created_at", { ascending: false })
    .limit(500);

  // Blueprints
  const { data: blueprints } = await sb
    .from("question_blueprints")
    .select("*, blueprint_variables(*), blueprint_correct_answers(*), blueprint_distractors(*)")
    .eq("curriculum_id", curriculumId)
    .limit(100);

  const qList = (questions || []);
  const statusCounts: Record<string, number> = {};
  const difficultyCounts: Record<string, number> = {};
  for (const q of qList) {
    statusCounts[q.status] = (statusCounts[q.status] || 0) + 1;
    difficultyCounts[q.difficulty || "unknown"] = (difficultyCounts[q.difficulty || "unknown"] || 0) + 1;
  }

  return {
    curriculumId,
    totalQuestions: qList.length,
    statusDistribution: statusCounts,
    difficultyDistribution: difficultyCounts,
    questions: qList.map((q: any) => ({
      id: q.id,
      questionText: q.question_text,
      questionType: q.question_type,
      difficulty: q.difficulty,
      status: q.status,
      options: q.options,
      correctAnswer: q.correct_answer,
      explanation: q.explanation,
      learningFieldId: q.learning_field_id,
      competencyId: q.competency_id,
      taxonomyLevel: q.taxonomy_level,
    })),
    blueprints: (blueprints || []).map((b: any) => ({
      id: b.id,
      title: b.title,
      templateText: b.template_text,
      questionType: b.question_type,
      difficulty: b.difficulty,
      variableCount: (b.blueprint_variables || []).length,
      correctAnswerCount: (b.blueprint_correct_answers || []).length,
      distractorCount: (b.blueprint_distractors || []).length,
    })),
  };
}

async function buildAITutorSnapshot(sb: any) {
  // Recent tutor logs (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  const { data: logs, count } = await sb
    .from("ai_tutor_logs")
    .select("mode, session_type, was_blocked, tokens_used, prompt_length, response_length", { count: "exact" })
    .gte("created_at", sevenDaysAgo);

  const modeStats: Record<string, number> = {};
  const sessionTypeStats: Record<string, number> = {};
  let totalBlocked = 0;
  let totalTokens = 0;

  for (const log of (logs || [])) {
    modeStats[log.mode] = (modeStats[log.mode] || 0) + 1;
    sessionTypeStats[log.session_type] = (sessionTypeStats[log.session_type] || 0) + 1;
    if (log.was_blocked) totalBlocked++;
    totalTokens += log.tokens_used || 0;
  }

  return {
    period: "last_7_days",
    totalSessions: count || 0,
    modeDistribution: modeStats,
    sessionTypeDistribution: sessionTypeStats,
    blockedResponses: totalBlocked,
    totalTokensUsed: totalTokens,
    avgTokensPerSession: Math.round(totalTokens / Math.max(count || 1, 1)),
    governanceModes: ["learning", "practice", "exam"],
    didacticRoles: ["explainer", "coach", "examiner", "feedback"],
  };
}

async function buildOralExamSnapshot(sb: any, curriculumId?: string) {
  // Check for oral exam sessions/scenarios 
  let query = sb.from("exam_sessions").select("*", { count: "exact" }).eq("session_type", "oral");
  if (curriculumId) query = query.eq("curriculum_id", curriculumId);
  const { count: oralSessionCount } = await query.limit(0);

  // Get exam questions tagged for oral
  let oralQuery = sb.from("exam_questions").select("id, question_text, question_type, difficulty, taxonomy_level")
    .eq("question_type", "oral");
  if (curriculumId) oralQuery = oralQuery.eq("curriculum_id", curriculumId);
  const { data: oralQuestions } = await oralQuery.limit(100);

  return {
    curriculumId: curriculumId || "all",
    totalOralSessions: oralSessionCount || 0,
    totalOralQuestions: (oralQuestions || []).length,
    questions: (oralQuestions || []).map((q: any) => ({
      id: q.id,
      questionText: q.question_text,
      difficulty: q.difficulty,
      taxonomyLevel: q.taxonomy_level,
    })),
    evaluationCriteria: [
      "Fachliche Richtigkeit",
      "Strukturierte Argumentation",
      "Fachsprache",
      "Praxisbezug",
      "Vollständigkeit",
    ],
  };
}

async function buildHandbookSnapshot(sb: any, curriculumId?: string) {
  // Handbook is currently client-side data, so we provide the structure
  // If there's a handbook_chapters table, we'd query it
  const { data: chapters } = await sb
    .from("handbook_chapters")
    .select("*")
    .order("sort_order")
    .limit(50)
    .then((res: any) => res)
    .catch(() => ({ data: null }));

  if (chapters && chapters.length > 0) {
    return {
      curriculumId: curriculumId || "all",
      totalChapters: chapters.length,
      chapters: chapters.map((c: any) => ({
        id: c.id,
        title: c.title,
        key: c.key,
        sortOrder: c.sort_order,
        contentPreview: (c.content || "").substring(0, 300),
      })),
    };
  }

  // Fallback: handbook is client-side
  return {
    curriculumId: curriculumId || "all",
    note: "Handbook content is currently managed client-side. Consider migrating to database for full QC coverage.",
    availableChapters: [
      "pruefungsformat", "zeitmanagement", "lernstrategien",
      "pruefungsangst", "antwortstrategien", "pruefungstag",
    ],
  };
}
