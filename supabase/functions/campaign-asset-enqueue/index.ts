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

  const body = await req.json().catch(() => ({}));
  const launchPlanId = body.launch_plan_id || null;

  // Create run record
  const { data: run } = await sb
    .from("campaign_automation_runs")
    .insert({ run_type: "enqueue", status: "running" })
    .select("id")
    .single();
  const runId = run?.id;

  if (launchPlanId) {
    const { data, error } = await sb.rpc("enqueue_campaign_assets_from_plan", {
      p_launch_plan_id: launchPlanId,
    });
    if (error) {
      if (runId) await sb.from("campaign_automation_runs").update({ status: "failed", finished_at: new Date().toISOString(), meta: { error: error.message } }).eq("id", runId);
      return json(500, { error: error.message }, origin);
    }
    if (runId) await sb.from("campaign_automation_runs").update({ status: "done", processed_count: 1, created_count: (data as any)?.enqueued_assets ?? 0, finished_at: new Date().toISOString() }).eq("id", runId);
    return json(200, { ok: true, ...data }, origin);
  }

  // Batch: enqueue all queued/planned plans
  const { data: plans } = await sb
    .from("campaign_launch_plans")
    .select("id")
    .in("status", ["queued", "planned"])
    .order("campaign_priority", { ascending: false })
    .limit(25);

  const results: any[] = [];
  let totalEnqueued = 0;

  for (const plan of plans || []) {
    const { data } = await sb.rpc("enqueue_campaign_assets_from_plan", {
      p_launch_plan_id: plan.id,
    });
    results.push(data);
    totalEnqueued += (data as any)?.enqueued_assets ?? 0;
  }

  if (runId) {
    await sb.from("campaign_automation_runs").update({
      status: "done",
      processed_count: results.length,
      created_count: totalEnqueued,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }

  return json(200, { ok: true, processed: results.length, total_enqueued: totalEnqueued, results }, origin);
});
