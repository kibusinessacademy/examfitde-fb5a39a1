import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // DEPRECATED runner: keep endpoint for old UI/cron callers,
  // but delegate to pipeline-runner to avoid a second competing pipeline.
  const { data, error } = await sb.functions.invoke("pipeline-runner", { body: { trigger: "package-queue-next" } });
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, delegated: true, result: data ?? null });
});
