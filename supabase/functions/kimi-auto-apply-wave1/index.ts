// KIMI.INTELLIGENCE.1b — Auto-Apply Wave-1 cron worker.
// Calls the policy-gated RPC; never publishes, approves questions, or prices.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  let triggered_by = "cron";
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({} as any));
      if (typeof body?.triggered_by === "string") triggered_by = body.triggered_by;
    }
  } catch (_) { /* ignore */ }

  const { data, error } = await sb.rpc(
    "admin_auto_apply_quality_intelligence_wave1",
    { p_triggered_by: triggered_by },
  );

  if (error) {
    console.error("[kimi-auto-apply-wave1] rpc error", error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  console.log("[kimi-auto-apply-wave1] result", data);
  return new Response(
    JSON.stringify({ ok: true, result: data }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
