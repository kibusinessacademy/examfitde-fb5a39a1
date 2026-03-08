import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { limit = 2, run_factory = false } = await req.json().catch(() => ({}));

    // Step 1: Promote wave candidates
    const { data: promoted, error: promoteErr } = await sb.rpc("promote_wave_candidates_to_factory", {
      p_limit: limit,
    });
    if (promoteErr) throw promoteErr;

    const result: Record<string, unknown> = { promoted };

    // Step 2: Optionally trigger autonomous factory
    if (run_factory) {
      try {
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const res = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/admin-run-autonomous-factory`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-job-runner-key": serviceKey,
            },
            body: JSON.stringify({}),
          },
        );
        result.factory = await res.json().catch(() => ({ status: res.status }));
      } catch (e) {
        result.factory = { error: String(e) };
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
