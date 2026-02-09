import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GET-EXAM-QUESTIONS] ${step}`, details ? JSON.stringify(details) : '');
};

interface RequestBody {
  competency_id: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  count?: number;
  exclude_question_ids?: string[];
}

interface SanitizedQuestion {
  id: string;
  question_text: string;
  options: string[];
  difficulty: string;
  // NOTE: correct_answer and explanation are NEVER sent to client
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
    const body: RequestBody = await req.json();
    const { competency_id, difficulty = 'medium', count = 5, exclude_question_ids = [] } = body;

    if (!competency_id) {
      return new Response(
        JSON.stringify({ error: "competency_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role to access questions (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get competency info for entitlement check
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

    // Get learning field for curriculum
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

    // Check entitlement
    const { data: entitlement } = await adminClient
      .rpc('check_user_entitlement', {
        p_user_id: user.id,
        p_curriculum_id: learningField.curriculum_id,
        p_feature: 'exam_trainer'
      });

    if (!entitlement) {
      return new Response(
        JSON.stringify({ error: "Access denied - no exam_trainer entitlement for this curriculum" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    logStep("Entitlement verified");

    // Query approved questions - SERVER-SIDE ONLY
    let query = adminClient
      .from('exam_questions')
      .select('id, question_text, options, difficulty')
      .eq('competency_id', competency_id)
      .eq('status', 'approved')
      .eq('difficulty', difficulty);

    // Exclude already seen questions
    if (exclude_question_ids.length > 0) {
      query = query.not('id', 'in', `(${exclude_question_ids.join(',')})`);
    }

    const { data: questions, error: questionsError } = await query.limit(count * 2);

    if (questionsError) {
      logStep("ERROR: Query failed", { error: questionsError });
      return new Response(
        JSON.stringify({ error: "Failed to fetch questions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Shuffle and limit
    const shuffled = (questions || []).sort(() => Math.random() - 0.5).slice(0, count);

    // CRITICAL: Sanitize response - remove correct_answer and explanation
    const sanitizedQuestions: SanitizedQuestion[] = shuffled.map(q => ({
      id: q.id,
      question_text: q.question_text,
      options: q.options as string[],
      difficulty: q.difficulty,
    }));

    logStep("Questions fetched and sanitized", { count: sanitizedQuestions.length });

    return new Response(
      JSON.stringify({ 
        questions: sanitizedQuestions,
        total_available: questions?.length || 0
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
