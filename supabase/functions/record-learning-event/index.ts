import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * record-learning-event
 * 
 * Lightweight telemetry ingress for learning events.
 * Records lesson starts/completions, minicheck results,
 * exam sim events, tutor interactions etc.
 */

const VALID_EVENT_TYPES = new Set([
  'lesson_started',
  'lesson_completed',
  'minicheck_started',
  'minicheck_completed',
  'question_answered',
  'exam_sim_started',
  'exam_sim_completed',
  'tutor_interaction',
  'recommendation_clicked',
  'spaced_repetition_review',
]);

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

    const body = await req.json();
    const {
      event_type,
      course_id,
      curriculum_id,
      lesson_id,
      competency_id,
      event_source = 'client',
      duration_seconds,
      score,
      payload = {},
    } = body;

    if (!event_type || !VALID_EVENT_TYPES.has(event_type)) {
      return new Response(JSON.stringify({ error: "Invalid event_type" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role for insert to bypass RLS (we validated user above)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error: insertError } = await serviceClient
      .from('learning_events')
      .insert({
        user_id: user.id,
        event_type,
        event_source,
        course_id: course_id || null,
        curriculum_id: curriculum_id || null,
        lesson_id: lesson_id || null,
        competency_id: competency_id || null,
        duration_seconds: duration_seconds || null,
        score: score ?? null,
        payload,
      });

    if (insertError) throw insertError;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[record-learning-event] Error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
