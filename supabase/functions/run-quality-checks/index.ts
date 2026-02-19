import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

interface QualityCheckResult {
  checkType: string;
  status: 'passed' | 'failed' | 'warning';
  score: number;
  details: Record<string, unknown>;
}

interface CourseAuditResult {
  courseId: string;
  courseTitle: string;
  checks: {
    competencyCoverage: QualityCheckResult;
    completeness: QualityCheckResult;
    miniCheckQuality: QualityCheckResult;
    objectivesPresent: QualityCheckResult;
    noPlaceholders: QualityCheckResult;
    duplicateDetection: QualityCheckResult;
  };
  overallScore: number;
  overallStatus: 'passed' | 'failed' | 'warning';
  recommendations: string[];
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { courseId, checkType, curriculumProductId } = await req.json();

    // If courseId is provided, run course-specific audit
    if (courseId) {
      const result = await runCourseAudit(supabase, courseId);
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Legacy: curriculum product quality checks
    if (!checkType || !curriculumProductId) {
      return new Response(
        JSON.stringify({ error: "Either courseId OR (checkType + curriculumProductId) required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[QUALITY-CHECK] Running ${checkType} for curriculum_product ${curriculumProductId}`);

    const { data: cp, error: cpError } = await supabase
      .from('curriculum_products')
      .select(`
        *,
        curricula (id, title),
        store_products (product_key, includes_learning_course, includes_exam_trainer)
      `)
      .eq('id', curriculumProductId)
      .single();

    if (cpError || !cp) {
      throw new Error(`Curriculum product not found: ${curriculumProductId}`);
    }

    let result: QualityCheckResult;

    switch (checkType) {
      case 'coverage':
        result = await runCoverageCheck(supabase, cp);
        break;
      case 'duplicate':
        result = await runDuplicateCheck(supabase, cp);
        break;
      case 'correctness':
        result = await runCorrectnessCheck(supabase, cp);
        break;
      case 'difficulty_distribution':
        result = await runDifficultyCheck(supabase, cp);
        break;
      default:
        throw new Error(`Unknown check type: ${checkType}`);
    }

    console.log(`[QUALITY-CHECK] ${checkType} completed: ${result.status} (score: ${result.score})`);

    return new Response(
      JSON.stringify({
        success: true,
        checkType,
        ...result,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Quality check error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================================
// NEW: Course-level Quality Audit
// ============================================================
async function runCourseAudit(
  supabase: ReturnType<typeof createClient>,
  courseId: string
): Promise<CourseAuditResult> {
  // Get course info
  const { data: course, error: courseError } = await supabase
    .from('courses')
    .select('id, title, status, curriculum_id')
    .eq('id', courseId)
    .single();

  if (courseError || !course) {
    throw new Error(`Course not found: ${courseId}`);
  }

  // Get ALL competencies from the curriculum (the SSOT)
  const { data: learningFields } = await supabase
    .from('learning_fields')
    .select('id')
    .eq('curriculum_id', course.curriculum_id);

  const lfIds = (learningFields || []).map((lf: { id: string }) => lf.id);

  const { data: allCurriculumCompetencies } = await supabase
    .from('competencies')
    .select('id, code, title')
    .in('learning_field_id', lfIds.length > 0 ? lfIds : ['__none__']);

  const curriculumCompIds = new Set((allCurriculumCompetencies || []).map((c: { id: string }) => c.id));

  // Get all lessons for this course
  const { data: lessons, error: lessonsError } = await supabase
    .from('lessons')
    .select(`
      id, title, step, content, competency_id,
      modules!inner (course_id)
    `)
    .eq('modules.course_id', courseId);

  if (lessonsError) throw lessonsError;

  const allLessons = lessons || [];

  // Run all quality checks
  const completeness = checkCompleteness(allLessons);
  const competencyCoverage = checkCompetencyCoverage(allLessons, allCurriculumCompetencies || []);
  const miniCheckQuality = checkMiniCheckQuality(allLessons);
  const objectivesPresent = checkObjectivesPresent(allLessons);
  const noPlaceholders = checkNoPlaceholders(allLessons);
  const duplicateDetection = checkDuplicates(allLessons);

  // Calculate overall score (competencyCoverage is now the highest weight — it's a BLOCKER)
  const weights = { competencyCoverage: 35, completeness: 25, miniCheckQuality: 20, objectivesPresent: 10, noPlaceholders: 5, duplicateDetection: 5 };
  const overallScore = Math.round(
    (competencyCoverage.score * weights.competencyCoverage +
     completeness.score * weights.completeness +
     miniCheckQuality.score * weights.miniCheckQuality +
     objectivesPresent.score * weights.objectivesPresent +
     noPlaceholders.score * weights.noPlaceholders +
     duplicateDetection.score * weights.duplicateDetection) / 100
  );

  const overallStatus = competencyCoverage.status === 'failed' ? 'failed'
    : overallScore >= 80 ? 'passed' : overallScore >= 60 ? 'warning' : 'failed';

  // Generate recommendations
  const recommendations: string[] = [];
  if (competencyCoverage.status !== 'passed') {
    recommendations.push(`🔴 BLOCKER: ${(competencyCoverage.details.missingCompetencies as unknown[]).length} Kompetenzen haben KEINE Lessons. Diese müssen zuerst angelegt werden.`);
  }
  if (completeness.status !== 'passed') {
    recommendations.push('Fehlende Steps pro Kompetenz ergänzen (5 Steps erwartet: einstieg, verstehen, anwenden, wiederholen, mini_check)');
  }
  if (miniCheckQuality.status !== 'passed') {
    recommendations.push('MiniCheck-Lessons mit strukturierten Fragen (questions-Array mit 3-5 Fragen) versehen');
  }
  if (objectivesPresent.status !== 'passed') {
    recommendations.push('Lernziele (objectives) für alle Lessons definieren');
  }
  if (noPlaceholders.status !== 'passed') {
    recommendations.push('Platzhalter-Texte durch echte Inhalte ersetzen');
  }
  if (duplicateDetection.status !== 'passed') {
    recommendations.push('Doppelte Lessons konsolidieren');
  }

  return {
    courseId,
    courseTitle: course.title,
    checks: {
      competencyCoverage,
      completeness,
      miniCheckQuality,
      objectivesPresent,
      noPlaceholders,
      duplicateDetection,
    },
    overallScore,
    overallStatus,
    recommendations,
  };
}

// Check 1: Completeness (5 steps per competency)
function checkCompleteness(lessons: Record<string, unknown>[]): QualityCheckResult {
  const EXPECTED_STEPS = ['einstieg', 'verstehen', 'anwenden', 'wiederholen', 'mini_check'];
  
  // Group by competency
  const byCompetency = new Map<string, Set<string>>();
  for (const lesson of lessons) {
    const compId = lesson.competency_id as string;
    const step = lesson.step as string;
    if (!compId) continue;
    
    if (!byCompetency.has(compId)) {
      byCompetency.set(compId, new Set());
    }
    byCompetency.get(compId)!.add(step);
  }

  let complete = 0;
  const incomplete: { competencyId: string; missingSteps: string[] }[] = [];

  for (const [compId, steps] of byCompetency) {
    const missing = EXPECTED_STEPS.filter(s => !steps.has(s));
    if (missing.length === 0) {
      complete++;
    } else {
      incomplete.push({ competencyId: compId, missingSteps: missing });
    }
  }

  const total = byCompetency.size;
  const score = total > 0 ? Math.round((complete / total) * 100) : 0;

  return {
    checkType: 'completeness',
    status: score >= 95 ? 'passed' : score >= 80 ? 'warning' : 'failed',
    score,
    details: {
      totalCompetencies: total,
      completeCompetencies: complete,
      incompleteCompetencies: incomplete.slice(0, 5),
    },
  };
}

// Check: Competency Coverage (ALL curriculum competencies must have lessons)
function checkCompetencyCoverage(
  lessons: Record<string, unknown>[],
  curriculumCompetencies: { id: string; code: string; title: string }[]
): QualityCheckResult {
  const EXPECTED_STEPS = ['einstieg', 'verstehen', 'anwenden', 'wiederholen', 'mini_check'];
  
  // Which competencies have at least one lesson?
  const coveredCompIds = new Set<string>();
  for (const lesson of lessons) {
    const compId = lesson.competency_id as string;
    if (compId) coveredCompIds.add(compId);
  }

  const missing: { id: string; code: string; title: string }[] = [];
  for (const comp of curriculumCompetencies) {
    if (!coveredCompIds.has(comp.id)) {
      missing.push(comp);
    }
  }

  const total = curriculumCompetencies.length;
  const covered = total - missing.length;
  const score = total > 0 ? Math.round((covered / total) * 100) : 100;

  return {
    checkType: 'competencyCoverage',
    // This is a BLOCKER: 100% coverage required, anything less is 'failed'
    status: score === 100 ? 'passed' : 'failed',
    score,
    details: {
      totalCurriculumCompetencies: total,
      coveredInCourse: covered,
      missingCount: missing.length,
      missingCompetencies: missing.slice(0, 20),
    },
  };
}

// Check 2: MiniCheck Quality (must have questions array)
function checkMiniCheckQuality(lessons: Record<string, unknown>[]): QualityCheckResult {
  const miniChecks = lessons.filter(l => l.step === 'mini_check');
  
  let withQuestions = 0;
  const issues: { id: string; title: string; problem: string }[] = [];

  for (const mc of miniChecks) {
    const content = mc.content as Record<string, unknown> | null;
    const questions = content?.questions as unknown[] | undefined;
    
    if (Array.isArray(questions) && questions.length >= 3) {
      withQuestions++;
    } else if (Array.isArray(questions)) {
      issues.push({ 
        id: mc.id as string, 
        title: mc.title as string, 
        problem: `Nur ${questions.length} Fragen (min. 3 erwartet)` 
      });
    } else {
      issues.push({ 
        id: mc.id as string, 
        title: mc.title as string, 
        problem: 'Keine questions-Array vorhanden' 
      });
    }
  }

  const total = miniChecks.length;
  const score = total > 0 ? Math.round((withQuestions / total) * 100) : 100;

  return {
    checkType: 'miniCheckQuality',
    status: score >= 90 ? 'passed' : score >= 50 ? 'warning' : 'failed',
    score,
    details: {
      totalMiniChecks: total,
      validMiniChecks: withQuestions,
      issues: issues.slice(0, 10),
    },
  };
}

// Check 3: Objectives Present
function checkObjectivesPresent(lessons: Record<string, unknown>[]): QualityCheckResult {
  let withObjectives = 0;
  const missing: string[] = [];

  for (const lesson of lessons) {
    const content = lesson.content as Record<string, unknown> | null;
    const objectives = content?.objectives as unknown[] | undefined;
    
    if (Array.isArray(objectives) && objectives.length > 0) {
      withObjectives++;
    } else {
      missing.push(lesson.id as string);
    }
  }

  const total = lessons.length;
  const score = total > 0 ? Math.round((withObjectives / total) * 100) : 100;

  return {
    checkType: 'objectivesPresent',
    status: score >= 95 ? 'passed' : score >= 80 ? 'warning' : 'failed',
    score,
    details: {
      totalLessons: total,
      withObjectives,
      missingCount: missing.length,
    },
  };
}

// Check 4: No Placeholders
function checkNoPlaceholders(lessons: Record<string, unknown>[]): QualityCheckResult {
  const placeholderPatterns = [
    'wird generiert',
    'inhalt wird',
    'lorem ipsum',
    'placeholder',
    'TODO',
    'FIXME',
  ];

  const issues: { id: string; title: string; pattern: string }[] = [];

  for (const lesson of lessons) {
    const content = lesson.content as Record<string, unknown> | null;
    const html = (content?.html as string) || '';
    
    for (const pattern of placeholderPatterns) {
      if (html.toLowerCase().includes(pattern.toLowerCase())) {
        issues.push({
          id: lesson.id as string,
          title: lesson.title as string,
          pattern,
        });
        break;
      }
    }
  }

  const total = lessons.length;
  const clean = total - issues.length;
  const score = total > 0 ? Math.round((clean / total) * 100) : 100;

  return {
    checkType: 'noPlaceholders',
    status: issues.length === 0 ? 'passed' : 'failed',
    score,
    details: {
      totalLessons: total,
      cleanLessons: clean,
      issues: issues.slice(0, 10),
    },
  };
}

// Check 5: Duplicate Detection
function checkDuplicates(lessons: Record<string, unknown>[]): QualityCheckResult {
  // Group by competency + step (should be unique)
  const seen = new Map<string, string[]>();
  
  for (const lesson of lessons) {
    const key = `${lesson.competency_id}-${lesson.step}`;
    if (!seen.has(key)) {
      seen.set(key, []);
    }
    seen.get(key)!.push(lesson.id as string);
  }

  const duplicates = Array.from(seen.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, count: ids.length, ids }));

  const total = seen.size;
  const unique = total - duplicates.length;
  const score = total > 0 ? Math.round((unique / total) * 100) : 100;

  return {
    checkType: 'duplicateDetection',
    status: duplicates.length === 0 ? 'passed' : 'warning',
    score,
    details: {
      totalCombinations: total,
      duplicatesFound: duplicates.length,
      duplicates: duplicates.slice(0, 5),
    },
  };
}

// ============================================================
// Legacy: Curriculum Product Quality Checks
// ============================================================

async function runCoverageCheck(
  supabase: ReturnType<typeof createClient>,
  cp: Record<string, unknown>
): Promise<QualityCheckResult> {
  const curriculumId = (cp.curricula as { id: string }).id;
  const product = cp.store_products as { product_key: string; includes_learning_course: boolean; includes_exam_trainer: boolean };

  const { data: learningFields } = await supabase
    .from('learning_fields')
    .select('id')
    .eq('curriculum_id', curriculumId);

  const lfIds = learningFields?.map((lf: { id: string }) => lf.id) || [];
  
  const { data: allCompetencies } = await supabase
    .from('competencies')
    .select('id, code, title')
    .in('learning_field_id', lfIds);

  const totalCompetencies = allCompetencies?.length || 0;

  let coveredCompetencies = 0;
  const missing: string[] = [];

  if (product.includes_learning_course && cp.course_id) {
    const { data: lessons } = await supabase
      .from('lessons')
      .select('competency_id')
      .not('competency_id', 'is', null);

    const lessonCompIds = new Set(lessons?.map((l: { competency_id: string }) => l.competency_id) || []);
    
    for (const comp of (allCompetencies || [])) {
      if (lessonCompIds.has(comp.id)) {
        coveredCompetencies++;
      } else {
        missing.push(comp.code);
      }
    }
  }

  if (product.includes_exam_trainer) {
    const { data: questions } = await supabase
      .from('exam_questions')
      .select('competency_id')
      .eq('curriculum_id', curriculumId)
      .not('competency_id', 'is', null);

    const questionCompIds = new Set(questions?.map((q: { competency_id: string }) => q.competency_id) || []);
    
    for (const comp of (allCompetencies || [])) {
      if (questionCompIds.has(comp.id)) {
        if (!product.includes_learning_course) {
          coveredCompetencies++;
        }
      } else if (!product.includes_learning_course) {
        missing.push(comp.code);
      }
    }
  }

  const score = totalCompetencies > 0 
    ? Math.round((coveredCompetencies / totalCompetencies) * 100) 
    : 0;

  return {
    checkType: 'coverage',
    status: score >= 80 ? 'passed' : score >= 60 ? 'warning' : 'failed',
    score,
    details: {
      total_competencies: totalCompetencies,
      covered_competencies: coveredCompetencies,
      missing: missing.slice(0, 10),
      missing_count: missing.length,
    },
  };
}

async function runDuplicateCheck(
  supabase: ReturnType<typeof createClient>,
  cp: Record<string, unknown>
): Promise<QualityCheckResult> {
  const curriculumId = (cp.curricula as { id: string }).id;

  const { data: questions } = await supabase
    .from('exam_questions')
    .select('id, question_text')
    .eq('curriculum_id', curriculumId);

  const totalQuestions = questions?.length || 0;
  const duplicates: { id1: string; id2: string; similarity: number }[] = [];

  if (questions && questions.length > 1) {
    for (let i = 0; i < questions.length; i++) {
      for (let j = i + 1; j < questions.length; j++) {
        const similarity = calculateTextSimilarity(
          questions[i].question_text,
          questions[j].question_text
        );
        
        if (similarity > 0.85) {
          duplicates.push({
            id1: questions[i].id,
            id2: questions[j].id,
            similarity: Math.round(similarity * 100),
          });
        }
      }
    }
  }

  const score = totalQuestions > 0 
    ? Math.round(((totalQuestions - duplicates.length) / totalQuestions) * 100) 
    : 100;

  return {
    checkType: 'duplicate',
    status: duplicates.length === 0 ? 'passed' : duplicates.length <= 3 ? 'warning' : 'failed',
    score,
    details: {
      total_questions: totalQuestions,
      duplicates_found: duplicates.length,
      duplicates: duplicates.slice(0, 5),
      similarity_threshold: 85,
    },
  };
}

async function runCorrectnessCheck(
  supabase: ReturnType<typeof createClient>,
  cp: Record<string, unknown>
): Promise<QualityCheckResult> {
  const curriculumId = (cp.curricula as { id: string }).id;

  const { data: questions } = await supabase
    .from('exam_questions')
    .select('id, options, correct_answer')
    .eq('curriculum_id', curriculumId);

  const totalQuestions = questions?.length || 0;
  const issues: { id: string; issue: string }[] = [];

  for (const q of (questions || [])) {
    const options = q.options as string[] | null;
    
    if (!options || options.length !== 4) {
      issues.push({ id: q.id, issue: `Falsche Optionsanzahl: ${options?.length || 0}` });
      continue;
    }

    if (typeof q.correct_answer !== 'number' || q.correct_answer < 0 || q.correct_answer > 3) {
      issues.push({ id: q.id, issue: `Ungültiger correct_answer: ${q.correct_answer}` });
      continue;
    }

    const emptyOptions = options.filter((o: string) => !o || o.trim() === '');
    if (emptyOptions.length > 0) {
      issues.push({ id: q.id, issue: 'Leere Antwortoptionen' });
    }
  }

  const validQuestions = totalQuestions - issues.length;
  const score = totalQuestions > 0 
    ? Math.round((validQuestions / totalQuestions) * 100) 
    : 100;

  return {
    checkType: 'correctness',
    status: issues.length === 0 ? 'passed' : 'failed',
    score,
    details: {
      total_questions: totalQuestions,
      valid_questions: validQuestions,
      issues: issues.slice(0, 10),
      issues_count: issues.length,
    },
  };
}

async function runDifficultyCheck(
  supabase: ReturnType<typeof createClient>,
  cp: Record<string, unknown>
): Promise<QualityCheckResult> {
  const curriculumId = (cp.curricula as { id: string }).id;

  const { data: questions } = await supabase
    .from('exam_questions')
    .select('difficulty')
    .eq('curriculum_id', curriculumId);

  const totalQuestions = questions?.length || 0;
  
  const counts = { easy: 0, medium: 0, hard: 0 };
  for (const q of (questions || [])) {
    const diff = q.difficulty as 'easy' | 'medium' | 'hard';
    if (counts[diff] !== undefined) {
      counts[diff]++;
    } else {
      counts.medium++;
    }
  }

  const target = { easy: 30, medium: 50, hard: 20 };
  const actual = {
    easy: totalQuestions > 0 ? Math.round((counts.easy / totalQuestions) * 100) : 0,
    medium: totalQuestions > 0 ? Math.round((counts.medium / totalQuestions) * 100) : 0,
    hard: totalQuestions > 0 ? Math.round((counts.hard / totalQuestions) * 100) : 0,
  };

  const deviation = Math.abs(actual.easy - target.easy) + 
                    Math.abs(actual.medium - target.medium) + 
                    Math.abs(actual.hard - target.hard);
  
  const score = Math.max(0, 100 - deviation);

  return {
    checkType: 'difficulty_distribution',
    status: score >= 85 ? 'passed' : score >= 70 ? 'warning' : 'failed',
    score,
    details: {
      target,
      actual,
      counts,
      total_questions: totalQuestions,
      deviation,
    },
  };
}

function calculateTextSimilarity(text1: string, text2: string): number {
  const normalize = (text: string) => 
    text.toLowerCase().replace(/[^a-zäöüß0-9\s]/g, '').split(/\s+/).filter(Boolean);
  
  const words1 = new Set(normalize(text1));
  const words2 = new Set(normalize(text2));
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}
