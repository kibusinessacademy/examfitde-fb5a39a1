// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GET-EXAM-QUESTIONS] ${step}`, details ? JSON.stringify(details) : '');
};

/**
 * get-exam-questions – IHK-Realistic Exam Assembler v2
 * 
 * Supports two modes:
 * 1. competency_id mode: questions for a single competency (practice)
 * 2. curriculum_id mode: blueprint-weighted exam simulation
 *    - Distributes questions across learning fields by weight
 *    - Enforces question_type mix (calculation, best_option, error_detection, etc.)
 *    - Coverage gate: every LF gets minimum representation
 *    - No adjacent same-subtopic questions
 */

// ─── IHK-Realistic Question Type Mix ─────────────────────────────────────────
const QUESTION_TYPE_MIX: Record<string, number> = {
  calculation: 0.40,       // 40-50%: Rechen-/Anwendungsaufgaben
  best_option: 0.25,       // 20-30%: Entscheidungsfragen
  error_detection: 0.15,   // 10-20%: Fehleranalyse
  compliance_check: 0.08,  // 5-10%: Compliance/Normen
  risk_assessment: 0.07,   // Stolperfallen
  case_study: 0.05,        // Fallstudien
};

interface RequestBody {
  // Mode 1: single competency practice
  competency_id?: string;
  // Mode 2: full exam simulation
  curriculum_id?: string;
  blueprint_id?: string;
  // Shared
  difficulty?: 'easy' | 'medium' | 'hard';
  count?: number;
  exclude_question_ids?: string[];
  // Mode: "exam" (top-quality only) or "training" (broader pool)
  mode?: 'exam' | 'training';
}

interface SanitizedQuestion {
  id: string;
  question_text: string;
  options: string[];
  difficulty: string;
  learning_field_id: string | null;
  competency_id: string | null;
  question_type: string | null;
  cognitive_level: string | null;
  // NOTE: correct_answer and explanation are NEVER sent to client
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    logStep("Function started");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    logStep("User authenticated", { userId: user.id });

    const body: RequestBody = await req.json();
    const { competency_id, curriculum_id, blueprint_id, difficulty, count = 10, exclude_question_ids = [] } = body;

