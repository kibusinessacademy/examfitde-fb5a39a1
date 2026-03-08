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

async function countRows(sb: any, table: string): Promise<number> {
  const { count } = await sb.from(table).select("id", { head: true, count: "exact" });
  return Number(count || 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const today = new Date().toISOString().slice(0, 10);

  const [campaignAssets, distPubs, optScores, openAlerts, openViolations] = await Promise.all([
    countRows(sb, "campaign_assets"),
    countRows(sb, "distribution_publications"),
    countRows(sb, "asset_optimization_scores"),
    (async () => {
      const { count } = await sb.from("control_plane_alerts").select("id", { head: true, count: "exact" }).eq("status", "open");
      return Number(count || 0);
    })(),
    (async () => {
      const { count } = await sb.from("system_contract_violations").select("id", { head: true, count: "exact" }).eq("status", "open");
      return Number(count || 0);
    })(),
  ]);

  const metrics: Record<string, number> = {
    campaign_assets: campaignAssets,
    distribution_publications: distPubs,
    asset_optimization_scores: optScores,
    open_control_alerts: openAlerts,
    open_contract_violations: openViolations,
  };

  const rows = Object.entries(metrics).map(([key, value]) => ({
    snapshot_key: key,
    snapshot_scope: "system",
    snapshot_date: today,
    metrics: { value },
  }));

  const { error } = await sb.from("system_regression_snapshots").insert(rows);
  if (error) return json(500, { error: error.message });

  return json(200, { ok: true, inserted: rows.length, metrics });
});
