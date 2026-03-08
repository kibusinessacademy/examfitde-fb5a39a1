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
  const limit = Math.min(Number(body.limit ?? 100), 500);

  const { data: qualifications, error } = await sb
    .from("qualification_catalog")
    .select("id, canonical_title")
    .neq("status", "rejected")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) return json(500, { error: error.message }, origin);

  const results: any[] = [];

  for (const q of qualifications || []) {
    const { data } = await sb.rpc("compute_curriculum_intelligence_score", {
      p_qualification_catalog_id: q.id,
    });
    results.push(data);
  }

  const { data: syncData } = await sb.rpc("sync_curriculum_priority_recommendations");

  return json(200, { ok: true, processed: results.length, sync: syncData, results }, origin);
});
