import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const today = new Date().toISOString().slice(0, 10);

  const { data: caps, error } = await sb
    .from("executive_budget_caps")
    .select("*")
    .eq("is_enabled", true);

  if (error) return json(500, { error: error.message });

  const { data: costSignals } = await sb
    .from("control_plane_cost_signals")
    .select("*")
    .eq("signal_date", today);

  const results: any[] = [];

  for (const cap of caps || []) {
    let current = 0;

    if (cap.scope_type === "global") {
      current = (costSignals || []).reduce((sum: number, r: any) => sum + Number(r.metric_value || 0), 0);
    } else if (cap.scope_type === "layer") {
      current = (costSignals || [])
        .filter((r: any) => r.layer_key === cap.scope_ref)
        .reduce((sum: number, r: any) => sum + Number(r.metric_value || 0), 0);
    }

    const ratio = cap.budget_limit > 0 ? current / Number(cap.budget_limit) : 0;
    let status = "ok";

    if (ratio >= Number(cap.critical_threshold || 1)) {
      status = "critical";

      await sb.from("executive_portfolio_decisions").insert({
        decision_scope: cap.scope_type === "global" ? "portfolio" : "layer",
        decision_type: "throttle_layer",
        decision_status: "queued",
        priority: 10,
        reason: `Budget critical: ${cap.cap_key}`,
        payload: { cap_key: cap.cap_key, current, budget_limit: cap.budget_limit, ratio },
      });
    } else if (ratio >= Number(cap.warning_threshold || 0.8)) {
      status = "warning";

      await sb.rpc("upsert_control_plane_alert", {
        p_alert_key: `budget_${cap.cap_key}`,
        p_severity: "warn",
        p_source_layer: "finance",
        p_source_ref: cap.scope_ref,
        p_title: `Budget warning: ${cap.cap_key}`,
        p_message: `${current.toFixed(2)} / ${cap.budget_limit}`,
        p_payload: { ratio, current, budget_limit: cap.budget_limit },
      });
    }

    results.push({ cap_key: cap.cap_key, current, budget_limit: cap.budget_limit, ratio, status });
  }

  return json(200, { ok: true, results });
});
