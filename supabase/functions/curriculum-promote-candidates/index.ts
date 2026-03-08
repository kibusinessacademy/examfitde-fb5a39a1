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

  // Find parsed candidates that pass readiness
  const { data: candidates } = await sb
    .from("curriculum_intake_candidates")
    .select("id")
    .eq("intake_status", "parsed")
    .limit(limit);

  const results: any[] = [];

  for (const c of candidates || []) {
    // Check readiness
    const { data: readiness } = await sb.rpc("check_intake_candidate_readiness", {
      p_candidate_id: c.id,
    });

    if (!readiness?.ready) {
      results.push({ candidate_id: c.id, action: "not_ready", readiness });
      continue;
    }

    // Promote
    const { data: promotion } = await sb.rpc("promote_intake_candidate_to_curriculum", {
      p_candidate_id: c.id,
    });

    results.push({ candidate_id: c.id, ...promotion });
  }

  return json(200, { ok: true, processed: results.length, results }, origin);
});
