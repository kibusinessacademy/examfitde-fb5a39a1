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
  const limit = Math.min(Number(body.limit ?? 200), 500);

  // Create run record
  const { data: run } = await sb
    .from("curriculum_revenue_runs")
    .insert({ run_type: "gtm_score", status: "running" })
    .select("id")
    .single();
  const runId = run?.id;

  // Get qualifications that have revenue signals
  const { data: qualifications, error } = await sb
    .from("qualification_catalog")
    .select("id, canonical_title")
    .neq("status", "rejected")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (runId) await sb.from("curriculum_revenue_runs").update({ status: "failed", finished_at: new Date().toISOString(), meta: { error: error.message } }).eq("id", runId);
    return json(500, { error: error.message }, origin);
  }

  const results: any[] = [];
  let errorCount = 0;

  for (const q of qualifications || []) {
    const { data: result, error: rpcErr } = await sb.rpc("compute_curriculum_gtm_score", {
      p_qualification_catalog_id: q.id,
    });

    if (rpcErr) {
      errorCount++;
      results.push({ qualification_catalog_id: q.id, error: rpcErr.message });
    } else {
      results.push(result);
    }
  }

  if (runId) {
    await sb.from("curriculum_revenue_runs").update({
      status: "done",
      processed_count: results.length,
      updated_count: results.filter((r: any) => r?.ok).length,
      error_count: errorCount,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }

  return json(200, { ok: true, processed: results.length, errors: errorCount, results }, origin);
});
