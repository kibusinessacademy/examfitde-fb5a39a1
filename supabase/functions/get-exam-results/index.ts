import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { forbiddenResponse, unauthorizedResponse, validateAuth } from "../_shared/auth.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GET-EXAM-RESULTS] ${step}`, details ? JSON.stringify(details) : "");
};

interface RequestBody {
  session_id: string;
}

interface ExamResultsResponse {
  session: unknown;
  questions: unknown[];
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    logStep("Function started");

    const auth = await validateAuth(req);
    if (auth.error || !auth.user) {
      return unauthorizedResponse(auth.error || "Unauthorized", origin || undefined);
    }

    const body: RequestBody = await req.json();
    const sessionId = body?.session_id;
    if (!sessionId) {
      return new Response(JSON.stringify({ error: "session_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Load session (server-side) + verify ownership
    const { data: session, error: sessionError } = await admin
      .from("exam_sessions")
      .select(
        `
        id, user_id, mode, total_questions, score_percentage, passed,
        started_at, finished_at, breakdown, curriculum_id,
        blueprint:exam_blueprints(title, pass_threshold),
        curriculum:curricula(title)
      `
      )
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      logStep("Session not found", { sessionId, error: sessionError });
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (session.user_id !== auth.user.id) {
      return forbiddenResponse("Forbidden", origin || undefined);
    }

    if (!session.finished_at) {
      return new Response(JSON.stringify({ error: "Session not finished" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Entitlement check (server-side)
    const { data: entitlement } = await admin.rpc("check_user_entitlement", {
      p_user_id: auth.user.id,
      p_curriculum_id: session.curriculum_id,
      p_feature: "exam_trainer",
    });

    if (!entitlement) {
      return forbiddenResponse("Access denied - no exam_trainer entitlement", origin || undefined);
    }

    // Load question details (includes correct answer + explanation for post-exam review)
    const { data: qs, error: qsError } = await admin
      .from("exam_session_questions")
      .select(
        `
        id, order_index, is_correct, user_answer, difficulty,
        learning_field_code, competency_code,
        question:exam_questions(question_text, options, correct_answer, explanation)
      `
      )
      .eq("exam_session_id", sessionId)
      .order("order_index");

    if (qsError) {
      logStep("Failed to load questions", { sessionId, error: qsError });
      return new Response(JSON.stringify({ error: "Failed to load questions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const questions = (qs || []).map((row: any) => {
      const options = Array.isArray(row?.question?.options) ? row.question.options : [];
      return {
        ...row,
        question: {
          ...row.question,
          // UI in ExamResultsPage erwartet {text}-Objekte
          options: options.map((t: string) => ({ text: String(t) })),
        },
      };
    });

    const payload: ExamResultsResponse = {
      session,
      questions,
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" },
    });
  }
});
