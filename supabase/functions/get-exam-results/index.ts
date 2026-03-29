// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { forbiddenResponse, unauthorizedResponse, validateAuth } from "../_shared/auth.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GET-EXAM-RESULTS] ${step}`, details ? JSON.stringify(details) : "");
};

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

    // Entitlement check (Phase 3: product-based)
    const { data: hasAccess } = await admin.rpc("check_product_access_by_curriculum", {
      p_user_id: auth.user.id,
      p_curriculum_id: session.curriculum_id,
      p_feature: "exam_trainer",
    });

    if (!hasAccess) {
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

    // ─── Build session-specific diagnostic from this session's questions ───
    const sessionBreakdownBySkill: Record<string, { correct: number; total: number; kompetenz: string; lernfeld: string }> = {};
    const breakdownData = session.breakdown as any;
    if (breakdownData?.by_skill_node) {
      for (const [skillId, data] of Object.entries(breakdownData.by_skill_node as Record<string, any>)) {
        sessionBreakdownBySkill[skillId] = {
          correct: data.correct || 0,
          total: data.total || 0,
          kompetenz: data.kompetenz || '',
          lernfeld: data.lernfeld || '',
        };
      }
    }

    // ─── DIAGNOSTIC: Dual-layer — session + global mastery ───
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

        // Build skill-level diagnostic (global mastery)
        const skillDiagnostics = skills.map((s: any) => {
          const sc = scoreMap.get(s.id);
          const sessionData = sessionBreakdownBySkill[s.id];
          return {
            skill_node_id: s.id,
            lernfeld: s.lernfeld,
            kompetenz: s.kompetenz,
            // Global mastery
            mastery_pct: sc?.decay_adjusted_mastery || sc?.mastery_pct || 0,
            confidence: sc?.confidence || 0,
            mastery_status: sc?.mastery_status || 'not_mastered',
            trend: sc?.trend || 'stable',
            total_attempts: (sc?.attempts || 0) + (sc?.minicheck_attempts || 0),
            // Session-specific performance
            session_correct: sessionData?.correct ?? null,
            session_total: sessionData?.total ?? null,
            session_accuracy: sessionData ? (sessionData.total > 0 ? Math.round(sessionData.correct / sessionData.total * 100 * 10) / 10 : 0) : null,
          };
        });

        // Session-specific weakest (from THIS session only)
        const sessionSkills = skillDiagnostics.filter(s => s.session_total !== null && s.session_total > 0);
        const sessionWeakest = [...sessionSkills]
          .sort((a, b) => (a.session_accuracy ?? 100) - (b.session_accuracy ?? 100))
          .filter(s => (s.session_accuracy ?? 100) < 70)
          .slice(0, 5);

        // Global weakest and strongest
        const sortedByMastery = [...skillDiagnostics].sort((a, b) => a.mastery_pct - b.mastery_pct);
        const globalWeakest = sortedByMastery.filter(s => s.mastery_pct < 60).slice(0, 5);
        const globalStrongest = [...skillDiagnostics]
          .sort((a, b) => b.mastery_pct - a.mastery_pct)
          .filter(s => s.mastery_pct >= 80)
          .slice(0, 5);

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

        // ─── Smarter coaching mode ───
        const sessionScore = session.score_percentage ?? 0;
        const sessionPassed = session.passed ?? false;
        let coachingMode: string;
        if (avgMastery < 40 && avgConfidence < 0.4) {
          coachingMode = 'explainer';
        } else if (avgMastery < 40) {
          coachingMode = 'coach';
        } else if (avgMastery < 70) {
          coachingMode = sessionPassed ? 'examiner' : 'coach';
        } else if (!sessionPassed || sessionWeakest.length > 0) {
          coachingMode = 'examiner';
        } else {
          coachingMode = 'examiner';
        }

        // ─── Prioritized recommendations ───
        const recommendations: Array<{ priority: string; text: string }> = [];
        
        // Critical
        if (sessionWeakest.length > 0) {
          recommendations.push({
            priority: 'critical',
            text: `In dieser Prüfung schwach: ${sessionWeakest.slice(0, 3).map(w => w.kompetenz).join(', ')}`,
          });
        }
        if (globalWeakest.length > 0) {
          recommendations.push({
            priority: 'critical',
            text: `Langfristig schwach: ${globalWeakest.slice(0, 3).map(w => `${w.kompetenz} (${w.mastery_pct.toFixed(0)}%)`).join(', ')}`,
          });
        }

        // Recommended
        const lowConfSkills = skillDiagnostics.filter(s => s.confidence < 0.3 && s.total_attempts < 5);
        if (lowConfSkills.length > 0) {
          recommendations.push({
            priority: 'recommended',
            text: `Noch zu wenig Daten für ${lowConfSkills.length} Kompetenzen — trainiere mehr.`,
          });
        }

        // Next steps
        if (avgMastery >= 80) {
          recommendations.push({ priority: 'next_step', text: 'Du bist prüfungsreif! Fokus auf Zeitmanagement und Wiederholung.' });
        } else if (avgMastery >= 60) {
          recommendations.push({ priority: 'next_step', text: 'Fast geschafft! Arbeite die schwachen Lernfelder gezielt durch.' });
        } else {
          recommendations.push({ priority: 'next_step', text: 'Nutze den adaptiven Trainer, um deine Schwächen systematisch zu bearbeiten.' });
        }

        // Tutor coaching payload
        const focusSkills = (sessionWeakest.length > 0 ? sessionWeakest : globalWeakest).slice(0, 3);
        const coachingTrigger = {
          mode: coachingMode,
          focus_skills: focusSkills.map(w => ({
            skill_node_id: w.skill_node_id,
            kompetenz: w.kompetenz,
            lernfeld: w.lernfeld,
            mastery_pct: w.mastery_pct,
            session_accuracy: w.session_accuracy,
          })),
          session_score: sessionScore,
          passed: sessionPassed,
          readiness_verdict: readinessVerdict,
          prompt_context: focusSkills.length > 0
            ? `Der Lernende hat ${sessionScore.toFixed(1)}% erreicht (${sessionPassed ? 'bestanden' : 'nicht bestanden'}). ` +
              `Session-Schwächen: ${sessionWeakest.slice(0, 3).map(w => `${w.kompetenz} (${w.session_accuracy}%)`).join(', ')}. ` +
              `Langfrist-Schwächen: ${globalWeakest.slice(0, 3).map(w => `${w.kompetenz} (${w.mastery_pct.toFixed(0)}%)`).join(', ')}. ` +
              `Prüfungsreife: ${readinessVerdict}. Confidence: ${(avgConfidence * 100).toFixed(0)}%.`
            : `Der Lernende hat ${sessionScore.toFixed(1)}% erreicht. Noch keine detaillierten Kompetenzdaten vorhanden.`,
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
          // Dual-layer: session vs global
          session_weakest_skills: sessionWeakest.map(s => ({
            skill_node_id: s.skill_node_id, lernfeld: s.lernfeld, kompetenz: s.kompetenz,
            session_accuracy: s.session_accuracy, session_correct: s.session_correct, session_total: s.session_total,
            mastery_pct: s.mastery_pct, trend: s.trend,
          })),
          weakest_skills: globalWeakest.map(s => ({
            skill_node_id: s.skill_node_id, lernfeld: s.lernfeld, kompetenz: s.kompetenz,
            mastery_pct: s.mastery_pct, confidence: s.confidence, mastery_status: s.mastery_status, trend: s.trend,
            total_attempts: s.total_attempts,
          })),
          strongest_skills: globalStrongest.map(s => ({
            skill_node_id: s.skill_node_id, kompetenz: s.kompetenz, mastery_pct: s.mastery_pct,
          })),
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
