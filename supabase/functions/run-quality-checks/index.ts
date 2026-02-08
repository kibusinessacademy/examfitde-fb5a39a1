import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface QualityCheckResult {
  checkType: string;
  status: 'passed' | 'failed' | 'warning';
  score: number;
  details: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { checkId, checkType, curriculumProductId } = await req.json();

    if (!checkId || !checkType || !curriculumProductId) {
      return new Response(
        JSON.stringify({ error: "checkId, checkType, and curriculumProductId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[QUALITY-CHECK] Running ${checkType} for curriculum_product ${curriculumProductId}`);

    // Get curriculum product with related data
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

    // Update check status to running
    await supabase
      .from('quality_checks')
      .update({ status: 'running' })
      .eq('id', checkId);

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

    // Update check with results
    const { error: updateError } = await supabase
      .from('quality_checks')
      .update({
        status: result.status,
        score: result.score,
        details: result.details,
        executed_at: new Date().toISOString(),
      })
      .eq('id', checkId);

    if (updateError) {
      console.error("Error updating quality check:", updateError);
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

// Coverage Check: Verify all competencies have content
async function runCoverageCheck(
  supabase: ReturnType<typeof createClient>,
  cp: Record<string, unknown>
): Promise<QualityCheckResult> {
  const curriculumId = (cp.curricula as { id: string }).id;
  const product = cp.store_products as { product_key: string; includes_learning_course: boolean; includes_exam_trainer: boolean };

  // Get all competencies for this curriculum
  const { data: competencies, error: compError } = await supabase
    .from('competencies')
    .select('id, code, title, learning_field_id')
    .eq('learning_field_id', supabase.raw(`(SELECT id FROM learning_fields WHERE curriculum_id = '${curriculumId}')`));

  // Alternative: Get via learning_fields
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
    // Check lessons coverage
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
    // Check questions coverage
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
      missing: missing.slice(0, 10), // Limit to first 10
      missing_count: missing.length,
    },
  };
}

// Duplicate Check: Find similar questions
async function runDuplicateCheck(
  supabase: ReturnType<typeof createClient>,
  cp: Record<string, unknown>
): Promise<QualityCheckResult> {
  const curriculumId = (cp.curricula as { id: string }).id;

  // Get all questions for this curriculum
  const { data: questions } = await supabase
    .from('exam_questions')
    .select('id, question_text')
    .eq('curriculum_id', curriculumId);

  const totalQuestions = questions?.length || 0;
  const duplicates: { id1: string; id2: string; similarity: number }[] = [];

  // Simple similarity check using normalized text comparison
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
      duplicates: duplicates.slice(0, 5), // Show first 5
      similarity_threshold: 85,
    },
  };
}

// Correctness Check: Verify question structure
async function runCorrectnessCheck(
  supabase: ReturnType<typeof createClient>,
  cp: Record<string, unknown>
): Promise<QualityCheckResult> {
  const curriculumId = (cp.curricula as { id: string }).id;

  // Get all questions
  const { data: questions } = await supabase
    .from('exam_questions')
    .select('id, options, correct_answer')
    .eq('curriculum_id', curriculumId);

  const totalQuestions = questions?.length || 0;
  const issues: { id: string; issue: string }[] = [];

  for (const q of (questions || [])) {
    const options = q.options as string[] | null;
    
    // Check: exactly 4 options
    if (!options || options.length !== 4) {
      issues.push({ id: q.id, issue: `Falsche Optionsanzahl: ${options?.length || 0}` });
      continue;
    }

    // Check: correct_answer is valid index (0-3)
    if (typeof q.correct_answer !== 'number' || q.correct_answer < 0 || q.correct_answer > 3) {
      issues.push({ id: q.id, issue: `Ungültiger correct_answer: ${q.correct_answer}` });
      continue;
    }

    // Check: no empty options
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

// Difficulty Distribution Check
async function runDifficultyCheck(
  supabase: ReturnType<typeof createClient>,
  cp: Record<string, unknown>
): Promise<QualityCheckResult> {
  const curriculumId = (cp.curricula as { id: string }).id;

  // Get question counts by difficulty
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
      counts.medium++; // Default unknown to medium
    }
  }

  // Target distribution: 30% easy, 50% medium, 20% hard
  const target = { easy: 30, medium: 50, hard: 20 };
  const actual = {
    easy: totalQuestions > 0 ? Math.round((counts.easy / totalQuestions) * 100) : 0,
    medium: totalQuestions > 0 ? Math.round((counts.medium / totalQuestions) * 100) : 0,
    hard: totalQuestions > 0 ? Math.round((counts.hard / totalQuestions) * 100) : 0,
  };

  // Calculate deviation
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

// Simple text similarity (Jaccard index on words)
function calculateTextSimilarity(text1: string, text2: string): number {
  const normalize = (text: string) => 
    text.toLowerCase().replace(/[^a-zäöüß0-9\s]/g, '').split(/\s+/).filter(Boolean);
  
  const words1 = new Set(normalize(text1));
  const words2 = new Set(normalize(text2));
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}
