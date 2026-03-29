// Deno.serve is built-in
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { checkRateLimit, checkIdempotency, setIdempotencyResponse, logSecurityEvent, rateLimitResponse } from "../_shared/security.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[SUBMIT-EXAM-ANSWER] ${step}`, details ? JSON.stringify(details) : '');
};

// ── Trust Score Heuristics ──
function computeAttemptTrust(timeSpentMs: number | null, recentAttempts: { selected_answer: number; time_spent_ms: number | null }[]): number {
  let trust = 1.0;

  // 1) Too fast → suspicious (< 2.5s for a real question)
  if (timeSpentMs !== null && timeSpentMs < 2500) {
    trust -= 0.4;
  }

  // 2) Streak of very fast wrong answers (last 5)
  if (recentAttempts.length >= 5) {
    const fastWrong = recentAttempts.filter(a => (a.time_spent_ms ?? 99999) < 3000).length;
    if (fastWrong >= 4) trust -= 0.3;
  }

  // 3) Always-same-option pattern (last 8)
  if (recentAttempts.length >= 6) {
    const counts: Record<number, number> = {};
    for (const a of recentAttempts) {
      counts[a.selected_answer] = (counts[a.selected_answer] || 0) + 1;
    }
    const maxSame = Math.max(...Object.values(counts));
    if (maxSame / recentAttempts.length > 0.7) trust -= 0.3;
  }

  return Math.max(0, Math.min(1, trust));
}

interface SubmitAnswerRequest {
  question_id: string;
  selected_answer: number;
  session_id?: string;
  time_spent?: number;
  confidence?: number;
  idempotency_key?: string;
}

interface AnswerResult {
  is_correct: boolean;
  correct_answer: number;
  explanation: string;
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    logStep("User authenticated", { userId: user.id });

    const body: SubmitAnswerRequest = await req.json();
    const { question_id, selected_answer, session_id, confidence, time_spent, idempotency_key } = body;

    // ── Rate Limit Check ──
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const rateLimitOk = await checkRateLimit(adminClient, user.id, "submit-exam-answer");
    if (!rateLimitOk) {
      logStep("RATE_LIMIT_BLOCKED", { userId: user.id });
      return rateLimitResponse(origin);
    }

