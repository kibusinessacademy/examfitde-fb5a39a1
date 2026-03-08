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

  // Health
  const { data: latestSnapshot } = await sb
    .from("control_plane_snapshots")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);

  const snapshot = latestSnapshot?.[0] || {};

  // Finance
  const { data: latestBizKpi } = await sb
    .from("business_kpi_snapshots")
    .select("*")
    .order("snapshot_date", { ascending: false })
    .limit(1);

  const bizKpi = latestBizKpi?.[0] || {};

  // Portfolio
  const { data: allocations } = await sb
    .from("executive_portfolio_allocations")
    .select("*");

  // Waves
  const { data: waveDecisions } = await sb
    .from("wave_governance_decisions")
    .select("decision_status")
    .limit(200);

  const waveApproved = (waveDecisions || []).filter((w: any) => w.decision_status === "approved").length;
  const waveBlocked = (waveDecisions || []).filter((w: any) => w.decision_status === "blocked").length;

  // Decisions
  const { data: decisions } = await sb
    .from("executive_portfolio_decisions")
    .select("decision_type, decision_status")
    .gte("created_at", today)
    .limit(500);

  const decisionsByType: Record<string, number> = {};
  for (const d of decisions || []) {
    decisionsByType[d.decision_type] = (decisionsByType[d.decision_type] || 0) + 1;
  }

  // Recommendations
  const recommendations: string[] = [];
  const blendedRoi = Number(bizKpi.blended_roi || 0);
  if (blendedRoi < 1) recommendations.push("Blended ROI unter 1.0 — Kostenoptimierung priorisieren");
  if (blendedRoi > 2) recommendations.push("Starker ROI — Skalierung empfohlen");
  if (waveBlocked > 3) recommendations.push(`${waveBlocked} Waves blockiert — Root-Cause prüfen`);

  const underweight = (allocations || []).filter((a: any) => a.status === "underweight");
  if (underweight.length > 0) {
    recommendations.push(`Portfolio-Lücke: ${underweight.map((a: any) => a.segment_value).join(", ")}`);
  }

  const headline = blendedRoi >= 1.5
    ? "System performt stark — Skalierungspotenzial vorhanden"
    : blendedRoi >= 1
    ? "System stabil — Optimierung läuft"
    : "Achtung: ROI unter Zielwert — Maßnahmen prüfen";

  const { data, error } = await sb
    .from("executive_summary_reports")
    .insert({
      report_period: "daily",
      report_date: today,
      headline,
      health_summary: {
        health_score: snapshot.health_score,
        status: snapshot.status,
      },
      finance_summary: {
        total_revenue: bizKpi.total_revenue,
        total_cost: bizKpi.total_cost_estimate,
        profit: bizKpi.estimated_profit,
        blended_roi: bizKpi.blended_roi,
      },
      portfolio_summary: {
        allocations: (allocations || []).map((a: any) => ({
          segment: a.segment_value,
          target: a.target_share,
          actual: a.actual_share,
          status: a.status,
        })),
      },
      wave_summary: {
        approved: waveApproved,
        blocked: waveBlocked,
      },
      decisions_summary: decisionsByType,
      recommendations,
    })
    .select("id")
    .single();

  if (error) return json(500, { error: error.message });

  return json(200, { ok: true, report_id: data.id, headline, recommendations });
});
