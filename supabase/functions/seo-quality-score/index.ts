// Deno.serve is built-in
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = {
    ...getCorsHeaders(origin),
    "Content-Type": "application/json; charset=utf-8",
  };

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Missing env" }), { status: 500, headers });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const slug = (body.slug ?? "").trim();

    if (!slug) {
      return new Response(JSON.stringify({ error: "slug required" }), { status: 400, headers });
    }

    // 1) Resolve slug → certification_catalog_id
    const examSlug = slug.replace("-qualitaet", "-pruefung");
    const { data: seoPage } = await sb
      .from("certification_seo_pages")
      .select("certification_catalog_id, title")
      .eq("slug", examSlug)
      .eq("is_published", true)
      .maybeSingle();

    if (!seoPage?.certification_catalog_id) {
      return new Response(JSON.stringify({ data: null }), { status: 200, headers });
    }

    // 2) Get quality summary via RPC
    const { data: qualityData, error: rpcError } = await sb.rpc(
      "get_quality_public_summary",
      { p_certification_id: seoPage.certification_catalog_id }
    );

    if (rpcError) {
      return new Response(JSON.stringify({ error: rpcError.message }), { status: 500, headers });
    }

    const result = qualityData
      ? { ...qualityData, title: seoPage.title }
      : null;

    return new Response(JSON.stringify({ data: result }), { status: 200, headers });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String((e as Error)?.message ?? e) }),
      { status: 500, headers }
    );
  }
});
