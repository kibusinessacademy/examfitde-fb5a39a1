import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[EXAM-COACH-FEEDBACK] ${step}`, details ? JSON.stringify(details) : '');
};

/**
 * KI-Prüfer-Feedback Engine
 * 
 * After a completed exam simulation, generates personalized AI coaching:
 * - Strengths & weaknesses analysis
 * - 48h learning plan
 * - Encouragement tone adapted to score
 */

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
    // LOVABLE_API_KEY checked later for AI feedback

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { session_id } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Check if feedback already exists
    const { data: existing } = await admin
      .from('exam_ai_feedback')
      .select('id, strengths, weaknesses, learning_plan, summary')
      .eq('session_id', session_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ feedback: existing, cached: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load session data
    const { data: session } = await admin
      .from('exam_sessions')
      .select(`
        id, user_id, curriculum_id, score_percentage, passed, total_questions,
        breakdown, finished_at,
        curriculum:curricula(title)
      `)
      .eq('id', session_id)
      .single();

    if (!session || session.user_id !== user.id || !session.finished_at) {
      return new Response(JSON.stringify({ error: "Session not found or not finished" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load question details for analysis
    const { data: questions } = await admin
      .from('exam_session_questions')
      .select('is_correct, difficulty, learning_field_code, competency_code, time_spent_seconds')
      .eq('exam_session_id', session_id);

    // Build analysis data
    const breakdown = session.breakdown as any || {};
    const byLF = breakdown.by_learning_field || {};
    const byDiff = breakdown.by_difficulty || {};

    const weakLFs = Object.entries(byLF)
      .filter(([code, stats]: [string, any]) => code !== 'unknown' && stats.total > 0 && (stats.correct / stats.total) < 0.6)
      .sort((a: any, b: any) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total))
      .slice(0, 5);

    const strongLFs = Object.entries(byLF)
      .filter(([code, stats]: [string, any]) => code !== 'unknown' && stats.total > 0 && (stats.correct / stats.total) >= 0.75)
      .sort((a: any, b: any) => (b[1].correct / b[1].total) - (a[1].correct / a[1].total))
      .slice(0, 3);

    const avgTime = questions?.length 
      ? Math.round((questions.reduce((s, q) => s + (q.time_spent_seconds || 0), 0)) / questions.length) 
      : 0;

    const scorePercent = session.score_percentage ?? 0;
    const coachTone = scorePercent >= 80 ? 'congratulatory' : scorePercent >= 60 ? 'encouraging' : 'supportive';

    // Generate AI feedback via Lovable AI Gateway
    let aiSummary = '';
    let aiPlan: string[] = [];
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (LOVABLE_API_KEY) {
      try {
        const currTitle = (session.curriculum as any)?.title || 'Prüfung';
        const prompt = `Du bist ein erfahrener IHK-Prüfungscoach für "${currTitle}". 
Analysiere dieses Prüfungsergebnis und gib ein persönliches Coaching-Feedback auf Deutsch.

Ergebnis: ${scorePercent.toFixed(1)}% (${session.passed ? 'bestanden' : 'nicht bestanden'})
Bestehensgrenze: vermutlich 50%
Fragen gesamt: ${session.total_questions}
Ø Bearbeitungszeit pro Frage: ${avgTime}s

Schwache Lernfelder (< 60%):
${weakLFs.map(([code, stats]: [string, any]) => `- LF ${code}: ${Math.round((stats.correct / stats.total) * 100)}% (${stats.correct}/${stats.total})`).join('\n') || 'Keine'}

Starke Lernfelder (≥ 75%):
${strongLFs.map(([code, stats]: [string, any]) => `- LF ${code}: ${Math.round((stats.correct / stats.total) * 100)}%`).join('\n') || 'Keine'}

Schwierigkeitsanalyse:
${Object.entries(byDiff).map(([d, s]: [string, any]) => `- ${d}: ${s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0}%`).join('\n')}

Antworte im JSON-Format (kein Markdown, kein Code-Block):
{
  "summary": "2-3 Sätze persönliches Feedback (${coachTone} Tonfall)",
  "learning_plan": ["Schritt 1 für die nächsten 48h", "Schritt 2", "Schritt 3", "Schritt 4"]
}`;

        const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: "Du bist ein empathischer IHK-Prüfungscoach. Antworte ausschließlich als valides JSON." },
              { role: "user", content: prompt },
            ],
            temperature: 0.7,
            max_tokens: 800,
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || '';
          try {
            const cleaned = content.replace(/```json\s*/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleaned);
            aiSummary = parsed.summary || '';
            aiPlan = Array.isArray(parsed.learning_plan) ? parsed.learning_plan : [];
          } catch {
            aiSummary = content.slice(0, 500);
          }
        } else {
          const status = aiResponse.status;
          logStep("AI gateway error", { status });
          if (status === 429 || status === 402) {
            // Fallback: generate without AI
            aiSummary = scorePercent >= 60
              ? `Gutes Ergebnis mit ${scorePercent.toFixed(0)}%! Konzentriere dich auf die markierten Schwachstellen.`
              : `${scorePercent.toFixed(0)}% – noch nicht bestanden. Fokussiere dich auf die schwächsten Lernfelder.`;
          }
        }
      } catch (aiErr) {
        logStep("AI error (non-blocking)", { error: String(aiErr) });
      }
    }

    // Fallback if no AI
    if (!aiSummary) {
      aiSummary = scorePercent >= 60
        ? `Du hast ${scorePercent.toFixed(0)}% erreicht. ${weakLFs.length > 0 ? 'Arbeite an den markierten Schwachstellen, um dich weiter zu verbessern.' : 'Starke Leistung!'}`
        : `Mit ${scorePercent.toFixed(0)}% hast du die Prüfung leider nicht bestanden. Konzentriere dich auf die ${weakLFs.length} schwachen Lernfelder.`;
    }

    if (!aiPlan.length) {
      aiPlan = weakLFs.slice(0, 3).map(([code]: [string, any]) => `Lernfeld ${code} gezielt wiederholen`);
      if (avgTime > 120) aiPlan.push('Zeitmanagement üben: max. 90s pro Frage');
      if (!aiPlan.length) aiPlan.push('Nächste Simulation starten und Fortschritt messen');
    }

    const strengths = strongLFs.map(([code, stats]: [string, any]) => ({
      code, percentage: Math.round((stats.correct / stats.total) * 100),
    }));
    const weaknesses = weakLFs.map(([code, stats]: [string, any]) => ({
      code, percentage: Math.round((stats.correct / stats.total) * 100),
      errors: stats.total - stats.correct,
    }));

    // Store feedback
    const { data: feedback, error: fbError } = await admin
      .from('exam_ai_feedback')
      .insert({
        user_id: user.id,
        session_id,
        curriculum_id: session.curriculum_id,
        strengths,
        weaknesses,
        learning_plan: aiPlan,
        summary: aiSummary,
        coach_tone: coachTone,
      })
      .select()
      .single();

    if (fbError) throw fbError;

    logStep("Feedback generated", { id: feedback.id, tone: coachTone });

    return new Response(JSON.stringify({ feedback, cached: false }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" },
    });
  }
});
