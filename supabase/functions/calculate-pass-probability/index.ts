import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const { user_id, curriculum_id, self_assessment, email, source = "web" } = body;

    if (!curriculum_id && !self_assessment) {
      return new Response(JSON.stringify({ error: "curriculum_id or self_assessment required" }), { status: 400, headers });
    }

    // Calculate via RPC
    const { data: result, error } = await sb.rpc("fn_calculate_pass_probability", {
      p_user_id: user_id || null,
      p_curriculum_id: curriculum_id || null,
      p_self_assessment: self_assessment || {},
    });

    if (error) throw error;

    // Store session for lead capture
    if (email || user_id) {
      await sb.from("pass_calculator_sessions").insert({
        user_id: user_id || null,
        email: email || null,
        curriculum_id: curriculum_id || null,
        inputs_json: self_assessment || {},
        result_json: result,
        pass_probability: result?.pass_probability,
        recommendation: result?.recommendation,
        source,
      });
    }

    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (error) {
    console.error("[calculate-pass-probability] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers }
    );
  }
});
