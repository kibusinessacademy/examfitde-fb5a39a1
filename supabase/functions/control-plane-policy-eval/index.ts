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

async function createAction(
  sb: any,
  actionType: string,
  reason: string,
  payload: any,
) {
  await sb.from("control_plane_actions").insert({
    action_type: actionType,
    action_scope: "global",
    status: "queued",
    reason,
    payload,
    executed_by: "control-plane-policy-eval",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: policies, error } = await sb
    .from("control_plane_policies")
    .select("*")
    .eq("is_enabled", true);

  if (error) return json(500, { error: error.message });

  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const results: any[] = [];

  for (const policy of policies || []) {
    if (policy.policy_key === "queue_failed_1h" || policy.policy_key === "queue_failed_critical_1h") {
      const { count } = await sb
        .from("job_queue")
        .select("id", { head: true, count: "exact" })
        .eq("status", "failed")
        .gte("updated_at", oneHourAgo);

      const current = Number(count || 0);
      const threshold = Number(policy.threshold_numeric || 0);

      if (current > threshold) {
        await sb.rpc("upsert_control_plane_alert", {
          p_alert_key: policy.policy_key,
          p_severity: policy.severity,
          p_source_layer: "production",
          p_source_ref: null,
          p_title: "Viele fehlgeschlagene Jobs in der letzten Stunde",
          p_message: `${current} failed jobs > threshold ${threshold}`,
          p_payload: { current, threshold },
        });

        if (policy.action_mode === "auto_throttle") {
          await createAction(sb, "auto_throttle", `${policy.policy_key} exceeded`, { current, threshold });
        }

        results.push({ policy_key: policy.policy_key, triggered: true, current, threshold });
      } else {
        await sb.rpc("resolve_control_plane_alerts_by_prefix", { p_alert_key_prefix: policy.policy_key });
        results.push({ policy_key: policy.policy_key, triggered: false, current, threshold });
      }
    }

    if (policy.policy_key === "optimization_action_backlog") {
      const { count } = await sb
        .from("optimization_actions")
        .select("id", { head: true, count: "exact" })
        .eq("status", "queued");

      const current = Number(count || 0);
      const threshold = Number(policy.threshold_numeric || 0);

      if (current > threshold) {
        await sb.rpc("upsert_control_plane_alert", {
          p_alert_key: "optimization_action_backlog",
          p_severity: policy.severity,
          p_source_layer: "optimization",
          p_source_ref: null,
          p_title: "Optimization backlog zu hoch",
          p_message: `${current} queued optimization actions > threshold ${threshold}`,
          p_payload: { current, threshold },
        });
        results.push({ policy_key: policy.policy_key, triggered: true, current, threshold });
      } else {
        await sb.rpc("resolve_control_plane_alerts_by_prefix", { p_alert_key_prefix: "optimization_action_backlog" });
        results.push({ policy_key: policy.policy_key, triggered: false, current, threshold });
      }
    }

    if (policy.policy_key === "wave_blocked_count") {
      const { count } = await sb
        .from("production_wave_items")
        .select("id", { head: true, count: "exact" })
        .eq("status", "blocked");

      const current = Number(count || 0);
      const threshold = Number(policy.threshold_numeric || 0);

      if (current > threshold) {
        await sb.rpc("upsert_control_plane_alert", {
          p_alert_key: "wave_blocked_count",
          p_severity: policy.severity,
          p_source_layer: "production",
          p_source_ref: null,
          p_title: "Zu viele blockierte Wave Items",
          p_message: `${current} blocked wave items > threshold ${threshold}`,
          p_payload: { current, threshold },
        });
        results.push({ policy_key: policy.policy_key, triggered: true, current, threshold });
      } else {
        await sb.rpc("resolve_control_plane_alerts_by_prefix", { p_alert_key_prefix: "wave_blocked_count" });
        results.push({ policy_key: policy.policy_key, triggered: false, current, threshold });
      }
    }

    if (policy.policy_key === "daily_cost_estimate") {
      const { data: costData } = await sb
        .from("ai_usage_log")
        .select("cost_eur")
        .gte("created_at", new Date().toISOString().slice(0, 10));

      const current = (costData || []).reduce((s: number, r: any) => s + Number(r.cost_eur || 0), 0);
      const threshold = Number(policy.threshold_numeric || 0);

      if (current > threshold) {
        await sb.rpc("upsert_control_plane_alert", {
          p_alert_key: "daily_cost_estimate",
          p_severity: policy.severity,
          p_source_layer: "finance",
          p_source_ref: null,
          p_title: "Tägliche KI-Kosten überschritten",
          p_message: `€${current.toFixed(2)} > threshold €${threshold}`,
          p_payload: { current, threshold },
        });

        if (policy.action_mode === "auto_throttle") {
          await createAction(sb, "auto_throttle", "daily_cost_estimate exceeded", { current, threshold });
        }

        results.push({ policy_key: policy.policy_key, triggered: true, current, threshold });
      } else {
        await sb.rpc("resolve_control_plane_alerts_by_prefix", { p_alert_key_prefix: "daily_cost_estimate" });
        results.push({ policy_key: policy.policy_key, triggered: false, current, threshold });
      }
    }
  }

  return json(200, { ok: true, results });
});
