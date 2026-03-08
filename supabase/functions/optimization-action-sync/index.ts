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
    .from("optimization_runs")
    .insert({ run_type: "action_sync", status: "running" })
    .select("id")
    .single();
  const runId = run?.id;

  const results: any[] = [];
  let createdCount = 0;

  // Asset-level actions from optimization scores
  const { data: assetScores } = await sb
    .from("asset_optimization_scores")
    .select("asset_id, launch_plan_id, channel_key, overall_score, optimization_status, recommended_action, reasoning")
    .neq("recommended_action", "keep_running")
    .order("overall_score", { ascending: false })
    .limit(200);

  for (const s of assetScores || []) {
    const actionTypeMap: Record<string, string> = {
      replicate: "replicate_asset",
      scale: "scale_asset",
      refresh_copy: "refresh_copy",
      change_angle: "change_angle",
      pause: "pause_asset",
    };
    const actionType = actionTypeMap[s.recommended_action];
    if (!actionType) continue;

    const { error: insertErr } = await sb.from("optimization_actions").insert({
      action_scope: "asset",
      asset_id: s.asset_id,
      launch_plan_id: s.launch_plan_id,
      action_type: actionType,
      priority: Math.round(s.overall_score / 10),
      status: "queued",
      action_payload: {
        channel_key: s.channel_key,
        overall_score: s.overall_score,
        optimization_status: s.optimization_status,
        reasoning: s.reasoning,
      },
    });

    if (!insertErr) createdCount++;
    results.push({ asset_id: s.asset_id, action_type: actionType, created: !insertErr });
  }

  // Curriculum-level actions from scaling signals
  const { data: scalingSignals } = await sb
    .from("curriculum_scaling_signals")
    .select("qualification_catalog_id, curriculum_id, replication_score, scale_decision, reasoning")
    .neq("scale_decision", "hold")
    .order("replication_score", { ascending: false })
    .limit(100);

  for (const s of scalingSignals || []) {
    const actionTypeMap: Record<string, string> = {
      scale_now: "scale_curriculum",
      replicate_assets: "replicate_campaign",
      refresh_campaign: "refresh_launch_plan",
      pause: "pause_curriculum",
    };
    const actionType = actionTypeMap[s.scale_decision];
    if (!actionType) continue;

    const { error: insertErr } = await sb.from("optimization_actions").insert({
      action_scope: "curriculum",
      qualification_catalog_id: s.qualification_catalog_id,
      curriculum_id: s.curriculum_id,
      action_type: actionType,
      priority: Math.round(s.replication_score / 10),
      status: "queued",
      action_payload: {
        replication_score: s.replication_score,
        scale_decision: s.scale_decision,
        reasoning: s.reasoning,
      },
    });

    if (!insertErr) createdCount++;
    results.push({ qualification_catalog_id: s.qualification_catalog_id, action_type: actionType, created: !insertErr });
  }

  if (runId) {
    await sb.from("optimization_runs").update({
      status: "done",
      processed_count: results.length,
      created_count: createdCount,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }

  return json(200, { ok: true, processed: results.length, created: createdCount, results }, origin);
});
