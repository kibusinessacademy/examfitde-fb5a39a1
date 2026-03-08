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

function mapAwardType(v?: string | null) {
  const t = (v || "").toLowerCase();
  if (["meister", "fachwirt", "betriebswirt", "bilanzbuchhalter"].includes(t)) return t;
  return "other";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: activeQualifications } = await sb
    .from("qualification_catalog")
    .select("id, award_type")
    .eq("active", true);

  const total = Math.max(1, (activeQualifications || []).length);

  const counts: Record<string, number> = {};
  for (const q of activeQualifications || []) {
    const key = mapAwardType(q.award_type);
    counts[key] = (counts[key] || 0) + 1;
  }

  const { data: allocations } = await sb
    .from("executive_portfolio_allocations")
    .select("*")
    .eq("segment_type", "award_type");

  const results: any[] = [];

  for (const row of allocations || []) {
    const actualShare = Number(counts[row.segment_value] || 0) / total;
    const delta = actualShare - Number(row.target_share || 0);
    const score = 100 - Math.min(100, Math.abs(delta) * 300);

    const status =
      delta < -0.05 ? "underweight"
      : delta > 0.05 ? "overweight"
      : "balanced";

    await sb.from("executive_portfolio_allocations").update({
      actual_share: actualShare,
      score,
      status,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);

    results.push({ allocation_key: row.allocation_key, target_share: row.target_share, actual_share: actualShare, delta, status, score });

    if (status === "underweight") {
      await sb.from("executive_portfolio_decisions").insert({
        decision_scope: "portfolio",
        decision_type: "rebalance_portfolio",
        decision_status: "queued",
        priority: 7,
        reason: `Portfolio underweight for ${row.segment_value}`,
        payload: { segment_type: row.segment_type, segment_value: row.segment_value, target_share: row.target_share, actual_share: actualShare },
      });
    }
  }

  return json(200, { ok: true, total, results });
});
