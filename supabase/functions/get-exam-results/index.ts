import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { forbiddenResponse, unauthorizedResponse, validateAuth } from "../_shared/auth.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GET-EXAM-RESULTS] ${step}`, details ? JSON.stringify(details) : "");
};

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

    const body = await req.json();
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

    // Load session + verify ownership
    const { data: session, error: sessionError } = await admin
      .from("exam_sessions")
      .select(`
        id, user_id, mode, total_questions, score_percentage, passed,
        started_at, finished_at, breakdown, curriculum_id,
        blueprint:exam_blueprints(title, pass_threshold),
        curriculum:curricula(title)
      `)
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

    if (!session.finished_at) {
      return new Response(JSON.stringify({ error: "Session not finished" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Entitlement check
    const { data: entitlement } = await admin.rpc("check_user_entitlement", {
      p_user_id: auth.user.id,
      p_curriculum_id: session.curriculum_id,
      p_feature: "exam_trainer",
    });

    if (!entitlement) {
      return forbiddenResponse("Access denied - no exam_trainer entitlement", origin || undefined);
    }

    // Load questions
    const { data: qs } = await admin
      .from("exam_session_questions")
      .select(`
        id, order_index, is_correct, user_answer, difficulty,
        learning_field_code, competency_code,
        question:exam_questions(question_text, options, correct_answer, explanation)
      `)
      .eq("exam_session_id", sessionId)
      .order("order_index");

    const questions = (qs || []).map((row: any) => {
      const options = Array.isArray(row?.question?.options) ? row.question.options : [];
      return {
        ...row,
        question: {
          ...row.question,
          options: options.map((t: string) => ({ text: String(t) })),
        },
      };
    });

    // ─── DIAGNOSTIC: Mastery-enriched analysis ───
    let diagnostic = null;
    try {
      const curriculumId = session.curriculum_id;
      const userId = auth.user.id;

      // Fetch skill scores for this curriculum
      const { data: skills } = await admin
        .from("skill_nodes")
        .select("id, lernfeld, kompetenz, mikro_skill")
        .eq("curriculum_id", curriculumId);

      if (skills?.length) {
        const skillIds = skills.map((s: any) => s.id);
        const { data: scores } = await admin
          .from("user_skill_scores")
          .select("skill_node_id, decay_adjusted_mastery, mastery_pct, confidence, mastery_status, trend, exam_score, minicheck_score, attempts, minicheck_attempts")
          .eq("user_id", userId)
          .in("skill_node_id", skillIds);

        const scoreMap = new Map((scores || []).map((sc: any) => [sc.skill_node_id, sc]));

        // Build skill-level diagnostic
        const skillDiagnostics = skills.map((s: any) => {
          const sc = scoreMap.get(s.id);
          return {
            skill_node_id: s.id,
            lernfeld: s.lernfeld,
            kompetenz: s.kompetenz,
            mastery_pct: sc?.decay_adjusted_mastery || sc?.mastery_pct || 0,
            confidence: sc?.confidence || 0,
            mastery_status: sc?.mastery_status || 'not_mastered',
            trend: sc?.trend || 'stable',
            total_attempts: (sc?.attempts || 0) + (sc?.minicheck_attempts || 0),
          };
        });

        // Weakest and strongest skills
        const sorted = [...skillDiagnostics].sort((a, b) => a.mastery_pct - b.mastery_pct);
        const weakest = sorted.filter(s => s.mastery_pct < 60).slice(0, 5);
        const strongest = sorted.filter(s => s.mastery_pct >= 80).reverse().slice(0, 5);

        // Overall readiness
        const avgMastery = skillDiagnostics.length > 0
          ? skillDiagnostics.reduce((s, d) => s + d.mastery_pct, 0) / skillDiagnostics.length
          : 0;
        const avgConfidence = skillDiagnostics.length > 0
          ? skillDiagnostics.reduce((s, d) => s + d.confidence, 0) / skillDiagnostics.length
          : 0;

        const failRiskRaw = 100 - avgMastery;
        const failRisk = Math.min(100, Math.round(failRiskRaw * (1 + (1 - avgConfidence) * 0.3) * 10) / 10);

        const readinessVerdict = avgMastery >= 80 ? 'exam_ready'
          : avgMastery >= 60 ? 'almost_ready'
          : avgMastery >= 40 ? 'needs_work'
          : 'not_ready';

        // Recommended next steps
        const recommendations: string[] = [];
        if (weakest.length > 0) {
          recommendations.push(`Fokussiere dich auf: ${weakest.slice(0, 3).map(w => w.kompetenz).join(', ')}`);
        }
        const lowConfSkills = skillDiagnostics.filter(s => s.confidence < 0.3 && s.total_attempts < 5);
        if (lowConfSkills.length > 0) {
          recommendations.push(`Noch zu wenig Daten für ${lowConfSkills.length} Kompetenzen — trainiere mehr.`);
        }
        if (avgMastery >= 80) {
          recommendations.push('Du bist prüfungsreif! Fokus auf Zeitmanagement und Wiederholung.');
        } else if (avgMastery >= 60) {
          recommendations.push('Fast geschafft! Arbeite die schwachen Lernfelder gezielt durch.');
        } else {
          recommendations.push('Nutze den adaptiven Trainer, um deine Schwächen systematisch zu bearbeiten.');
        }

        // Tutor coaching payload
        const coachingTrigger = {
          mode: avgMastery < 40 ? 'explainer' : avgMastery < 70 ? 'coach' : 'examiner',
          focus_skills: weakest.slice(0, 3).map(w => ({
            skill_node_id: w.skill_node_id,
            kompetenz: w.kompetenz,
            lernfeld: w.lernfeld,
            mastery_pct: w.mastery_pct,
          })),
          session_score: session.score_percentage,
          passed: session.passed,
          readiness_verdict: readinessVerdict,
          prompt_context: weakest.length > 0
            ? `Der Lernende hat ${session.score_percentage?.toFixed(1)}% erreicht (${session.passed ? 'bestanden' : 'nicht bestanden'}). ` +
              `Schwächste Bereiche: ${weakest.slice(0, 3).map(w => `${w.kompetenz} (${w.mastery_pct.toFixed(0)}%)`).join(', ')}. ` +
              `Prüfungsreife: ${readinessVerdict}. Confidence: ${(avgConfidence * 100).toFixed(0)}%.`
            : `Der Lernende hat ${session.score_percentage?.toFixed(1)}% erreicht. Noch keine detaillierten Kompetenzdaten vorhanden.`,
        };

        diagnostic = {
          readiness_pct: Math.round(avgMastery * 10) / 10,
          confidence: Math.round(avgConfidence * 100) / 100,
          fail_risk_pct: failRisk,
          verdict: readinessVerdict,
          total_skills: skillDiagnostics.length,
          mastered_count: skillDiagnostics.filter(s => s.mastery_status === 'mastered').length,
          partial_count: skillDiagnostics.filter(s => s.mastery_status === 'partial').length,
          not_mastered_count: skillDiagnostics.filter(s => s.mastery_status === 'not_mastered').length,
          weakest_skills: weakest,
          strongest_skills: strongest,
          recommendations,
          coaching_trigger: coachingTrigger,
        };
      }
    } catch (diagErr) {
      logStep("Diagnostic error (non-blocking)", { error: String(diagErr) });
    }

    return new Response(JSON.stringify({
      session,
      questions,
      diagnostic,
    }), {
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
