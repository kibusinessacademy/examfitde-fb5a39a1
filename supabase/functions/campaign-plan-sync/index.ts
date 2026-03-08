import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Create run record
  const { data: run } = await sb
    .from("campaign_automation_runs")
    .insert({ run_type: "plan_sync", status: "running" })
    .select("id")
    .single();
  const runId = run?.id;

  const { data, error } = await sb.rpc("sync_campaign_launch_plans");

  if (error) {
    if (runId) await sb.from("campaign_automation_runs").update({ status: "failed", finished_at: new Date().toISOString(), meta: { error: error.message } }).eq("id", runId);
    return json(500, { error: error.message }, origin);
  }

  if (runId) {
    await sb.from("campaign_automation_runs").update({
      status: "done",
      processed_count: (data as any)?.synced ?? 0,
      updated_count: (data as any)?.synced ?? 0,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }

  return json(200, { ok: true, ...data }, origin);
});
