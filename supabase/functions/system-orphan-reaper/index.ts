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

async function logOrphan(sb: any, orphanType: string, objectRef: string, severity: string, message: string, payload: any) {
  await sb.from("system_orphan_executions").insert({
    orphan_type: orphanType,
    object_ref: objectRef,
    severity,
    message,
    payload,
    status: "open",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let releasedLeases = 0;
  let staleCrons = 0;

  // 1. Expire stale leases
  const { data: expiredLeases } = await sb
    .from("system_execution_leases")
    .select("*")
    .eq("status", "active")
    .lt("lease_until", new Date().toISOString())
    .limit(200);

  for (const lease of expiredLeases || []) {
    await sb.from("system_execution_leases").update({
      status: "expired",
      updated_at: new Date().toISOString(),
      released_at: new Date().toISOString(),
    }).eq("id", lease.id);

    await logOrphan(sb, "stale_lease", lease.lease_key, "critical", `Expired lease ${lease.lease_key}`, {
      lease_scope: lease.lease_scope,
      owner_key: lease.owner_key,
    });

    releasedLeases++;
  }

  // 2. Mark stale cron executions
  const staleBoundary = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: runningCrons } = await sb
    .from("system_cron_executions")
    .select("*")
    .eq("status", "running")
    .lt("started_at", staleBoundary)
    .limit(100);

  for (const cron of runningCrons || []) {
    await sb.from("system_cron_executions").update({
      status: "stale",
      finished_at: new Date().toISOString(),
      error_message: "Marked stale by orphan reaper",
    }).eq("id", cron.id);

    await logOrphan(sb, "stale_cron", cron.execution_key, "warn", `Stale cron execution ${cron.cron_key}`, {
      cron_key: cron.cron_key,
      started_at: cron.started_at,
    });

    staleCrons++;
  }

  return json(200, {
    ok: true,
    released_leases: releasedLeases,
    stale_crons: staleCrons,
  });
});
