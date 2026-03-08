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

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit ?? 20), 50);

  const { data: run } = await sb
    .from("optimization_runs")
    .insert({ run_type: "executor", status: "running" })
    .select("id")
    .single();
  const runId = run?.id;

  // Claim queued actions
  const { data: actions, error: fetchErr } = await sb
    .from("optimization_actions")
    .select("*")
    .eq("status", "queued")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (fetchErr) {
    if (runId) await sb.from("optimization_runs").update({ status: "failed", finished_at: new Date().toISOString(), meta: { error: fetchErr.message } }).eq("id", runId);
    return json(500, { error: fetchErr.message }, origin);
  }

  const results: any[] = [];
  let doneCount = 0;
  let errorCount = 0;

  for (const action of actions || []) {
    try {
      // Mark processing
      await sb.from("optimization_actions").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", action.id);

      let resultPayload: any = {};

      switch (action.action_type) {
        case "pause_asset":
          if (action.asset_id) {
            await sb.from("campaign_assets").update({ publication_status: "archived", updated_at: new Date().toISOString() }).eq("id", action.asset_id);
            resultPayload = { paused: true, asset_id: action.asset_id };
          }
          break;

        case "pause_curriculum":
          if (action.qualification_catalog_id) {
            await sb.from("campaign_launch_plans").update({ status: "archived", updated_at: new Date().toISOString() }).eq("qualification_catalog_id", action.qualification_catalog_id);
            resultPayload = { paused: true, qualification_catalog_id: action.qualification_catalog_id };
          }
          break;

        case "scale_asset":
        case "replicate_asset":
        case "refresh_copy":
        case "change_angle":
          // Log observation for future AI-driven regeneration
          await sb.from("optimization_observations").insert({
            asset_id: action.asset_id,
            launch_plan_id: action.launch_plan_id,
            qualification_catalog_id: action.qualification_catalog_id,
            channel_key: action.action_payload?.channel_key,
            observation_type: action.action_type === "scale_asset" ? "winning_angle" :
                              action.action_type === "replicate_asset" ? "winning_angle" :
                              action.action_type === "refresh_copy" ? "weak_angle" : "weak_angle",
            observation_score: action.action_payload?.overall_score ?? 0,
            observation_label: `Auto: ${action.action_type}`,
            payload: action.action_payload || {},
          });
          resultPayload = { observation_logged: true, action_type: action.action_type };
          break;

        case "scale_curriculum":
        case "replicate_campaign":
        case "refresh_launch_plan":
          await sb.from("optimization_observations").insert({
            qualification_catalog_id: action.qualification_catalog_id,
            curriculum_id: action.curriculum_id,
            observation_type: action.action_type === "scale_curriculum" ? "curriculum_scale_signal" :
                              action.action_type === "replicate_campaign" ? "curriculum_scale_signal" : "curriculum_pause_signal",
            observation_score: action.action_payload?.replication_score ?? 0,
            observation_label: `Auto: ${action.action_type}`,
            payload: action.action_payload || {},
          });
          resultPayload = { observation_logged: true, action_type: action.action_type };
          break;

        default:
          resultPayload = { skipped: true, reason: "unknown_action_type" };
      }

      await sb.from("optimization_actions").update({
        status: "done",
        result_payload: resultPayload,
        executed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", action.id);

      doneCount++;
      results.push({ action_id: action.id, action_type: action.action_type, status: "done" });
    } catch (e: any) {
      errorCount++;
      await sb.from("optimization_actions").update({
        status: "failed",
        last_error: e.message,
        updated_at: new Date().toISOString(),
      }).eq("id", action.id);
      results.push({ action_id: action.id, action_type: action.action_type, status: "failed", error: e.message });
    }
  }

  if (runId) {
    await sb.from("optimization_runs").update({
      status: "done",
      processed_count: (actions || []).length,
      updated_count: doneCount,
      error_count: errorCount,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }

  return json(200, { ok: true, processed: (actions || []).length, done: doneCount, errors: errorCount, results }, origin);
});
