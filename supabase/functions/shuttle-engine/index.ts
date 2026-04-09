import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

const LOVABLE_API_URL = "https://api.lovable.dev/v1/chat/completions";

/**
 * Shuttle Engine — Production-ready continuous question stream.
 * 
 * POST /shuttle-engine
 * Actions:
 *   - start:     Create or resume session (with mode support)
 *   - next:      Get next weighted question (mode-aware)
 *   - submit:    Submit answer, get feedback + XP + streak
 *   - end:       End session with summary
 *   - explain:   AI-powered mistake explanation
 *   - dashboard: Get shuttle dashboard summary
 */

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const preflight = handleCorsPreflightRequest(req);
  if (preflight) return preflight;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Unauthorized" }, origin);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json(401, { error: "Unauthorized" }, origin);

    const body = await req.json();
    const { action } = body;

    if (!action) return json(400, { error: "Missing action" }, origin);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── START (with mode + resume) ──
    if (action === "start") {
      const { curriculum_id, mode = "adaptive", started_from } = body;
      if (!curriculum_id) return json(400, { error: "Missing curriculum_id" }, origin);

      const validModes = ["adaptive", "random", "weakness", "speed", "exam_lite"];
      const effectiveMode = validModes.includes(mode) ? mode : "adaptive";

      // Use get-or-create RPC
      const { data: session, error } = await serviceClient.rpc("fn_get_or_create_shuttle_session", {
        p_user_id: user.id,
        p_curriculum_id: curriculum_id,
        p_mode: effectiveMode,
        p_started_from: started_from || null,
      });

      if (error) throw error;

      // Record learning event only for new sessions
      if (!session.resumed) {
        await serviceClient.from("learning_events").insert({
          user_id: user.id,
          event_type: "shuttle_started",
          curriculum_id,
          payload: { session_id: session.id, mode: effectiveMode },
        }).catch(() => {});
      }

      return json(200, { session }, origin);
    }

    // ── NEXT (mode-aware) ──
    if (action === "next") {
      const { curriculum_id, session_id, mode } = body;
      if (!curriculum_id) return json(400, { error: "Missing curriculum_id" }, origin);

      const { data, error } = await serviceClient.rpc("fn_select_next_shuttle_question", {
        p_user_id: user.id,
        p_curriculum_id: curriculum_id,
        p_session_id: session_id || null,
        p_mode: mode || "adaptive",
      });

      if (error) throw error;

      if (!data || data.length === 0) {
        return json(200, { question: null, message: "No more questions available" }, origin);
      }

      const q = data[0];
      return json(200, {
        question: {
          id: q.question_id,
          question_text: q.question_text,
          question_type: q.question_type,
          options: q.options,
          competency_id: q.competency_id,
          difficulty: q.difficulty,
          trap_type: q.trap_type,
        },
      }, origin);
    }

    // ── SUBMIT (with XP + streak from RPC) ──
    if (action === "submit") {
      const { session_id, question_id, selected_answer, response_time_ms, curriculum_id } = body;
      if (!session_id || !question_id || selected_answer === undefined) {
        return json(400, { error: "Missing session_id, question_id, or selected_answer" }, origin);
      }

      // Use the RPC which handles everything transactionally
      const { data: result, error } = await serviceClient.rpc("fn_submit_shuttle_answer", {
        p_user_id: user.id,
        p_session_id: session_id,
        p_question_id: question_id,
        p_selected_option_indexes: JSON.stringify([selected_answer]),
        p_response_ms: response_time_ms || null,
      });

      if (error) throw error;

      // Check for duplicate
      if (result?.duplicate) {
        return json(409, { error: "Already answered", duplicate: true }, origin);
      }

      // Record learning event
      await serviceClient.from("learning_events").insert({
        user_id: user.id,
        event_type: "question_answered",
        curriculum_id: curriculum_id || null,
        competency_id: null,
        score: result.is_correct ? 1 : 0,
        payload: {
          source: "shuttle",
          session_id,
          question_id,
          is_correct: result.is_correct,
          xp_awarded: result.xp_awarded,
          streak: result.streak,
        },
      }).catch(() => {});

      return json(200, { feedback: result }, origin);
    }

    // ── END ──
    if (action === "end") {
      const { session_id } = body;
      if (!session_id) return json(400, { error: "Missing session_id" }, origin);

      const { data: sess } = await serviceClient
        .from("shuttle_sessions")
        .select("questions_answered, correct_count, curriculum_id, current_streak, best_streak, xp_earned, mode")
        .eq("id", session_id)
        .single();

      await serviceClient
        .from("shuttle_sessions")
        .update({ ended_at: new Date().toISOString(), status: "completed" })
        .eq("id", session_id);

      // Update total_sessions in user stats
      if (sess) {
        await serviceClient.rpc("fn_complete_shuttle_session", {
          p_session_id: session_id,
        }).catch(() => {});

        await serviceClient.from("learning_events").insert({
          user_id: user.id,
          event_type: "shuttle_completed",
          curriculum_id: sess.curriculum_id,
          payload: {
            session_id,
            questions_answered: sess.questions_answered,
            correct_count: sess.correct_count,
            accuracy: sess.questions_answered > 0
              ? Math.round((sess.correct_count / sess.questions_answered) * 100) : 0,
            best_streak: sess.best_streak,
            xp_earned: sess.xp_earned,
            mode: sess.mode,
          },
        }).catch(() => {});
      }

      return json(200, {
        summary: {
          questions_answered: sess?.questions_answered || 0,
          correct_count: sess?.correct_count || 0,
          accuracy: sess?.questions_answered
            ? Math.round(((sess?.correct_count || 0) / sess.questions_answered) * 100) : 0,
          best_streak: sess?.best_streak || 0,
          xp_earned: sess?.xp_earned || 0,
          mode: sess?.mode || "adaptive",
        },
      }, origin);
    }

    // ── DASHBOARD ──
    if (action === "dashboard") {
      const { curriculum_id } = body;
      if (!curriculum_id) return json(400, { error: "Missing curriculum_id" }, origin);

      const { data, error } = await serviceClient.rpc("fn_get_shuttle_dashboard_summary", {
        p_user_id: user.id,
        p_curriculum_id: curriculum_id,
      });

      if (error) throw error;
      return json(200, { summary: data }, origin);
    }

    // ── EXPLAIN (AI-powered mistake explanation) ──
    if (action === "explain") {
      const { question_id, selected_answer } = body;
      if (!question_id) return json(400, { error: "Missing question_id" }, origin);
      if (selected_answer === undefined) return json(400, { error: "Missing selected_answer" }, origin);

      const { data: question, error: qErr } = await serviceClient
        .from("exam_questions")
        .select("id, question_text, correct_answer, explanation, trap_tags, distractor_meta, options, competency_id")
        .eq("id", question_id)
        .single();

      if (qErr || !question) return json(404, { error: "Question not found" }, origin);

      const opts = question.options as any[];
      const selectedText = opts?.[selected_answer] || `Option ${selected_answer}`;
      const correctText = opts?.[question.correct_answer] || `Option ${question.correct_answer}`;
      const trapInfo = question.trap_tags?.length
        ? `Fallen-Typen: ${(question.trap_tags as string[]).join(", ")}` : "";

      const prompt = `Du bist ein freundlicher, präziser Prüfungscoach für IHK-Prüfungen.

Ein Lerner hat die folgende Frage FALSCH beantwortet. Erkläre kurz und verständlich:
1. WARUM die gewählte Antwort falsch ist (max 2 Sätze)
2. WARUM die richtige Antwort korrekt ist (max 2 Sätze)  
3. Ein konkreter Lerntipp, wie man sich den Unterschied merken kann (1 Satz)

Frage: ${question.question_text}

Gewählte Antwort (FALSCH): ${selectedText}
Richtige Antwort: ${correctText}
${trapInfo}
${question.explanation ? `Basis-Erklärung: ${question.explanation}` : ""}

Antworte auf Deutsch, kompakt (max 150 Wörter), motivierend. Nutze ggf. Emojis sparsam.`;

      try {
        const apiKey = Deno.env.get("LOVABLE_API_KEY");
        if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

        const aiResp = await fetch(LOVABLE_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 400,
            temperature: 0.7,
          }),
        });

        if (!aiResp.ok) {
          const errText = await aiResp.text();
          console.error("[shuttle] AI error:", errText);
          throw new Error(`AI request failed: ${aiResp.status}`);
        }

        const aiData = await aiResp.json();
        const explanation = aiData.choices?.[0]?.message?.content || "Keine Erklärung verfügbar.";
        return json(200, { explanation, trap_tags: question.trap_tags || [] }, origin);

      } catch (aiErr) {
        console.error("[shuttle] explain error:", aiErr);
        return json(200, {
          explanation: question.explanation || "Leider ist keine detaillierte Erklärung verfügbar.",
          trap_tags: question.trap_tags || [],
          fallback: true,
        }, origin);
      }
    }

    return json(400, { error: `Unknown action: ${action}` }, origin);

  } catch (err) {
    console.error("[shuttle-engine] Error:", err);
    return json(500, { error: err.message || "Internal error" }, origin);
  }
});
