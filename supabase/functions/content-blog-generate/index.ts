import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * DEPRECATED: This function is replaced by generate-blog-article.
 * All calls are forwarded to the new pipeline which includes:
 * - AI detection quality gates
 * - Hero image generation
 * - Internal link building
 * - FAQ generation
 * - IndexNow pinging
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const body = await req.json().catch(() => ({}));

    // Forward to the new pipeline
    const newUrl = `${supabaseUrl}/functions/v1/generate-blog-article`;
    const resp = await fetch(newUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: req.headers.get("Authorization") || "",
        apikey: req.headers.get("apikey") || "",
      },
      body: JSON.stringify({
        mode: "batch",
        batch_size: Math.min(body.count || 5, 10),
      }),
    });

    const data = await resp.json();
    return new Response(JSON.stringify({
      ...data,
      _notice: "DEPRECATED: Use generate-blog-article instead. This function forwards to the new pipeline.",
    }), {
      status: resp.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("content-blog-generate (deprecated) error:", e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : "Unknown error",
      _notice: "DEPRECATED: Use generate-blog-article instead.",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
