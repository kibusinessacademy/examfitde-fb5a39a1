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

  const roiMinRes = await sb.rpc("get_roi_rule_threshold", { p_rule_key: "wave_expected_roi_min" });
  const roiMin = Number(roiMinRes.data || 1.15);

  const { data: waves, error } = await sb
    .from("production_waves")
    .select("*")
    .in("status", ["draft", "active", "paused"])
    .limit(100);

  if (error) return json(500, { error: error.message });

  const results: any[] = [];

  for (const wave of waves || []) {
    const { data: items } = await sb
      .from("production_wave_items")
      .select("*")
      .eq("wave_id", wave.id);

    const blockedCount = (items || []).filter((i: any) => i.status === "blocked").length;
    const totalItems = (items || []).length;

    // Gather average unit economics for wave items
    const qcIds = [...new Set((items || []).map((i: any) => i.qualification_catalog_id).filter(Boolean))];
    let avgRoi = 0;
    let avgPriority = 0;
    let avgReadiness = 0;
    let projectedRevenue = 0;
    let projectedCost = 0;

    if (qcIds.length > 0) {
      const { data: economics } = await sb
        .from("curriculum_unit_economics")
        .select("roi, attributed_revenue, total_cost_estimate")
        .in("qualification_catalog_id", qcIds);

      if (economics && economics.length > 0) {
        avgRoi = economics.reduce((s: number, e: any) => s + Number(e.roi || 0), 0) / economics.length;
        projectedRevenue = economics.reduce((s: number, e: any) => s + Number(e.attributed_revenue || 0), 0);
        projectedCost = economics.reduce((s: number, e: any) => s + Number(e.total_cost_estimate || 0), 0);
      }
    }

    const ruleResults: any[] = [];
    let decisionStatus = "pending";
    let decisionReason = "";

    // Rule: ROI check
    if (avgRoi >= roiMin) {
      ruleResults.push({ rule: "wave_expected_roi_min", pass: true, value: avgRoi, threshold: roiMin });
    } else {
      ruleResults.push({ rule: "wave_expected_roi_min", pass: false, value: avgRoi, threshold: roiMin });
    }

    // Rule: blocked ratio
    const blockedRatio = totalItems > 0 ? blockedCount / totalItems : 0;
    if (blockedRatio > 0.3) {
      ruleResults.push({ rule: "blocked_ratio", pass: false, value: blockedRatio, threshold: 0.3 });
    } else {
      ruleResults.push({ rule: "blocked_ratio", pass: true, value: blockedRatio, threshold: 0.3 });
    }

    const allPass = ruleResults.every((r: any) => r.pass);
    const anyFail = ruleResults.some((r: any) => !r.pass);

    if (allPass) {
      decisionStatus = "approved";
      decisionReason = "All governance rules passed";
    } else if (blockedRatio > 0.5) {
      decisionStatus = "blocked";
      decisionReason = `High blocked ratio: ${(blockedRatio * 100).toFixed(0)}%`;
    } else {
      decisionStatus = "paused";
      decisionReason = `ROI or blocked checks failed`;
    }

    const { error: upsertErr } = await sb
      .from("wave_governance_decisions")
      .upsert({
        wave_id: wave.id,
        decision_status: decisionStatus,
        expected_roi: avgRoi,
        avg_priority_score: avgPriority,
        avg_readiness_score: avgReadiness,
        blocked_item_count: blockedCount,
        projected_cost: projectedCost,
        projected_revenue: projectedRevenue,
        decision_reason: decisionReason,
        rule_results: ruleResults,
        approved_by: "system",
        updated_at: new Date().toISOString(),
      }, { onConflict: "wave_id" });

    results.push({
      wave_id: wave.id,
      decision_status: decisionStatus,
      expected_roi: avgRoi,
      error: upsertErr?.message || null,
    });
  }

  return json(200, { ok: true, processed: results.length, results });
});
