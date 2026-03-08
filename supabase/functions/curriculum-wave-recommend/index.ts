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
  const minScore = Number(body.min_score ?? 65);
  const limit = Math.min(Number(body.limit ?? 20), 100);

  // Get top recommendations
  const { data: recommendations, error } = await sb
    .from("curriculum_priority_recommendations")
    .select(`
      *,
      qualification_catalog:qualification_catalog_id(
        canonical_title, award_type, provider_family, qualification_level
      ),
      intelligence_score:qualification_catalog_id(
        demand_score, monetization_score, competition_gap_score,
        exam_relevance_score, readiness_score, strategic_fit_score,
        overall_priority_score, recommendation
      )
    `)
    .eq("recommended_for_wave", true)
    .gte("recommended_priority", 1)
    .order("recommended_priority", { ascending: false })
    .limit(limit);

  if (error) {
    // Fallback: simpler query without join on intelligence_scores
    const { data: simpleRecs, error: simpleErr } = await sb
      .from("curriculum_priority_recommendations")
      .select(`
        *,
        qualification_catalog:qualification_catalog_id(
          canonical_title, award_type, provider_family, qualification_level
        )
      `)
      .eq("recommended_for_wave", true)
      .order("recommended_priority", { ascending: false })
      .limit(limit);

    if (simpleErr) return json(500, { error: simpleErr.message }, origin);

    return json(200, {
      ok: true,
      recommendations: simpleRecs || [],
      count: simpleRecs?.length || 0,
    }, origin);
  }

  // Summary stats
  const { data: stats } = await sb
    .from("curriculum_intelligence_scores")
    .select("recommendation")
    .then((res) => {
      const counts: Record<string, number> = {};
      for (const r of res.data || []) {
        counts[r.recommendation] = (counts[r.recommendation] || 0) + 1;
      }
      return { data: counts };
    });

  return json(200, {
    ok: true,
    recommendations: recommendations || [],
    count: recommendations?.length || 0,
    summary: stats,
  }, origin);
});
