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
    .insert({ run_type: "performance_sync", status: "running" })
    .select("id")
    .single();
  const runId = run?.id;

  // Get all active launch plans with published assets
  const { data: plans, error } = await sb
    .from("campaign_launch_plans")
    .select("id, primary_channel, qualification_catalog_id")
    .in("status", ["in_progress", "launched", "ready"])
    .limit(200);

  if (error) {
    if (runId) await sb.from("campaign_automation_runs").update({ status: "failed", finished_at: new Date().toISOString(), meta: { error: error.message } }).eq("id", runId);
    return json(500, { error: error.message }, origin);
  }

  let snapshotCount = 0;
  const today = new Date().toISOString().split("T")[0];

  for (const plan of plans || []) {
    // Count published assets per channel for this plan
    const { data: assets } = await sb
      .from("campaign_assets")
      .select("id, channel")
      .eq("launch_plan_id", plan.id)
      .eq("publication_status", "published");

    if (!assets || assets.length === 0) continue;

    // Group by channel
    const channels = [...new Set(assets.map((a: any) => a.channel))];

    for (const channel of channels) {
      const channelAssets = assets.filter((a: any) => a.channel === channel);

      // Insert placeholder snapshot (real data would come from analytics integrations)
      await sb.from("campaign_performance_snapshots").insert({
        launch_plan_id: plan.id,
        channel,
        metric_date: today,
        impressions: 0,
        clicks: 0,
        leads: 0,
        purchases: 0,
        revenue: 0,
        meta: { asset_count: channelAssets.length },
      });
      snapshotCount++;
    }
  }

  // Check if plans should be marked as "ready" or "launched"
  for (const plan of plans || []) {
    const { count: totalAssets } = await sb
      .from("campaign_asset_queue")
      .select("id", { count: "exact", head: true })
      .eq("launch_plan_id", plan.id);

    const { count: doneAssets } = await sb
      .from("campaign_asset_queue")
      .select("id", { count: "exact", head: true })
      .eq("launch_plan_id", plan.id)
      .eq("status", "done");

    if (totalAssets && doneAssets && doneAssets >= totalAssets) {
      await sb.from("campaign_launch_plans").update({
        status: "ready",
        updated_at: new Date().toISOString(),
      }).eq("id", plan.id).eq("status", "in_progress");
    }
  }

  if (runId) {
    await sb.from("campaign_automation_runs").update({
      status: "done",
      processed_count: (plans || []).length,
      created_count: snapshotCount,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }

  return json(200, { ok: true, plans_checked: (plans || []).length, snapshots_created: snapshotCount }, origin);
});
