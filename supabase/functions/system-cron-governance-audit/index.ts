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

  // --- Scheduler health checks ---
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

  // --- Phantom-Done Governance Audit ---
  const { data: phantomSteps, error: e1 } = await sb
    .from("ops_phantom_done_governance")
    .select("package_id, course_title, package_status, step_key, meta_ok, gate_passed");
  if (e1) console.error("phantom_done_governance query failed:", e1.message);

  const phantomRows = phantomSteps || [];
  const phantomNonPublished = phantomRows.filter((r: any) => r.package_status !== "published");
  const phantomPublished = phantomRows.filter((r: any) => r.package_status === "published");

  if (phantomNonPublished.length > 0) {
    await openAlert(
      sb,
      "phantom_done_governance_active",
      "critical",
      "Phantom-Done Governance Steps (non-published)",
      `${phantomNonPublished.length} governance step(s) marked done without gate approval on active packages`,
      { count: phantomNonPublished.length, steps: phantomNonPublished.slice(0, 20) },
    );
    alerts.push("phantom_done_governance_active");
  }

  if (phantomPublished.length > 0) {
    await openAlert(
      sb,
      "phantom_done_governance_published",
      "warn",
      "Phantom-Done Governance Steps (published legacy)",
      `${phantomPublished.length} governance step(s) on published packages — known legacy`,
      { count: phantomPublished.length, steps: phantomPublished.slice(0, 20) },
    );
    alerts.push("phantom_done_governance_published");
  }

  // --- Phantom Council Approvals Audit ---
  const { data: phantomCouncil, error: e2 } = await sb
    .from("ops_phantom_council_approvals")
    .select("package_id, course_title, package_status, session_count");
  if (e2) console.error("phantom_council_approvals query failed:", e2.message);

  const councilRows = phantomCouncil || [];
  if (councilRows.length > 0) {
    await openAlert(
      sb,
      "phantom_council_approvals",
      "critical",
      "Council Approvals without session evidence",
      `${councilRows.length} package(s) with council_approved=true but 0 sessions`,
      { count: councilRows.length, packages: councilRows.slice(0, 20) },
    );
    alerts.push("phantom_council_approvals");
  }

  const allOk = audit.ok === true && phantomNonPublished.length === 0 && councilRows.length === 0;

  return json(200, {
    ok: allOk,
    audit,
    phantom_done: { non_published: phantomNonPublished.length, published: phantomPublished.length },
    phantom_council: councilRows.length,
    alerts,
  });
});
