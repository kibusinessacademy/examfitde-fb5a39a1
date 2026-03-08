import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

  const { data: qualifications, error } = await sb
    .from("qualification_catalog")
    .select("id")
    .eq("active", true)
    .limit(500);

  if (error) return json(500, { error: error.message });

  const results = [];
  for (const q of qualifications || []) {
    const { data } = await sb.rpc("compute_curriculum_unit_economics", {
      p_qualification_catalog_id: q.id,
    });
    results.push(data);
  }

  return json(200, { ok: true, processed: results.length, results });
});
