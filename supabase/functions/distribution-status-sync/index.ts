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
    .insert({ run_type: "status_sync", status: "running" })
    .select("id")
    .single();
  const runId = run?.id;

  // Expire stale leases
  const { data: expired } = await sb
    .from("distribution_queue")
    .update({
      status: "queued",
      lease_owner: null,
      lease_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("status", "processing")
    .lt("lease_until", new Date().toISOString())
    .select("id");

  // Mark failed targets where queue is dead
  const { data: deadJobs } = await sb
    .from("distribution_queue")
    .select("target_id")
    .eq("status", "dead");

  for (const dj of deadJobs || []) {
    await sb.from("distribution_targets").update({
      distribution_status: "failed",
      updated_at: new Date().toISOString(),
    }).eq("id", dj.target_id);
  }

  // Update campaign_assets publication_status for published distributions
  const { data: published } = await sb
    .from("distribution_publications")
    .select("asset_id")
    .eq("publication_status", "published");

  const publishedAssetIds = [...new Set((published || []).map((p: any) => p.asset_id))];
  for (const assetId of publishedAssetIds) {
    await sb.from("campaign_assets").update({
      publication_status: "published",
      updated_at: new Date().toISOString(),
    }).eq("id", assetId).neq("publication_status", "published");
  }

  if (runId) {
    await sb.from("distribution_runs").update({
      status: "done",
      processed_count: (expired?.length ?? 0) + (deadJobs?.length ?? 0) + publishedAssetIds.length,
      finished_at: new Date().toISOString(),
      meta: {
        expired_leases: expired?.length ?? 0,
        dead_targets: deadJobs?.length ?? 0,
        assets_published: publishedAssetIds.length,
      },
    }).eq("id", runId);
  }

  return json(200, {
    ok: true,
    expired_leases: expired?.length ?? 0,
    dead_targets: deadJobs?.length ?? 0,
    assets_published: publishedAssetIds.length,
  }, origin);
});
