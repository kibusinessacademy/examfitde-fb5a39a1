import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { requireAdmin } from "../_shared/adminGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    // P0 Security: central admin guard
    const guard = await requireAdmin(req);
    if (guard instanceof Response) return guard;
    const adminSb = guard.sb;

    // Fetch matrix data
    const { data, error } = await adminSb
      .from("admin_elite_matrix_v")
      .select("*")
      .order("col", { ascending: true });

    if (error) throw error;

    return json({ ok: true, rows: data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, 500);
  }
});
