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

function scoreToStatus(score: number): "healthy" | "warning" | "degraded" | "critical" {
  if (score >= 85) return "healthy";
  if (score >= 70) return "warning";
  if (score >= 45) return "degraded";
  return "critical";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const nowIso = new Date().toISOString();
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();

  const [
    jobFailed1h,
    jobPending,
    packagesBuilding,
    packagesQueued,
    waveItemsBlocked,
    launchPlansReady,
    assetQueueOpen,
    distributionQueueOpen,
    optimizationQueued,
    revenueToday,
  ] = await Promise.all([
    sb.from("job_queue").select("id", { head: true, count: "exact" }).eq("status", "failed").gte("updated_at", oneHourAgo),
    sb.from("job_queue").select("id", { head: true, count: "exact" }).in("status", ["pending", "queued", "processing"]),
    sb.from("course_packages").select("id", { head: true, count: "exact" }).eq("status", "building"),
    sb.from("course_packages").select("id", { head: true, count: "exact" }).eq("status", "queued"),
    sb.from("production_wave_items").select("id", { head: true, count: "exact" }).eq("status", "blocked"),
    sb.from("campaign_launch_plans").select("id", { head: true, count: "exact" }).in("status", ["queued", "ready", "in_progress"]),
    sb.from("campaign_asset_queue").select("id", { head: true, count: "exact" }).in("status", ["queued", "processing"]),
    sb.from("distribution_queue").select("id", { head: true, count: "exact" }).in("status", ["queued", "processing"]),
    sb.from("optimization_actions").select("id", { head: true, count: "exact" }).eq("status", "queued"),
    sb.from("campaign_performance_snapshots").select("revenue").gte("metric_date", nowIso.slice(0, 10)),
  ]);

  const financeRevenue = (revenueToday.data || []).reduce((sum: number, r: any) => sum + Number(r.revenue || 0), 0);

  let healthScore = 100;
  healthScore -= Math.min(30, Number(jobFailed1h.count || 0) * 0.5);
  healthScore -= Math.min(15, Number(waveItemsBlocked.count || 0) * 1.2);
  healthScore -= Math.min(10, Math.max(0, Number(distributionQueueOpen.count || 0) - 50) * 0.2);
  healthScore -= Math.min(10, Math.max(0, Number(optimizationQueued.count || 0) - 40) * 0.15);

  const status = scoreToStatus(healthScore);

  const snapshot = {
    intake: {
      pending_jobs: Number(jobPending.count || 0),
    },
    production: {
      packages_building: Number(packagesBuilding.count || 0),
      packages_queued: Number(packagesQueued.count || 0),
      failed_jobs_1h: Number(jobFailed1h.count || 0),
      blocked_wave_items: Number(waveItemsBlocked.count || 0),
    },
    revenue: {
      ready_launch_plans: Number(launchPlansReady.count || 0),
    },
    campaigns: {
      asset_queue_open: Number(assetQueueOpen.count || 0),
    },
    distribution: {
      distribution_queue_open: Number(distributionQueueOpen.count || 0),
    },
    optimization: {
      optimization_actions_queued: Number(optimizationQueued.count || 0),
    },
    finance: {
      revenue_today: financeRevenue,
    },
  };

  const { data, error } = await sb
    .from("control_plane_snapshots")
    .insert({
      snapshot_scope: "global",
      snapshot_key: "system",
      health_score: healthScore,
      status,
      intake: snapshot.intake,
      production: snapshot.production,
      revenue: snapshot.revenue,
      campaigns: snapshot.campaigns,
      distribution: snapshot.distribution,
      optimization: snapshot.optimization,
      finance: snapshot.finance,
      summary: { created_at: nowIso },
    })
    .select("id")
    .single();

  if (error) return json(500, { error: error.message });

  return json(200, {
    ok: true,
    snapshot_id: data.id,
    health_score: healthScore,
    status,
    snapshot,
  });
});
