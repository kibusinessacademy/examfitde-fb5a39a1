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
  const minReadiness = Number(body.min_readiness ?? 70);

  const results: Record<string, unknown> = {};

  // Step 1: Build catalog entries from parsed candidates
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const catalogRes = await fetch(`${supabaseUrl}/functions/v1/qualification-build-catalog-entry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
    body: JSON.stringify({ limit: 20 }),
  });
  results.catalog = await catalogRes.json().catch(() => ({}));

  // Step 2: Build curriculum drafts from catalog
  const draftRes = await fetch(`${supabaseUrl}/functions/v1/qualification-build-curriculum-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
    body: JSON.stringify({ limit: 20 }),
  });
  results.drafts = await draftRes.json().catch(() => ({}));

  // Step 3: Sync wave candidates
  const { data: syncData, error: syncErr } = await sb.rpc("sync_qualification_wave_candidates", {
    p_min_readiness: minReadiness,
  });
  results.wave_sync = syncErr ? { error: syncErr.message } : syncData;

  return json(200, { ok: true, ...results }, origin);
});
