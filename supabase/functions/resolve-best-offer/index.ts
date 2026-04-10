import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * resolve-best-offer
 * Learner-facing: resolves the best offer for the current user.
 * Also computes urgency and next revenue action.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "unauthorized" });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) return json(401, { error: "unauthorized" });

    const body = await req.json().catch(() => ({}));
    const curriculumId = body.curriculum_id ?? null;

    // Use service role for RPCs
    const sbService = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parallel: best offer + next action + urgency
    const [offerResult, actionResult, urgencyResult] = await Promise.all([
      sbService.rpc("fn_get_best_offer", { p_user_id: user.id, p_curriculum_id: curriculumId }),
      sbService.rpc("fn_get_next_revenue_action", { p_user_id: user.id, p_curriculum_id: curriculumId }),
      sbService.rpc("fn_compute_urgency", { p_user_id: user.id }),
    ]);

    return json(200, {
      offer: offerResult.data,
      action: actionResult.data,
      urgency: urgencyResult.data,
    });
  } catch (e) {
    console.error("resolve-best-offer error:", e);
    return json(500, { error: e instanceof Error ? e.message : "unknown" });
  }

  function json(status: number, data: any) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
