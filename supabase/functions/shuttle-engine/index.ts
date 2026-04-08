import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

const LOVABLE_API_URL = "https://api.lovable.dev/v1/chat/completions";

/**
 * Shuttle Engine — Continuous question stream without friction.
 * 
 * POST /shuttle-engine
 * Actions:
 *   - start:  Create a new shuttle session
 *   - next:   Get next weighted question
 *   - submit: Submit answer, get feedback
 *   - end:    End session
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
    const { action, curriculum_id, session_id, question_id, selected_answer } = body;

    if (!action) return json(400, { error: "Missing action" }, origin);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── START ──
    if (action === "start") {
      if (!curriculum_id) return json(400, { error: "Missing curriculum_id" }, origin);

      const { data: session, error } = await serviceClient
        .from("shuttle_sessions")
        .insert({
          user_id: user.id,
          curriculum_id,
        })
        .select("id, started_at")
        .single();

      if (error) throw error;

      // Record learning event
      await serviceClient.from("learning_events").insert({
        user_id: user.id,
        event_type: "shuttle_started",
        curriculum_id,
        payload: { session_id: session.id },
      });

      return json(200, { session }, origin);
    }

    // ── NEXT ──
    if (action === "next") {
      if (!curriculum_id) return json(400, { error: "Missing curriculum_id" }, origin);

      const { data, error } = await serviceClient.rpc("get_shuttle_next_question", {
        p_user_id: user.id,
        p_curriculum_id: curriculum_id,
        p_session_id: session_id || null,
      });

      if (error) throw error;

      if (!data || data.length === 0) {
        return json(200, { question: null, message: "No more questions available" }, origin);
      }

      const q = data[0];
      // Strip correct_answer from response — client should not know it
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

    // ── SUBMIT ──
    if (action === "submit") {
      if (!session_id || !question_id || selected_answer === undefined) {
        return json(400, { error: "Missing session_id, question_id, or selected_answer" }, origin);
      }

      // Fetch the question to validate answer
      const { data: question, error: qErr } = await serviceClient
        .from("exam_questions")
        .select("id, correct_answer, explanation, trap_tags, distractor_meta, competency_id, blueprint_id, options")
        .eq("id", question_id)
        .single();

      if (qErr || !question) return json(404, { error: "Question not found" }, origin);

      const isCorrect = question.correct_answer === selected_answer;

      // Insert shuttle event
      const { error: evErr } = await serviceClient.from("shuttle_events").insert({
        session_id,
        question_id,
        is_correct: isCorrect,
        response_time_ms: body.response_time_ms || null,
      });
      if (evErr) throw evErr;

      // Update session counters
      await serviceClient.rpc("increment_shuttle_counters" as any, {
        p_session_id: session_id,
        p_is_correct: isCorrect,
      }).catch(() => {
        // Fallback: manual update if RPC doesn't exist yet
        return serviceClient
          .from("shuttle_sessions")
          .update({
            questions_answered: undefined, // will be handled below
          })
          .eq("id", session_id);
      });

      // Manual counter increment as fallback
      const { data: sess } = await serviceClient
        .from("shuttle_sessions")
        .select("questions_answered, correct_count, curriculum_id")
        .eq("id", session_id)
        .single();

      if (sess) {
        await serviceClient
          .from("shuttle_sessions")
          .update({
            questions_answered: (sess.questions_answered || 0) + 1,
            correct_count: (sess.correct_count || 0) + (isCorrect ? 1 : 0),
          })
          .eq("id", session_id);
      }

      // Record learning event
      await serviceClient.from("learning_events").insert({
        user_id: user.id,
        event_type: "question_answered",
        curriculum_id: sess?.curriculum_id || null,
        competency_id: question.competency_id || null,
        score: isCorrect ? 1 : 0,
        payload: {
          source: "shuttle",
          session_id,
          question_id,
          is_correct: isCorrect,
        },
      });

      // Build feedback response
      const feedback: Record<string, unknown> = {
        is_correct: isCorrect,
        correct_answer: question.correct_answer,
        explanation: question.explanation,
      };

      if (!isCorrect) {
        feedback.trap_tags = question.trap_tags;
        feedback.distractor_meta = question.distractor_meta;
        // Include the correct option text for clarity
        if (question.options && Array.isArray(question.options)) {
          feedback.correct_option_text = (question.options as any[])[question.correct_answer];
        }
      }

      return json(200, { feedback }, origin);
    }

    // ── END ──
    if (action === "end") {
      if (!session_id) return json(400, { error: "Missing session_id" }, origin);

      const { data: sess } = await serviceClient
        .from("shuttle_sessions")
        .select("questions_answered, correct_count, curriculum_id")
        .eq("id", session_id)
        .single();

      await serviceClient
        .from("shuttle_sessions")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", session_id);

      // Record completion event
      if (sess) {
        await serviceClient.from("learning_events").insert({
          user_id: user.id,
          event_type: "shuttle_completed",
          curriculum_id: sess.curriculum_id,
          payload: {
            session_id,
            questions_answered: sess.questions_answered,
            correct_count: sess.correct_count,
            accuracy: sess.questions_answered > 0
              ? Math.round((sess.correct_count / sess.questions_answered) * 100)
              : 0,
          },
        });
      }

      return json(200, {
        summary: {
          questions_answered: sess?.questions_answered || 0,
          correct_count: sess?.correct_count || 0,
          accuracy: sess?.questions_answered
            ? Math.round(((sess?.correct_count || 0) / sess.questions_answered) * 100)
            : 0,
        },
      }, origin);
    }

    // ── EXPLAIN ── (Phase 3: Explain My Mistake)
    if (action === "explain") {
      if (!question_id) return json(400, { error: "Missing question_id" }, origin);

      const selectedIdx = body.selected_answer;
      if (selectedIdx === undefined) return json(400, { error: "Missing selected_answer" }, origin);

      // Fetch question details
      const { data: question, error: qErr } = await serviceClient
        .from("exam_questions")
        .select("id, question_text, correct_answer, explanation, trap_tags, distractor_meta, options, competency_id")
        .eq("id", question_id)
        .single();

      if (qErr || !question) return json(404, { error: "Question not found" }, origin);

      // Build context for AI
      const opts = question.options as any[];
      const selectedText = opts?.[selectedIdx] || `Option ${selectedIdx}`;
      const correctText = opts?.[question.correct_answer] || `Option ${question.correct_answer}`;
      const trapInfo = question.trap_tags?.length
        ? `Fallen-Typen: ${(question.trap_tags as string[]).join(", ")}`
        : "";

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
        // Fallback to static explanation
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
