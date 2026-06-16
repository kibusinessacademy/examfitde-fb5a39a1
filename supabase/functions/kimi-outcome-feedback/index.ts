// KIMI.INTELLIGENCE.2 — Continuous Outcome Feedback Ingest + Decay
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const ingest = await supabase.rpc("admin_ingest_qil_outcome_feedback");
    if (ingest.error) throw ingest.error;
    const decay = await supabase.rpc("admin_apply_confidence_decay");
    if (decay.error) throw decay.error;
    return new Response(JSON.stringify({ ok: true, ingest: ingest.data, decay: decay.data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[kimi-outcome-feedback] error", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
