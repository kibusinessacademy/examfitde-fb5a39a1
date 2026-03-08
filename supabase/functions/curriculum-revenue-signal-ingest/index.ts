import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

function scoreB2C(title: string): number {
  const t = (title || "").toLowerCase();
  if (t.includes("fachwirt")) return 84;
  if (t.includes("meister")) return 80;
  if (t.includes("bilanzbuchhalter")) return 82;
  if (t.includes("betriebswirt")) return 78;
  if (t.includes("ada") || t.includes("ausbildereignung")) return 64;
  return 50;
}

function scoreB2B(title: string): number {
  const t = (title || "").toLowerCase();
  if (t.includes("technischer fachwirt")) return 83;
  if (t.includes("meister")) return 88;
  if (t.includes("fachwirt")) return 81;
  if (t.includes("ada")) return 76;
  return 52;
}

function scoreSeo(title: string): number {
  const t = (title || "").toLowerCase();
  if (t.includes("fachwirt")) return 86;
  if (t.includes("meister")) return 79;
  if (t.includes("ada")) return 74;
  if (t.includes("betriebswirt")) return 68;
  return 48;
}

function scoreAffiliate(title: string): number {
  const t = (title || "").toLowerCase();
  if (t.includes("ada")) return 72;
  if (t.includes("fachwirt")) return 60;
  if (t.includes("meister")) return 54;
  return 42;
}

function scoreConversion(title: string): number {
  const t = (title || "").toLowerCase();
  if (t.includes("prüfung") || t.includes("fachwirt") || t.includes("meister")) return 78;
  if (t.includes("ada")) return 70;
  return 55;
}

function scorePricePower(title: string): number {
  const t = (title || "").toLowerCase();
  if (t.includes("betriebswirt")) return 88;
  if (t.includes("meister")) return 84;
  if (t.includes("bilanzbuchhalter")) return 85;
  if (t.includes("fachwirt")) return 80;
  return 58;
}

function scoreContentLeverage(title: string): number {
  const t = (title || "").toLowerCase();
  if (t.includes("fachwirt")) return 82;
  if (t.includes("meister")) return 77;
  if (t.includes("ada")) return 68;
  return 52;
}

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
    .insert({ run_type: "signal_ingest", status: "running" })
    .select("id")
    .single();

  const runId = run?.id;

  // qualification_catalog has no 'active' column; use status != 'rejected'
  const { data: qualifications, error } = await sb
    .from("qualification_catalog")
    .select("id, canonical_title, award_type, provider_family")
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
    const title = q.canonical_title || "";

    const signals: [string, number][] = [
      ["b2c_revenue_score", scoreB2C(title)],
      ["b2b_revenue_score", scoreB2B(title)],
      ["seo_score", scoreSeo(title)],
      ["affiliate_score", scoreAffiliate(title)],
      ["conversion_score", scoreConversion(title)],
      ["price_power_score", scorePricePower(title)],
      ["content_leverage_score", scoreContentLeverage(title)],
    ];

    for (const [key, value] of signals) {
      const { error: rpcErr } = await sb.rpc("upsert_curriculum_revenue_signal", {
        p_qualification_catalog_id: q.id,
        p_curriculum_id: null,
        p_signal_source: "heuristic_revenue",
        p_signal_key: key,
        p_signal_value: value,
        p_signal_unit: "score",
        p_signal_weight: 1,
        p_meta: { title, award_type: q.award_type },
      });
      if (rpcErr) errorCount++;
    }

    results.push({
      qualification_catalog_id: q.id,
      title,
      ...Object.fromEntries(signals),
    });
  }

  if (runId) {
    await sb.from("curriculum_revenue_runs").update({
      status: "done",
      processed_count: results.length,
      updated_count: results.length * 7,
      error_count: errorCount,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }

  return json(200, { ok: true, processed: results.length, errors: errorCount, results }, origin);
});
