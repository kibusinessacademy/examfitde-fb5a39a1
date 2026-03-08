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

async function openAlert(sb: any, key: string, severity: string, title: string, message: string, payload: any) {
  await sb.rpc("upsert_control_plane_alert", {
    p_alert_key: key,
    p_severity: severity,
    p_source_layer: "control",
    p_source_ref: null,
    p_title: title,
    p_message: message,
    p_payload: payload,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await sb.rpc("run_scheduler_governance_audit");
  if (error) return json(500, { error: error.message });

  const audit = data || {};
  const alerts: string[] = [];

  if (Number(audit.stale_leases || 0) > 0) {
    await openAlert(sb, "scheduler_stale_leases", "critical", "Stale execution leases detected", `${audit.stale_leases} stale leases found`, audit);
    alerts.push("scheduler_stale_leases");
  }

  if (Number(audit.running_crons || 0) > 5) {
    await openAlert(sb, "scheduler_running_crons_high", "warn", "Too many running crons", `${audit.running_crons} running cron executions detected`, audit);
    alerts.push("scheduler_running_crons_high");
  }

  if (Number(audit.failed_jobs_1h || 0) > 75) {
    await openAlert(sb, "scheduler_failed_jobs_high", "critical", "High failed jobs in last hour", `${audit.failed_jobs_1h} failed jobs in last hour`, audit);
    alerts.push("scheduler_failed_jobs_high");
  }

  return json(200, { ok: audit.ok === true, audit, alerts });
});
