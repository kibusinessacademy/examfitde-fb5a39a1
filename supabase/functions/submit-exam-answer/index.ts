import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[SUBMIT-EXAM-ANSWER] ${step}`, details ? JSON.stringify(details) : '');
};

interface SubmitAnswerRequest {
  question_id: string;
  selected_answer: number;
  session_id?: string;
}

interface AnswerResult {
  is_correct: boolean;
  correct_answer: number;
  explanation: string;
}

serve(async (req) => {
  // Handle CORS preflight
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

    // Parse request
    const body: SubmitAnswerRequest = await req.json();
    const { question_id, selected_answer, session_id } = body;

    if (!question_id || selected_answer === undefined || selected_answer === null) {
      return new Response(
        JSON.stringify({ error: "question_id and selected_answer are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role to access questions (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get the question with correct answer (SERVER-SIDE ONLY)
    const { data: question, error: questionError } = await adminClient
      .from('exam_questions')
      .select('id, correct_answer, explanation, competency_id, curriculum_id')
      .eq('id', question_id)
      .eq('status', 'approved')
      .single();

    if (questionError || !question) {
      logStep("ERROR: Question not found", { questionId: question_id, error: questionError });
      return new Response(
        JSON.stringify({ error: "Question not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check entitlement before revealing answer
    const { data: entitlement } = await adminClient
      .rpc('check_user_entitlement', {
        p_user_id: user.id,
        p_curriculum_id: question.curriculum_id,
        p_feature: 'exam_trainer'
      });

    if (!entitlement) {
      return new Response(
        JSON.stringify({ error: "Access denied - no exam_trainer entitlement" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Evaluate answer
    const isCorrect = selected_answer === question.correct_answer;

    logStep("Answer evaluated", { 
      questionId: question_id, 
      selectedAnswer: selected_answer, 
      correctAnswer: question.correct_answer,
      isCorrect 
    });

    // Store the answer attempt
    const { error: attemptError } = await adminClient
      .from('question_attempts')
      .insert({
        user_id: user.id,
        question_id: question_id,
        selected_answer: selected_answer,
        is_correct: isCorrect,
        session_id: session_id || null,
        answered_at: new Date().toISOString(),
      });

    if (attemptError) {
      // Log but don't fail - storing attempt is secondary to returning result
      logStep("WARNING: Failed to store attempt", { error: attemptError });
    }

    // Update spaced repetition data
    try {
      await adminClient.rpc('update_spaced_repetition', {
        p_user_id: user.id,
        p_question_id: question_id,
        p_is_correct: isCorrect
      });
    } catch (srError) {
      logStep("WARNING: Failed to update spaced repetition", { error: srError });
    }

    // Return result with correct answer and explanation (NOW ALLOWED - after entitlement check)
    const result: AnswerResult = {
      is_correct: isCorrect,
      correct_answer: question.correct_answer,
      explanation: question.explanation || '',
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...getCorsHeaders(null), "Content-Type": "application/json" } }
    );
  }
});
