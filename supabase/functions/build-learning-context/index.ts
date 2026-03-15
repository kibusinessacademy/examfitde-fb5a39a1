import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * build-learning-context
 * 
 * Assembles a rich learning context JSON for the AI tutor.
 * Combines: readiness, weaknesses, recent activity, recommendations.
 * 
 * Called before tutor interactions to provide context-aware coaching.
 */

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightRequest(req, corsHeaders);
  if (preflight) return preflight;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { curriculum_id } = await req.json();
    if (!curriculum_id) {
      return new Response(JSON.stringify({ error: "curriculum_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parallel data fetching
    const [readinessRes, gapsRes, recsRes, recentEventsRes, recentExamRes] = await Promise.all([
      // Latest readiness
      supabase
        .from('v_user_current_readiness')
        .select('*')
        .eq('user_id', user.id)
        .eq('curriculum_id', curriculum_id)
        .maybeSingle(),

      // Top gaps
      supabase
        .from('v_user_top_gaps')
        .select('*')
        .eq('user_id', user.id)
        .eq('curriculum_id', curriculum_id)
        .order('weakness_score', { ascending: false })
        .limit(5),

      // Active recommendations
      supabase
        .from('v_user_active_recommendations')
        .select('*')
        .eq('user_id', user.id)
        .eq('curriculum_id', curriculum_id)
        .limit(3),

      // Recent learning events
      supabase
        .from('learning_events')
        .select('event_type, score, lesson_id, competency_id, created_at')
        .eq('user_id', user.id)
        .eq('curriculum_id', curriculum_id)
        .order('created_at', { ascending: false })
        .limit(10),

      // Last exam session
      supabase
        .from('exam_sessions')
        .select('id, score_percentage, passed, finished_at')
        .eq('user_id', user.id)
        .eq('curriculum_id', curriculum_id)
        .not('finished_at', 'is', null)
        .order('finished_at', { ascending: false })
        .limit(1),
    ]);

    const readiness = readinessRes.data;
    const gaps = gapsRes.data || [];
    const recommendations = recsRes.data || [];
    const recentEvents = recentEventsRes.data || [];
    const lastExam = recentExamRes.data?.[0] || null;

    // Build context object
    const context = {
      curriculum_id,
      readiness: readiness ? {
        score: readiness.readiness_score,
        risk_level: readiness.risk_level,
        confidence: readiness.confidence_score,
        mastered: readiness.mastered_count,
        partial: readiness.partial_count,
        not_mastered: readiness.not_mastered_count,
        calculated_at: readiness.calculated_at,
      } : null,

      top_gaps: gaps.map((g: Record<string, unknown>) => ({
        competency_id: g.competency_id,
        competency_code: g.competency_code,
        competency_title: g.competency_title,
        learning_field: `${g.learning_field_code}: ${g.learning_field_title}`,
        accuracy_pct: g.accuracy_pct,
        gap_type: g.gap_type,
        mastery_state: g.mastery_state,
      })),

      recommendations: recommendations.map((r: Record<string, unknown>) => ({
        type: r.recommendation_type,
        target_id: r.target_id,
        target_meta: r.target_meta,
        reason: r.reason_text,
        reason_code: r.reason_code,
      })),

      recent_activity: {
        events_count: recentEvents.length,
        last_event_type: recentEvents[0]?.event_type || null,
        recent_scores: recentEvents
          .filter((e: Record<string, unknown>) => e.score != null)
          .slice(0, 5)
          .map((e: Record<string, unknown>) => ({
            type: e.event_type,
            score: e.score,
            at: e.created_at,
          })),
      },

      last_exam: lastExam ? {
        score: lastExam.score_percentage,
        passed: lastExam.passed,
        at: lastExam.finished_at,
      } : null,

      // Coaching mode suggestion
      suggested_tutor_role: !readiness ? 'explainer'
        : readiness.readiness_score < 40 ? 'explainer'
        : readiness.readiness_score < 70 ? 'coach'
        : 'examiner',
    };

    return new Response(JSON.stringify(context), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[build-learning-context] Error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
