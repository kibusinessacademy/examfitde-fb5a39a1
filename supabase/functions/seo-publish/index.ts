// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * SEO Publish – Publish Guard
 * Only publishes if qc_score >= 85 and status = "in_review"
 * Then triggers sitemap regeneration.
 */
Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { document_id } = await req.json();

    if (!document_id) {
      return new Response(JSON.stringify({ error: "document_id required" }), { status: 400, headers });
    }

    const { data: doc, error: docErr } = await admin
      .from("seo_documents")
      .select("id, status, qc_score, title, slug, doc_type")
      .eq("id", document_id)
      .single();

    if (docErr || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), { status: 404, headers });
    }

    // Publish Guard
    if (doc.status !== "in_review") {
      return new Response(JSON.stringify({
        error: `PUBLISH_BLOCKED: Status muss "in_review" sein (aktuell: ${doc.status})`,
      }), { status: 403, headers });
    }

    if ((doc.qc_score || 0) < 85) {
      return new Response(JSON.stringify({
        error: `PUBLISH_BLOCKED: qc_score muss >= 85 sein (aktuell: ${doc.qc_score})`,
      }), { status: 403, headers });
    }

    // Publish
    const now = new Date().toISOString();
    const { error: updateErr } = await admin
      .from("seo_documents")
      .update({
        status: "published",
        published_at: now,
      })
      .eq("id", document_id);

    if (updateErr) throw updateErr;

    // Trigger sitemap refresh (fire-and-forget)
    fetch(`${supabaseUrl}/functions/v1/generate-sitemap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
      body: JSON.stringify({ trigger: "seo-publish", document_id }),
    }).catch(err => console.warn("[seo-publish] Sitemap trigger failed:", err));

    return new Response(JSON.stringify({
      success: true,
      document_id,
      slug: doc.slug,
      published_at: now,
    }), { status: 200, headers });
  } catch (error) {
    console.error("[seo-publish] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers }
    );
  }
});
