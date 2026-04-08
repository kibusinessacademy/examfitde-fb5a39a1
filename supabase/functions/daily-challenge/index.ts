import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

/**
 * Daily Challenge Engine — 3-5 deterministic questions per day with streak tracking.
 * 
 * POST /daily-challenge
 * Actions:
 *   - get:    Get or create today's challenge
 *   - submit: Submit answer for a question
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
    const { action, curriculum_id, challenge_id, question_id, selected_index } = body;

    if (!action) return json(400, { error: "Missing action" }, origin);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── GET (or create) today's challenge ──
    if (action === "get") {
      if (!curriculum_id) return json(400, { error: "Missing curriculum_id" }, origin);

      const { data, error } = await serviceClient.rpc("get_daily_challenge", {
        p_user_id: user.id,
        p_curriculum_id: curriculum_id,
      });

      if (error) throw error;
      if (data?.error) return json(400, data, origin);

      return json(200, data, origin);
    }

    // ── SUBMIT answer ──
    if (action === "submit") {
      if (!challenge_id || !question_id || selected_index === undefined) {
        return json(400, { error: "Missing challenge_id, question_id, or selected_index" }, origin);
      }

      const { data, error } = await serviceClient.rpc("submit_daily_challenge_answer", {
        p_user_id: user.id,
        p_challenge_id: challenge_id,
        p_question_id: question_id,
        p_selected_index: selected_index,
      });

      if (error) throw error;
      if (data?.error) return json(400, data, origin);

      return json(200, data, origin);
    }

    return json(400, { error: `Unknown action: ${action}` }, origin);
  } catch (e) {
    console.error("[daily-challenge]", e);
    return json(500, { error: (e as Error).message }, req.headers.get("origin"));
  }
});
