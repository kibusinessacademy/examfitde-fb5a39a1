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

  const { data: run } = await sb
    .from("distribution_runs")
    .insert({ run_type: "sync", status: "running" })
    .select("id")
    .single();
  const runId = run?.id;

  let campaignSynced = 0;
  let growthEnqueued = 0;

  // Step 1: Sync campaign assets (existing flow)
  const { data: campaignData, error: campaignErr } = await sb.rpc("sync_distribution_targets_from_assets");
  if (!campaignErr && campaignData) {
    campaignSynced = (campaignData as any)?.synced_targets ?? 0;
  }

  // Step 2: Enqueue growth content (blog + video)
  const { data: growthData, error: growthErr } = await sb.rpc("enqueue_growth_distribution");
  if (!growthErr && growthData) {
    growthEnqueued = (growthData as any)?.enqueued ?? 0;
  }

  const totalSynced = campaignSynced + growthEnqueued;
  const hasError = campaignErr && growthErr;

  if (hasError) {
    if (runId) await sb.from("distribution_runs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      meta: { campaign_error: campaignErr?.message, growth_error: growthErr?.message },
    }).eq("id", runId);
    return json(500, { error: "Both sync steps failed" }, origin);
  }

  if (runId) {
    await sb.from("distribution_runs").update({
      status: "done",
      processed_count: totalSynced,
      created_count: totalSynced,
      finished_at: new Date().toISOString(),
      meta: { campaign_synced: campaignSynced, growth_enqueued: growthEnqueued },
    }).eq("id", runId);
  }

  return json(200, {
    ok: true,
    campaign_synced: campaignSynced,
    growth_enqueued: growthEnqueued,
    total: totalSynced,
  }, origin);
});
