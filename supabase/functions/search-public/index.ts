import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const body = await req.json().catch(() => ({}));
    const q = String(body?.q ?? "").trim();
    const limit = Math.max(1, Math.min(Number(body?.limit ?? 10), 25));
    const types = Array.isArray(body?.types) ? body.types : ["beruf", "seo", "course"];

    if (!q || q.length < 2) {
      return new Response(JSON.stringify({ success: true, q, results: [] }), { headers });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase.rpc("search_public", {
      q,
      lim: limit,
      types,
    });

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, q, results: data ?? [] }), { headers });
  } catch (e) {
    console.error("[search-public] error", e);
    return new Response(
      JSON.stringify({ success: false, error: String((e as Error)?.message || e) }),
      { status: 500, headers }
    );
  }
});
