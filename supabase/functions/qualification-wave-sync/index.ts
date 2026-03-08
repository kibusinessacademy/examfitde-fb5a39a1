import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const minReadiness = Number(body.min_readiness ?? 60);

  const { data: syncResult, error: syncErr } = await sb.rpc("sync_qualification_wave_candidates", {
    p_min_readiness: minReadiness,
  });

  if (syncErr) return json(500, { error: syncErr.message });

  const { data: readyCandidates } = await sb
    .from("qualification_wave_candidates")
    .select(`
      *,
      qualification_catalog:qualification_catalog_id(*),
      draft:draft_id(*)
    `)
    .eq("candidate_status", "ready")
    .order("promotion_priority", { ascending: false })
    .limit(50);

  return json(200, {
    ok: true,
    sync: syncResult,
    ready_candidates: readyCandidates || [],
  });
});