    // ── Idempotency Check (replay protection) ──
    if (idempotency_key) {
      const cached = await checkIdempotency(adminClient, idempotency_key, user.id, "submit-exam-answer");
      if (cached) {
        logStep("IDEMPOTENT_REPLAY", { key: idempotency_key });
        return new Response(JSON.stringify(cached),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }
    }

    if (!question_id || selected_answer === undefined || selected_answer === null) {
      return new Response(JSON.stringify({ error: "question_id and selected_answer are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // adminClient already created above for rate limit/idempotency

    // Get question
    const { data: question, error: questionError } = await adminClient
      .from('exam_questions')
      .select('id, correct_answer, explanation, competency_id, curriculum_id')
      .eq('id', question_id)
      .eq('status', 'approved')
      .single();

    if (questionError || !question) {
      logStep("ERROR: Question not found", { questionId: question_id, error: questionError });
      return new Response(JSON.stringify({ error: "Question not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Product-based access check (replaces legacy check_user_entitlement)
    const { data: hasAccess } = await adminClient
      .rpc('check_product_access_by_curriculum', {
        p_user_id: user.id,
        p_curriculum_id: question.curriculum_id,
        p_feature: 'exam_trainer'
      });

    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Access denied - no exam_trainer access" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isCorrect = selected_answer === question.correct_answer;
    const timeSpentMs = time_spent ? Math.round(time_spent * 1000) : null;

    // ── Trust Score: fetch recent attempts for pattern detection ──
    const { data: recentAttempts } = await adminClient
      .from('question_attempts')
      .select('selected_answer, time_spent_ms')
      .eq('user_id', user.id)
      .order('answered_at', { ascending: false })
      .limit(8);

    const trustScore = computeAttemptTrust(timeSpentMs, recentAttempts || []);
    const isTrusted = trustScore >= 0.6;

    logStep("Answer evaluated", { questionId: question_id, isCorrect, trustScore, isTrusted });

    // ── Compute attempt_number for this user+question ──
    const { count: prevCount } = await adminClient
      .from('question_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('question_id', question_id);

    const attemptNumber = (prevCount || 0) + 1;

    // Store attempt with trust metadata
    const { error: attemptError } = await adminClient
      .from('question_attempts')
      .insert({
        user_id: user.id,
        question_id,
        selected_answer,
        is_correct: isCorrect,
        session_id: session_id || null,
        answered_at: new Date().toISOString(),
        trust_score: Math.round(trustScore * 100) / 100,
        time_spent_ms: timeSpentMs,
        attempt_number: attemptNumber,
      });

    if (attemptError) logStep("WARNING: Failed to store attempt", { error: attemptError });

    // Confidence on session questions
    if (session_id && confidence !== undefined && confidence !== null) {
      await adminClient
        .from('exam_session_questions')
        .update({ user_confidence: confidence })
        .eq('exam_session_id', session_id)
        .eq('question_id', question_id);
    }

    // Spaced repetition
    try {
      await adminClient.rpc('update_spaced_repetition', {
        p_user_id: user.id, p_question_id: question_id, p_is_correct: isCorrect
      });
    } catch (e) { logStep("WARNING: spaced rep failed", { error: e }); }

    // Theta recalc
    try {
      await adminClient.rpc('calculate_user_theta', {
        p_user_id: user.id, p_curriculum_id: question.curriculum_id,
      });
    } catch (e) { logStep("WARNING: theta failed", { error: e }); }

    // Adaptive session append
    if (session_id) {
      try {
        const { data: sessionRow } = await adminClient
          .from("exam_sessions").select("mode").eq("id", session_id).maybeSingle();
        if (sessionRow?.mode === "adaptive") {
          await adminClient.rpc("append_next_adaptive_question", { p_session_id: session_id });
        }
      } catch (_e) { logStep("WARNING: adaptive append failed", { error: _e }); }
    }

    // ── Robust Competency Stats Update (only trusted attempts count) ──
    try {
      await updateCompetencyStats(adminClient, question, isTrusted, isCorrect, attemptNumber);
    } catch (perfErr) {
      logStep("WARNING: competency stats update failed", { error: perfErr });
    }

    const result: AnswerResult = {
      is_correct: isCorrect,
      correct_answer: question.correct_answer,
      explanation: question.explanation || '',
    };

    // ── Cache idempotency response ──
    if (idempotency_key) {
      await setIdempotencyResponse(adminClient, idempotency_key, user.id, "submit-exam-answer", result as unknown as Record<string, unknown>);
    }

    return new Response(JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" } });
  }
});

// ── Robust aggregation with trust filtering ──
async function updateCompetencyStats(
  adminClient: ReturnType<typeof createClient>,
  question: { curriculum_id: string; competency_id: string | null },
  isTrusted: boolean,
  isCorrect: boolean,
  attemptNumber: number,
) {
  const topicKey = question.competency_id || question.curriculum_id;

  // Fetch current stats
  const { data: existing } = await adminClient
    .from("competency_performance_stats")
    .select("*")
    .eq("curriculum_id", question.curriculum_id)
    .eq("competency_id", question.competency_id)
    .maybeSingle();

  // Check if frozen → skip update
  if (existing?.frozen) {
    logStep("Competency frozen – skipping stats update");
    return;
  }

  const totalAttempts = (existing?.total_attempts || 0) + 1;
  const totalCorrect = (existing?.total_correct || 0) + (isCorrect ? 1 : 0);
  const trustedAttempts = (existing?.trusted_attempts || 0) + (isTrusted ? 1 : 0);

  // Count unique learners (approximate: use RPC or just increment tracking)
  // We'll use a simple heuristic: track in the existing field
  const uniqueLearners = existing?.unique_learners || 0;
  // Note: exact unique count would need a separate query; we approximate by incrementing
  // when attempt_number === 1 (first time this user answers this competency area)
  const newUniqueLearners = attemptNumber === 1 ? uniqueLearners + 1 : uniqueLearners;

  // Compute fail rates only from trusted attempts
  const trustedCorrect = (existing?.total_correct || 0) + (isTrusted && isCorrect ? 1 : 0);
  const failRate = trustedAttempts > 0 ? 1 - (trustedCorrect / trustedAttempts) : 0;

  // First-pass vs repeat fail rate (heuristic from attempt_number)
  const isFirstPass = attemptNumber <= 3;
  const firstPassFail = existing?.first_pass_fail_rate || 0;
  const repeatFail = existing?.repeat_fail_rate || 0;

  // Weighted running average for segment rates (alpha = 0.05)
  const alpha = 0.05;
  let newFirstPassFail = firstPassFail;
  let newRepeatFail = repeatFail;

  if (isTrusted) {
    if (isFirstPass) {
      newFirstPassFail = firstPassFail * (1 - alpha) + (isCorrect ? 0 : 1) * alpha;
    } else {
      newRepeatFail = repeatFail * (1 - alpha) + (isCorrect ? 0 : 1) * alpha;
    }
  }

  // Fragility level: based on repeat_fail_rate + minimum thresholds (debounce)
  let fragilityLevel = "stable";
  const prevRuns = existing?.consecutive_critical_runs || 0;

  if (trustedAttempts >= 15 && newUniqueLearners >= 5) {
    if (newRepeatFail > 0.50) {
      fragilityLevel = prevRuns >= 1 ? "critical" : "fragile"; // debounce: needs 2 runs
    } else if (newRepeatFail > 0.35) {
      fragilityLevel = "fragile";
    }
  }

  const consecutiveRuns = newRepeatFail > 0.50 ? prevRuns + 1 : 0;

  await adminClient.from("competency_performance_stats").upsert({
    curriculum_id: question.curriculum_id,
    competency_id: question.competency_id,
    learning_field_id: null,
    topic_key: topicKey,
    total_attempts: totalAttempts,
    total_correct: totalCorrect,
    trusted_attempts: trustedAttempts,
    unique_learners: newUniqueLearners,
    avg_score: trustedAttempts > 0 ? Math.round((trustedCorrect / trustedAttempts) * 10000) / 100 : 0,
    fail_rate: Math.round(failRate * 10000) / 10000,
    first_pass_fail_rate: Math.round(newFirstPassFail * 10000) / 10000,
    repeat_fail_rate: Math.round(newRepeatFail * 10000) / 10000,
    fragility_level: fragilityLevel,
    consecutive_critical_runs: consecutiveRuns,
    last_updated: new Date().toISOString(),
  }, { onConflict: "curriculum_id,competency_id,learning_field_id,topic_key" });
}
