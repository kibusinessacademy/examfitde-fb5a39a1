import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const [scoreRes, latencyRes, stuckRes, contentRes, funnelRes, errorRes] = await Promise.all([
      sb.rpc("pipeline_health_score"),
      sb.from("v_pipeline_queue_latency").select("*"),
      sb.from("v_pipeline_stuck_processing").select("*"),
      sb.from("v_pipeline_content_integrity").select("*").order("priority", { ascending: true }).limit(20),
      sb.from("v_pipeline_step_funnel").select("*").limit(50),
      sb.from("v_pipeline_error_class").select("*"),
    ]);

    return json({
      score: scoreRes.data,
      queue_latency: latencyRes.data ?? [],
      stuck_processing: stuckRes.data ?? [],
      content_integrity: contentRes.data ?? [],
      step_funnel: funnelRes.data ?? [],
      error_class: errorRes.data ?? [],
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
