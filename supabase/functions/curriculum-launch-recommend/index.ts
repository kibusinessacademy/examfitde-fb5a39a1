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

  // Create run record
  const { data: run } = await sb
    .from("curriculum_revenue_runs")
    .insert({ run_type: "recommendation_sync", status: "running" })
    .select("id")
    .single();
  const runId = run?.id;

  const { data: result, error } = await sb.rpc("sync_curriculum_launch_recommendations");

  if (error) {
    if (runId) await sb.from("curriculum_revenue_runs").update({ status: "failed", finished_at: new Date().toISOString(), meta: { error: error.message } }).eq("id", runId);
    return json(500, { error: error.message }, origin);
  }

  if (runId) {
    await sb.from("curriculum_revenue_runs").update({
      status: "done",
      processed_count: (result as any)?.synced ?? 0,
      updated_count: (result as any)?.synced ?? 0,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }

  return json(200, { ok: true, ...result }, origin);
});
