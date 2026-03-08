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

  const results: any[] = [];

  // Curriculum decisions from unit economics
  const { data: curricula } = await sb
    .from("curriculum_unit_economics")
    .select("*")
    .limit(500);

  for (const row of curricula || []) {
    let decisionType: string | null = null;
    if (row.decision === "scale" || row.decision === "promote") decisionType = "promote_curriculum";
    else if (row.decision === "pause") decisionType = "pause_curriculum";
    else if (row.decision === "kill") decisionType = "kill_curriculum";

    if (!decisionType) continue;

    const { data } = await sb.from("executive_portfolio_decisions").insert({
      decision_scope: "curriculum",
      qualification_catalog_id: row.qualification_catalog_id,
      curriculum_id: row.curriculum_id,
      decision_type: decisionType,
      decision_status: "queued",
      priority: Math.min(10, Math.max(1, Math.round(Number(row.roi || 0) * 3))),
      reason: `Curriculum unit economics decision: ${row.decision}`,
      payload: { roi: row.roi, margin: row.contribution_margin, payback_days: row.payback_days },
    }).select("id").single();

    results.push(data);
  }

  // Wave decisions from governance
  const { data: waves } = await sb
    .from("wave_governance_decisions")
    .select("*")
    .limit(200);

  for (const row of waves || []) {
    let decisionType: string | null = null;
    if (row.decision_status === "approved") decisionType = "approve_wave";
    else if (row.decision_status === "blocked") decisionType = "block_wave";
    else if (row.decision_status === "paused") decisionType = "pause_wave";

    if (!decisionType) continue;

    const { data } = await sb.from("executive_portfolio_decisions").insert({
      decision_scope: "wave",
      wave_id: row.wave_id,
      decision_type: decisionType,
      decision_status: "queued",
      priority: 8,
      reason: row.decision_reason,
      payload: { expected_roi: row.expected_roi, blocked_item_count: row.blocked_item_count },
    }).select("id").single();

    results.push(data);
  }

  // Channel decisions
  const { data: channels } = await sb
    .from("channel_unit_economics")
    .select("*")
    .limit(100);

  for (const row of channels || []) {
    let decisionType: string | null = null;
    if (row.decision === "scale") decisionType = "scale_channel";
    else if (row.decision === "pause" || row.decision === "kill") decisionType = "hold_channel";

    if (!decisionType) continue;

    const { data } = await sb.from("executive_portfolio_decisions").insert({
      decision_scope: "channel",
      channel_key: row.channel_key,
      decision_type: decisionType,
      decision_status: "queued",
      priority: 6,
      reason: `Channel unit economics: ${row.decision}`,
      payload: { roi: row.roi, ctr: row.ctr, conversion_rate: row.conversion_rate },
    }).select("id").single();

    results.push(data);
  }

  return json(200, { ok: true, decisions_created: results.length, results });
});
