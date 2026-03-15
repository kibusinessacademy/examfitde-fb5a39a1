/**
 * knowledge-graph-query-test — Test endpoint for validating graph query layer.
 * POST { blueprint_id: string } or { competency_id: string }
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getGraphContextForBlueprint, getGraphContextForCompetency } from "../_shared/knowledge-graph/query.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));

  let result;
  if (body.blueprint_id) {
    result = await getGraphContextForBlueprint(sb, body.blueprint_id);
  } else if (body.competency_id) {
    result = await getGraphContextForCompetency(sb, body.competency_id);
  } else {
    return new Response(JSON.stringify({ error: "Provide blueprint_id or competency_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(result, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
