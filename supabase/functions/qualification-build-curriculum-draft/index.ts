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

  // Find catalog entries without drafts
  const { data: catalogEntries, error } = await sb
    .from("qualification_catalog")
    .select("id")
    .not("id", "in", 
      sb.from("qualification_curriculum_drafts").select("qualification_catalog_id")
    )
    .limit(limit);

  // Fallback: just get all catalog entries and let the upsert handle dedup
  const { data: allCatalog } = await sb
    .from("qualification_catalog")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(limit);

  const results: any[] = [];

  for (const entry of allCatalog || []) {
    const { data, error: rpcErr } = await sb.rpc("build_qualification_curriculum_draft", {
      p_catalog_id: entry.id,
    });

    results.push({
      catalog_id: entry.id,
      ok: !rpcErr,
      ...(rpcErr ? { error: rpcErr.message } : data),
    });
  }

  return json(200, { ok: true, processed: results.length, results }, origin);
});
