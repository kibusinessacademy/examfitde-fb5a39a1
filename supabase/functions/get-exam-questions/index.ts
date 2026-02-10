import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GET-EXAM-QUESTIONS] ${step}`, details ? JSON.stringify(details) : '');
};

/**
 * get-exam-questions – Blueprint-weighted SSOT Sampler
 * 
 * Supports two modes:
 * 1. competency_id mode: questions for a single competency (practice)
 * 2. curriculum_id mode: blueprint-weighted exam simulation
 *    - Distributes questions across learning fields by weight
 *    - Mixes difficulties per blueprint ratios
 */

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
}

interface SanitizedQuestion {
  id: string;
  question_text: string;
  options: string[];
  difficulty: string;
  learning_field_id: string | null;
  competency_id: string | null;
  // NOTE: correct_answer and explanation are NEVER sent to client
}

serve(async (req) => {
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

      // Entitlement check
      const { data: entitlement } = await adminClient
        .rpc('check_user_entitlement', {
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

      let query = adminClient
        .from('exam_questions')
        .select('id, question_text, options, difficulty, learning_field_id, competency_id')
        .eq('competency_id', competency_id)
        .eq('status', 'approved');

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
      }));

      return new Response(
        JSON.stringify({ questions: sanitized, total_available: questions?.length || 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── MODE 2: Blueprint-weighted exam simulation ──
    logStep("Blueprint exam mode", { curriculum_id, count });

    // Entitlement check
    const { data: entitlement } = await adminClient
      .rpc('check_user_entitlement', {
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

    // Load learning fields with competency counts for weighting
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

    // Weight = number of competencies per learning field (proxy for IHK weight)
    const totalCompetencies = learningFields.reduce((sum, lf) => sum + (lf.competencies?.length || 0), 0);

    // Distribute question count proportionally across learning fields
    const distribution: { lfId: string; quota: number }[] = [];
    let assigned = 0;

    for (const lf of learningFields) {
      const compCount = lf.competencies?.length || 0;
      const weight = totalCompetencies > 0 ? compCount / totalCompetencies : 1 / learningFields.length;
      const quota = Math.max(1, Math.round(weight * count));
      distribution.push({ lfId: lf.id, quota });
      assigned += quota;
    }

    // Adjust for rounding (add/remove from largest bucket)
    if (assigned !== count) {
      const diff = count - assigned;
      distribution.sort((a, b) => b.quota - a.quota);
      distribution[0].quota += diff;
    }

    logStep("Distribution", { distribution, totalCompetencies });

    // Difficulty mix: 30% easy, 50% medium, 20% hard (IHK-like)
    const DIFFICULTY_MIX = { easy: 0.3, medium: 0.5, hard: 0.2 };

    const allQuestions: SanitizedQuestion[] = [];
    const blueprintPlan: { learning_field_id: string; quota: number; fetched: number }[] = [];

    for (const { lfId, quota } of distribution) {
      // Get competency IDs for this learning field
      const { data: comps } = await adminClient
        .from('competencies')
        .select('id')
        .eq('learning_field_id', lfId);

      const compIds = (comps || []).map(c => c.id);
      if (!compIds.length) {
        blueprintPlan.push({ learning_field_id: lfId, quota, fetched: 0 });
        continue;
      }

      // Fetch approved questions for all competencies in this LF
      let lfQuery = adminClient
        .from('exam_questions')
        .select('id, question_text, options, difficulty, learning_field_id, competency_id')
        .in('competency_id', compIds)
        .eq('status', 'approved');

      if (exclude_question_ids.length > 0) {
        lfQuery = lfQuery.not('id', 'in', `(${exclude_question_ids.join(',')})`);
      }

      const { data: lfQuestions } = await lfQuery.limit(quota * 3);

      if (!lfQuestions?.length) {
        blueprintPlan.push({ learning_field_id: lfId, quota, fetched: 0 });
        continue;
      }

      // Apply difficulty mix sampling
      const byDiff: Record<string, typeof lfQuestions> = { easy: [], medium: [], hard: [] };
      for (const q of lfQuestions) {
        if (byDiff[q.difficulty]) byDiff[q.difficulty].push(q);
      }

      const sampled: typeof lfQuestions = [];
      for (const [diff, ratio] of Object.entries(DIFFICULTY_MIX)) {
        const diffCount = Math.max(1, Math.round(ratio * quota));
        const pool = byDiff[diff] || [];
        const shuffled = pool.sort(() => Math.random() - 0.5);
        sampled.push(...shuffled.slice(0, diffCount));
      }

      // Shuffle and limit to quota
      const final = sampled.sort(() => Math.random() - 0.5).slice(0, quota);

      for (const q of final) {
        allQuestions.push({
          id: q.id,
          question_text: q.question_text,
          options: q.options as string[],
          difficulty: q.difficulty,
          learning_field_id: q.learning_field_id,
          competency_id: q.competency_id,
        });
      }

      blueprintPlan.push({ learning_field_id: lfId, quota, fetched: final.length });
    }

    // Final shuffle to mix learning fields
    const finalQuestions = allQuestions.sort(() => Math.random() - 0.5).slice(0, count);

    logStep("Blueprint exam complete", { requested: count, delivered: finalQuestions.length });

    return new Response(
      JSON.stringify({
        questions: finalQuestions,
        total_available: allQuestions.length,
        blueprint_plan: blueprintPlan,
        difficulty_mix: DIFFICULTY_MIX,
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
