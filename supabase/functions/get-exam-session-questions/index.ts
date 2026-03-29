// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { forbiddenResponse, unauthorizedResponse, validateAuth } from "../_shared/auth.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/security.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GET-EXAM-SESSION-QUESTIONS] ${step}`, details ? JSON.stringify(details) : "");
};

interface RequestBody {
  session_id: string;
}

Deno.serve(async (req) => {
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

    // ── Rate Limit Check ──
    const rateLimitOk = await checkRateLimit(admin, auth.user.id, "get-exam-session-questions");
    if (!rateLimitOk) {
      logStep("RATE_LIMIT_BLOCKED", { userId: auth.user.id });
      return rateLimitResponse(origin);
    }

    // Load session + verify ownership
    const { data: session, error: sessionError } = await admin
      .from("exam_sessions")
      .select("id, user_id, curriculum_id")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (session.user_id !== auth.user.id) {
      return forbiddenResponse("Forbidden", origin || undefined);
    }

    // Phase 3: product-based access check
    const { data: entitlement } = await admin.rpc("check_product_access_by_curriculum" as any, {
      p_user_id: auth.user.id,
      p_curriculum_id: session.curriculum_id,
      p_feature: "exam_trainer",
    });

    if (!entitlement) {
      return forbiddenResponse("Access denied - no exam_trainer entitlement", origin || undefined);
    }

    // Load sanitized questions (NO correct_answer / explanation)
    const { data: rows, error: rowsError } = await admin
      .from("exam_session_questions")
      .select(
        `
        id,
        exam_session_id,
        question_id,
        order_index,
        difficulty,
        learning_field_code,
        competency_code,
        user_answer,
        is_correct,
        answered_at,
        time_spent_seconds,
        question:exam_questions(id, question_text, options, difficulty)
      `
      )
      .eq("exam_session_id", sessionId)
      .order("order_index");

    if (rowsError) {
      logStep("Failed to load session questions", { sessionId, error: rowsError });
      return new Response(JSON.stringify({ error: "Failed to load questions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ questions: rows || [] }), {
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
