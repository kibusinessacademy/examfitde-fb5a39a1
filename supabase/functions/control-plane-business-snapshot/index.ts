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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const today = new Date().toISOString().slice(0, 10);

  const [
    revenueRes,
    costRes,
    curriculaRes,
    monetizedRes,
    campaignsRes,
    wavesActiveRes,
    wavesBlockedRes,
    topChannelRes,
  ] = await Promise.all([
    sb.from("curriculum_unit_economics").select("attributed_revenue"),
    sb.from("curriculum_unit_economics").select("total_cost_estimate"),
    sb.from("qualification_catalog").select("id", { head: true, count: "exact" }).eq("active", true),
    sb.from("curriculum_unit_economics").select("id", { head: true, count: "exact" }).gt("attributed_revenue", 0),
    sb.from("campaign_launch_plans").select("id", { head: true, count: "exact" }).in("status", ["queued", "in_progress", "ready"]),
    sb.from("production_waves").select("id", { head: true, count: "exact" }).eq("status", "active"),
    sb.from("wave_governance_decisions").select("id", { head: true, count: "exact" }).eq("decision_status", "blocked"),
    sb.from("channel_unit_economics").select("channel_key, roi").order("roi", { ascending: false }).limit(1),
  ]);

  const totalRevenue = (revenueRes.data || []).reduce((s: number, r: any) => s + Number(r.attributed_revenue || 0), 0);
  const totalCost = (costRes.data || []).reduce((s: number, r: any) => s + Number(r.total_cost_estimate || 0), 0);
  const profit = totalRevenue - totalCost;
  const blendedRoi = totalCost > 0 ? totalRevenue / totalCost : 0;
  const topChannel = (topChannelRes.data && topChannelRes.data[0]?.channel_key) || null;

  const { data, error } = await sb
    .from("business_kpi_snapshots")
    .insert({
      snapshot_date: today,
      total_revenue: totalRevenue,
      total_cost_estimate: totalCost,
      estimated_profit: profit,
      blended_roi: blendedRoi,
      active_curricula: Number(curriculaRes.count || 0),
      monetized_curricula: Number(monetizedRes.count || 0),
      active_campaigns: Number(campaignsRes.count || 0),
      active_waves: Number(wavesActiveRes.count || 0),
      blocked_waves: Number(wavesBlockedRes.count || 0),
      top_channel: topChannel,
      summary: { generated_at: new Date().toISOString() },
    })
    .select("id")
    .single();

  if (error) return json(500, { error: error.message });

  return json(200, {
    ok: true,
    snapshot_id: data.id,
    total_revenue: totalRevenue,
    total_cost: totalCost,
    profit,
    blended_roi,
  });
});