    if (!competency_id && !curriculum_id) {
      return new Response(
        JSON.stringify({ error: "competency_id or curriculum_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // ── MODE 1: Single competency practice ──
    if (competency_id) {
      const { data: competency } = await adminClient
        .from('competencies')
        .select('learning_field_id')
        .eq('id', competency_id)
        .single();

      if (!competency) {
        return new Response(
          JSON.stringify({ error: "Competency not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: learningField } = await adminClient
        .from('learning_fields')
        .select('curriculum_id')
        .eq('id', competency.learning_field_id)
        .single();

      if (!learningField) {
        return new Response(
          JSON.stringify({ error: "Learning field not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Phase 3: product-based access check
      const { data: entitlement } = await adminClient
        .rpc('check_product_access_by_curriculum' as any, {
          p_user_id: user.id,
          p_curriculum_id: learningField.curriculum_id,
          p_feature: 'exam_trainer'
        });

      if (!entitlement) {
        return new Response(
          JSON.stringify({ error: "Access denied - no exam_trainer entitlement" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Hard Gate: only approved questions (via approved-only view)
      let query = adminClient
        .from('v_exam_questions_approved')
        .select('id, question_text, options, difficulty, learning_field_id, competency_id')
        .eq('competency_id', competency_id);

      if (difficulty) query = query.eq('difficulty', difficulty);
      if (exclude_question_ids.length > 0) {
        query = query.not('id', 'in', `(${exclude_question_ids.join(',')})`);
      }

      const { data: questions, error: questionsError } = await query.limit(count * 2);
      if (questionsError) throw questionsError;

      const shuffled = (questions || []).sort(() => Math.random() - 0.5).slice(0, count);
      const sanitized: SanitizedQuestion[] = shuffled.map(q => ({
        id: q.id,
        question_text: q.question_text,
        options: q.options as string[],
        difficulty: q.difficulty,
        learning_field_id: q.learning_field_id,
        competency_id: q.competency_id,
        question_type: (q as any).question_type || null,
        cognitive_level: (q as any).cognitive_level || null,
      }));

      return new Response(
        JSON.stringify({ questions: sanitized, total_available: questions?.length || 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── MODE 2: IHK-Realistic Exam Simulation ──
    const examMode = body.mode || 'exam';
    logStep("Exam assembler mode", { curriculum_id, count, examMode });

    // Phase 3: product-based access check
    const { data: entitlement } = await adminClient
      .rpc('check_product_access_by_curriculum' as any, {
        p_user_id: user.id,
        p_curriculum_id: curriculum_id,
        p_feature: 'exam_trainer'
      });

    if (!entitlement) {
      return new Response(
        JSON.stringify({ error: "Access denied - no exam_trainer entitlement" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load learning fields with actual question counts for proportional weighting
    const { data: learningFields } = await adminClient
      .from('learning_fields')
      .select('id, title, code, sort_order, competencies(id)')
      .eq('curriculum_id', curriculum_id!)
      .order('sort_order');

    if (!learningFields?.length) {
      return new Response(
        JSON.stringify({ error: "No learning fields found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Get real question counts per LF for proportional assembly ──
    const lfQuestionCounts = new Map<string, number>();
    for (const lf of learningFields) {
      const { count: lfQCount } = await adminClient
        .from('v_exam_questions_approved')
        .select('id', { count: 'exact', head: true })
        .eq('learning_field_id', lf.id);
      lfQuestionCounts.set(lf.id, lfQCount ?? 0);
    }

    const totalAvailableQuestions = Array.from(lfQuestionCounts.values()).reduce((s, c) => s + c, 0);
    logStep("LF question pool", { totalAvailable: totalAvailableQuestions, lfs: learningFields.length });

    // ── Coverage Gate: distribute proportionally by available questions, enforce min 8% per LF ──
    const minPerTopic = Math.max(1, Math.ceil(count * 0.08));

    const distribution: { lfId: string; quota: number }[] = [];
    let assigned = 0;

    for (const lf of learningFields) {
      const lfAvailable = lfQuestionCounts.get(lf.id) ?? 0;
      if (lfAvailable === 0) continue; // Skip LFs with no questions

      const weight = totalAvailableQuestions > 0 ? lfAvailable / totalAvailableQuestions : 1 / learningFields.length;
      const quota = Math.max(minPerTopic, Math.round(weight * count));
      distribution.push({ lfId: lf.id, quota: Math.min(quota, lfAvailable) }); // Never request more than available
      assigned += Math.min(quota, lfAvailable);
    }

    // Adjust for rounding
    if (assigned !== count && distribution.length > 0) {
      const diff = count - assigned;
      distribution.sort((a, b) => b.quota - a.quota);
      // Distribute surplus/deficit across LFs with available capacity
      if (diff > 0) {
        for (let i = 0; i < diff && i < distribution.length; i++) {
          const lfAvail = lfQuestionCounts.get(distribution[i % distribution.length].lfId) ?? 0;
          if (distribution[i % distribution.length].quota < lfAvail) {
            distribution[i % distribution.length].quota++;
          }
        }
      } else {
        for (let i = 0; i < Math.abs(diff) && i < distribution.length; i++) {
          if (distribution[i % distribution.length].quota > 1) {
            distribution[i % distribution.length].quota--;
          }
        }
      }
    }

    logStep("Distribution", { distribution, minPerTopic });

    // IHK-realistic difficulty mix
    const DIFFICULTY_MIX = { easy: 0.27, medium: 0.38, hard: 0.25, very_hard: 0.10 };

    // Status filter: exam mode only uses top-quality questions
    const statusFilter = examMode === 'exam' ? 'approved' : undefined;

    const allQuestions: SanitizedQuestion[] = [];
    const blueprintPlan: { learning_field_id: string; quota: number; fetched: number }[] = [];

    for (const { lfId, quota } of distribution) {
      const { data: comps } = await adminClient
        .from('competencies')
        .select('id')
        .eq('learning_field_id', lfId);

      const compIds = (comps || []).map(c => c.id);
      if (!compIds.length) {
        blueprintPlan.push({ learning_field_id: lfId, quota, fetched: 0 });
        continue;
      }

      // Query pool (approved view for exam, broader for training)
      let lfQuery = adminClient
        .from('v_exam_questions_approved')
        .select('id, question_text, options, difficulty, learning_field_id, competency_id')
        .in('competency_id', compIds);

      if (exclude_question_ids.length > 0) {
        lfQuery = lfQuery.not('id', 'in', `(${exclude_question_ids.join(',')})`);
      }

      const { data: lfQuestions } = await lfQuery.limit(quota * 4);

      if (!lfQuestions?.length) {
        blueprintPlan.push({ learning_field_id: lfId, quota, fetched: 0 });
        continue;
      }

      // ── Difficulty mix sampling ──
      const byDiff: Record<string, typeof lfQuestions> = {};
      for (const q of lfQuestions) {
        const d = q.difficulty || 'medium';
        if (!byDiff[d]) byDiff[d] = [];
        byDiff[d].push(q);
      }

      const sampled: typeof lfQuestions = [];
      for (const [diff, ratio] of Object.entries(DIFFICULTY_MIX)) {
        const diffCount = Math.max(1, Math.round(ratio * quota));
        const pool = byDiff[diff] || [];
        const shuffled = pool.sort(() => Math.random() - 0.5);
        sampled.push(...shuffled.slice(0, diffCount));
      }

      // Fill remaining from any difficulty if under quota
      if (sampled.length < quota) {
        const usedIds = new Set(sampled.map(q => q.id));
        const remaining = lfQuestions.filter(q => !usedIds.has(q.id)).sort(() => Math.random() - 0.5);
        sampled.push(...remaining.slice(0, quota - sampled.length));
      }

      const final = sampled.sort(() => Math.random() - 0.5).slice(0, quota);

      for (const q of final) {
        allQuestions.push({
          id: q.id,
          question_text: q.question_text,
          options: q.options as string[],
          difficulty: q.difficulty,
          learning_field_id: q.learning_field_id,
          competency_id: q.competency_id,
          question_type: (q as any).question_type || null,
          cognitive_level: (q as any).cognitive_level || null,
        });
      }

      blueprintPlan.push({ learning_field_id: lfId, quota, fetched: final.length });
    }

    // ── Anti-Adjacent: no 2 questions from same competency back-to-back ──
    const shuffled = allQuestions.sort(() => Math.random() - 0.5);
    const reordered: SanitizedQuestion[] = [];
    const remaining = [...shuffled];

    while (remaining.length > 0) {
      const lastCompetency = reordered.length > 0 ? reordered[reordered.length - 1].competency_id : null;
      const nextIdx = remaining.findIndex(q => q.competency_id !== lastCompetency);
      if (nextIdx >= 0) {
        reordered.push(remaining.splice(nextIdx, 1)[0]);
      } else {
        reordered.push(remaining.shift()!);
      }
    }

    const finalQuestions = reordered.slice(0, count);

    // Coverage stats
    const coverageStats: Record<string, number> = {};
    for (const q of finalQuestions) {
      const lf = q.learning_field_id || 'unknown';
      coverageStats[lf] = (coverageStats[lf] || 0) + 1;
    }

    logStep("Exam assembled", { requested: count, delivered: finalQuestions.length, lfs_covered: Object.keys(coverageStats).length });

    return new Response(
      JSON.stringify({
        questions: finalQuestions,
        total_available: allQuestions.length,
        blueprint_plan: blueprintPlan,
        difficulty_mix: DIFFICULTY_MIX,
        question_type_mix: QUESTION_TYPE_MIX,
        coverage: coverageStats,
        mode: examMode,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" } }
    );
  }
});
