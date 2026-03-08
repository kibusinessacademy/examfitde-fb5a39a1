import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

function heuristicSearchVolume(title: string): number {
  const t = (title || "").toLowerCase();
  if (t.includes("fachwirt")) return 82;
  if (t.includes("betriebswirt")) return 78;
  if (t.includes("meister")) return 86;
  if (t.includes("bilanzbuchhalter")) return 74;
  if (t.includes("controller")) return 62;
  if (t.includes("ada") || t.includes("ausbildereignung")) return 68;
  return 45;
}

function heuristicMonetization(title: string): number {
  const t = (title || "").toLowerCase();
  if (t.includes("betriebswirt")) return 88;
  if (t.includes("fachwirt")) return 84;
  if (t.includes("meister")) return 80;
  if (t.includes("bilanzbuchhalter")) return 82;
  if (t.includes("controller")) return 76;
  return 55;
}

function heuristicCompetitionGap(title: string): number {
  const t = (title || "").toLowerCase();
  if (t.includes("technischer fachwirt")) return 72;
  if (t.includes("controller")) return 75;
  if (t.includes("fachkaufmann")) return 78;
  if (t.includes("meister")) return 60;
  return 50;
}

function heuristicExamRelevance(title: string): number {
  const t = (title || "").toLowerCase();
  if (t.includes("meister")) return 92;
  if (t.includes("fachwirt")) return 88;
  if (t.includes("betriebswirt")) return 84;
  if (t.includes("bilanzbuchhalter")) return 89;
  if (t.includes("ada")) return 73;
  return 58;
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
  const limit = Math.min(Number(body.limit ?? 100), 500);

  // qualification_catalog has no 'active' column; use status != 'rejected'
  const { data: qualifications, error } = await sb
    .from("qualification_catalog")
    .select("id, canonical_title, award_type, provider_family")
    .neq("status", "rejected")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) return json(500, { error: error.message }, origin);

  const results: any[] = [];

  for (const q of qualifications || []) {
    const signals = [
      { key: "search_volume_score", value: heuristicSearchVolume(q.canonical_title) },
      { key: "monetization_score", value: heuristicMonetization(q.canonical_title) },
      { key: "competition_gap_score", value: heuristicCompetitionGap(q.canonical_title) },
      { key: "exam_relevance_score", value: heuristicExamRelevance(q.canonical_title) },
    ];

    for (const s of signals) {
      await sb.rpc("upsert_curriculum_market_signal", {
        p_qualification_catalog_id: q.id,
        p_curriculum_id: null,
        p_signal_source: "heuristic_market",
        p_signal_key: s.key,
        p_signal_value: s.value,
        p_signal_unit: "score",
        p_signal_weight: 1,
        p_meta: { title: q.canonical_title },
      });
    }

    results.push({
      qualification_catalog_id: q.id,
      title: q.canonical_title,
      ...Object.fromEntries(signals.map((s) => [s.key, s.value])),
    });
  }

  return json(200, { ok: true, processed: results.length, results }, origin);
});
