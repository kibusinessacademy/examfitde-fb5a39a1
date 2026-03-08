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

  // Find parsed candidates without catalog entry
  const { data: candidates, error } = await sb
    .from("curriculum_intake_parsed")
    .select("candidate_id")
    .is("qualification_catalog_id", null)
    .limit(limit);

  if (error) return json(500, { error: error.message }, origin);

  const results: any[] = [];

  for (const row of candidates || []) {
    const { data, error: rpcErr } = await sb.rpc("upsert_qualification_catalog_from_candidate", {
      p_candidate_id: row.candidate_id,
    });

    results.push({
      candidate_id: row.candidate_id,
      ok: !rpcErr,
      ...(rpcErr ? { error: rpcErr.message } : data),
    });
  }

  return json(200, { ok: true, processed: results.length, results }, origin);
});
