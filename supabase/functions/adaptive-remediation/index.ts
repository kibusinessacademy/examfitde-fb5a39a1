import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[ADAPTIVE-REMEDIATION] ${step}`, details ? JSON.stringify(details) : '');
};

/**
 * Adaptive Remediation Engine
 * 
 * Actions:
 * - "generate": Analyze exam session errors → build targeted training set
 * - "complete": Mark remediation as done, track score improvement
 */

interface RequestBody {
  action: 'generate' | 'complete';
  session_id?: string;       // source exam session (for generate)
  remediation_id?: string;   // (for complete)
  score_after?: number;      // (for complete)
}

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

    const admin = createClient(supabaseUrl, supabaseServiceKey);
    const body: RequestBody = await req.json();

    // ── ACTION: GENERATE ──
    if (body.action === 'generate') {
      const { session_id } = body;
      if (!session_id) {
        return new Response(JSON.stringify({ error: "session_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 1. Load session + verify ownership
      const { data: session } = await admin
        .from('exam_sessions')
        .select('id, user_id, curriculum_id, score_percentage, finished_at')
        .eq('id', session_id)
        .single();

      if (!session || session.user_id !== user.id || !session.finished_at) {
        return new Response(JSON.stringify({ error: "Session not found or not finished" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 2. Load wrong answers with competency info
      const { data: wrongAnswers } = await admin
        .from('exam_session_questions')
        .select('question_id, competency_code, learning_field_code, difficulty')
        .eq('exam_session_id', session_id)
        .eq('is_correct', false);

      if (!wrongAnswers?.length) {
        return new Response(JSON.stringify({ 
          message: "Keine Fehler gefunden – keine Remediation nötig!",
          remediation: null,
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 3. Cluster errors by competency
      const compClusters: Record<string, { count: number; question_ids: string[] }> = {};
      for (const wa of wrongAnswers) {
        const key = wa.competency_code || wa.learning_field_code || 'unknown';
        if (!compClusters[key]) compClusters[key] = { count: 0, question_ids: [] };
        compClusters[key].count++;
        compClusters[key].question_ids.push(wa.question_id);
      }

      // Sort by error count desc → top 5 weak areas
      const weakCompetencies = Object.entries(compClusters)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)
        .map(([code, data]) => ({ code, errors: data.count, source_question_ids: data.question_ids }));

      logStep("Weak competencies identified", { count: weakCompetencies.length });

      // 4. For each weak competency, fetch 2-3 targeted training questions
      const trainingQuestions: any[] = [];
      const excludeIds = wrongAnswers.map(w => w.question_id);

      for (const wc of weakCompetencies) {
        // Find competencies matching this code
        const { data: comps } = await admin
          .from('competencies')
          .select('id')
          .eq('code', wc.code)
          .limit(10);

        const compIds = (comps || []).map(c => c.id);
        if (!compIds.length) continue;

        const { data: questions } = await admin
          .from('v_exam_questions_approved')
          .select('id, question_text, options, difficulty, competency_id')
          .in('competency_id', compIds)
          .not('id', 'in', `(${excludeIds.join(',')})`)
          .limit(12);

        if (!questions?.length) continue;

        // Pick 2-3 random from pool
        const shuffled = questions.sort(() => Math.random() - 0.5).slice(0, 3);
        for (const q of shuffled) {
          trainingQuestions.push({
            id: q.id,
            question_text: q.question_text,
            options: q.options,
            difficulty: q.difficulty,
            competency_code: wc.code,
            source: 'remediation',
          });
          excludeIds.push(q.id);
        }
      }

      // 5. Store remediation session
      const { data: remediation, error: remError } = await admin
        .from('remediation_sessions')
        .insert({
          user_id: user.id,
          curriculum_id: session.curriculum_id,
          source_session_id: session_id,
          weak_competencies: weakCompetencies,
          training_questions: trainingQuestions.map(q => q.id),
          score_before: session.score_percentage,
          status: 'active',
        })
        .select()
        .single();

      if (remError) throw remError;

      logStep("Remediation created", { id: remediation.id, questions: trainingQuestions.length });

      return new Response(JSON.stringify({
        remediation: {
          id: remediation.id,
          weak_competencies: weakCompetencies,
          training_questions: trainingQuestions,
          score_before: session.score_percentage,
        },
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: COMPLETE ──
    if (body.action === 'complete') {
      const { remediation_id, score_after } = body;
      if (!remediation_id) {
        return new Response(JSON.stringify({ error: "remediation_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await admin
        .from('remediation_sessions')
        .update({
          status: 'completed',
          score_after: score_after ?? null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', remediation_id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ remediation: data }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" },
    });
  }
});
