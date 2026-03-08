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
  const limit = Math.min(Number(body.limit ?? 300), 1000);

  const { data: run } = await sb
    .from("optimization_runs")
    .insert({ run_type: "asset_score", status: "running" })
    .select("id")
    .single();
  const runId = run?.id;

  const { data: assets, error } = await sb
    .from("campaign_assets")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (runId) await sb.from("optimization_runs").update({ status: "failed", finished_at: new Date().toISOString(), meta: { error: error.message } }).eq("id", runId);
    return json(500, { error: error.message }, origin);
  }

  const results: any[] = [];
  let errorCount = 0;

  for (const asset of assets || []) {
    const { data, error: rpcErr } = await sb.rpc("compute_asset_optimization_score", {
      p_asset_id: asset.id,
    });
    if (rpcErr) { errorCount++; results.push({ asset_id: asset.id, error: rpcErr.message }); }
    else results.push(data);
  }

  if (runId) {
    await sb.from("optimization_runs").update({
      status: "done",
      processed_count: results.length,
      updated_count: results.filter((r: any) => r?.ok).length,
      error_count: errorCount,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }

  return json(200, { ok: true, processed: results.length, errors: errorCount, results }, origin);
});
