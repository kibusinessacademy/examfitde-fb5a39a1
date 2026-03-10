// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[EXAM-COACH-FEEDBACK] ${step}`, details ? JSON.stringify(details) : '');
};

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

    // Load questions for timing analysis
    const { data: questions } = await admin
      .from('exam_session_questions')
      .select('is_correct, difficulty, learning_field_code, competency_code, time_spent_seconds')
      .eq('exam_session_id', session_id);

    // ─── Load coaching_trigger from get-exam-results diagnostic ───
    let coachingTrigger: any = null;
    try {
      const { data: diagData } = await admin.functions.invoke('get-exam-results', {
        body: { session_id },
        headers: { Authorization: authHeader },
      });
      coachingTrigger = diagData?.diagnostic?.coaching_trigger || null;
      logStep("Coaching trigger loaded", { mode: coachingTrigger?.mode, focus_skills: coachingTrigger?.focus_skills?.length });
    } catch (trigErr) {
      logStep("Coaching trigger load failed (non-blocking)", { error: String(trigErr) });
    }

    // Build analysis data
    const breakdown = session.breakdown as any || {};
    const byLF = breakdown.by_learning_field || {};
    const byDiff = breakdown.by_difficulty || {};
    const bySkillNode = breakdown.by_skill_node || {};

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

    // ─── Determine coaching mode and tone from trigger or fallback ───
    const coachingMode = coachingTrigger?.mode || (scorePercent >= 80 ? 'examiner' : scorePercent >= 50 ? 'coach' : 'explainer');
    const coachTone = coachingMode === 'explainer' ? 'supportive' 
      : coachingMode === 'coach' ? 'encouraging' 
      : 'congratulatory';

    // Build focus skills context from coaching_trigger
    const focusSkillsContext = coachingTrigger?.focus_skills?.length > 0
      ? `\nFokus-Kompetenzen (aus Diagnose):\n${coachingTrigger.focus_skills.map((s: any) => 
          `- ${s.kompetenz} (LF ${s.lernfeld}, Mastery: ${s.mastery_pct?.toFixed(0) ?? '?'}%${s.session_accuracy != null ? `, Session: ${s.session_accuracy}%` : ''})`
        ).join('\n')}`
      : '';

    const readinessContext = coachingTrigger?.readiness_verdict
      ? `\nPrüfungsreife-Einstufung: ${coachingTrigger.readiness_verdict}`
      : '';

    // ─── Generate AI feedback via Lovable AI Gateway ───
    let aiSummary = '';
    let aiPlan: string[] = [];
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (OPENAI_API_KEY) {
      try {
        const currTitle = (session.curriculum as any)?.title || 'Prüfung';
        
        const modeInstruction = coachingMode === 'explainer' 
          ? 'Sei einfühlsam und erklärend. Der Lernende braucht grundlegende Unterstützung und klare Anleitungen.'
          : coachingMode === 'coach'
          ? 'Sei ermutigend und konkret. Der Lernende ist auf dem Weg, braucht aber gezielte Hilfe bei Schwachstellen.'
          : 'Sei prüfungsfokussiert und anspruchsvoll. Der Lernende ist fast bereit — fokussiere auf Feinschliff und Prüfungsstrategie.';

        const prompt = `Du bist ein erfahrener IHK-Prüfungscoach für "${currTitle}".
Dein Coaching-Modus: ${coachingMode.toUpperCase()}
${modeInstruction}

Analysiere dieses Prüfungsergebnis und gib ein persönliches Coaching-Feedback auf Deutsch.

Ergebnis: ${scorePercent.toFixed(1)}% (${session.passed ? 'bestanden' : 'nicht bestanden'})
Bestehensgrenze: vermutlich 50%
Fragen gesamt: ${session.total_questions}
Ø Bearbeitungszeit pro Frage: ${avgTime}s
${readinessContext}
${focusSkillsContext}

Schwache Lernfelder (< 60%):
${weakLFs.map(([code, stats]: [string, any]) => `- LF ${code}: ${Math.round((stats.correct / stats.total) * 100)}% (${stats.correct}/${stats.total})`).join('\n') || 'Keine'}

Starke Lernfelder (≥ 75%):
${strongLFs.map(([code, stats]: [string, any]) => `- LF ${code}: ${Math.round((stats.correct / stats.total) * 100)}%`).join('\n') || 'Keine'}

Schwierigkeitsanalyse:
${Object.entries(byDiff).map(([d, s]: [string, any]) => `- ${d}: ${s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0}%`).join('\n')}

${coachingTrigger?.prompt_context ? `\nDiagnostischer Kontext:\n${coachingTrigger.prompt_context}` : ''}

Antworte im JSON-Format (kein Markdown, kein Code-Block):
{
  "summary": "2-3 Sätze persönliches Feedback (${coachTone} Tonfall, Modus: ${coachingMode})",
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
      // Use focus skills from coaching trigger for plan
      if (coachingTrigger?.focus_skills?.length > 0) {
        aiPlan = coachingTrigger.focus_skills.slice(0, 3).map((s: any) => 
          `${s.kompetenz} (LF ${s.lernfeld}) gezielt wiederholen`
        );
      } else {
        aiPlan = weakLFs.slice(0, 3).map(([code]: [string, any]) => `Lernfeld ${code} gezielt wiederholen`);
      }
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

    // Store feedback with coaching mode
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

    logStep("Feedback generated", { id: feedback.id, tone: coachTone, mode: coachingMode });

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
