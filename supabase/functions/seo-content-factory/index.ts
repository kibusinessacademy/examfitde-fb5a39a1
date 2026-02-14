import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * SEO Content Factory – Orchestrator
 * Generates 7 SEO pages per certification:
 * 1x Landing, 3x Blog/SEO-Artikel, 1x Musterfragen, 1x Prüfungssimulation, 1x FAQ-Hub
 *
 * Modes:
 * - single: Generate pages for one certification (certification_id required)
 * - batch:  Generate for all certifications missing pages (limit = batch_size)
 */
serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const { certification_id, mode = "single", batch_size = 3 } = body;

    // Template keys for the 7-page set
    const PAGE_SET: Array<{ template_key: string; doc_type: string; label: string }> = [
      { template_key: "landing_pruefungstraining_v1", doc_type: "landing", label: "Landingpage" },
      { template_key: "blog_pruefungstipps_v1", doc_type: "blog", label: "Blog: Prüfungstipps" },
      { template_key: "blog_pruefungsfehler_v1", doc_type: "blog", label: "Blog: Häufige Fehler" },
      { template_key: "blog_pruefungsvorbereitung_v1", doc_type: "blog", label: "Blog: Vorbereitung" },
      { template_key: "musterfragen_v1", doc_type: "landing", label: "Musterfragen-Seite" },
      { template_key: "pruefungssimulation_v1", doc_type: "landing", label: "Prüfungssimulation-Seite" },
      { template_key: "faq_hub_v1", doc_type: "faq", label: "FAQ-Hub" },
    ];

    if (mode === "single" && !certification_id) {
      return new Response(JSON.stringify({ error: "certification_id required for single mode" }), { status: 400, headers });
    }

    // Determine which certifications to process
    let certIds: string[] = [];

    if (mode === "single") {
      certIds = [certification_id];
    } else {
      // Find certifications that don't have all 7 pages yet
      const { data: certs } = await admin
        .from("certification_catalog")
        .select("id, title, slug")
        .order("priority_score", { ascending: false })
        .limit(50);

      if (!certs || certs.length === 0) {
        return new Response(JSON.stringify({ message: "No certifications found" }), { status: 200, headers });
      }

      // Check which already have SEO docs
      const { data: existingDocs } = await admin
        .from("seo_documents")
        .select("product_key")
        .in("product_key", certs.map(c => `cert_${c.id}`));

      const existingSet = new Set((existingDocs || []).map(d => d.product_key));

      certIds = certs
        .filter(c => !existingSet.has(`cert_${c.id}`))
        .slice(0, batch_size)
        .map(c => c.id);
    }

    if (certIds.length === 0) {
      return new Response(JSON.stringify({ message: "All certifications already have SEO pages" }), { status: 200, headers });
    }

    // Process each certification
    const results: Array<{ certification_id: string; triggered: number; errors: string[] }> = [];

    for (const certId of certIds) {
      const { data: cert } = await admin
        .from("certification_catalog")
        .select("id, title, slug, catalog_type, chamber_type")
        .eq("id", certId)
        .single();

      if (!cert) {
        results.push({ certification_id: certId, triggered: 0, errors: ["Certification not found"] });
        continue;
      }

      let triggered = 0;
      const errors: string[] = [];

      for (const page of PAGE_SET) {
        // Check if template exists
        const { data: template } = await admin
          .from("seo_templates")
          .select("id")
          .eq("template_key", page.template_key)
          .eq("is_active", true)
          .maybeSingle();

        if (!template) {
          // Skip missing templates silently
          continue;
        }

        // Check if document already exists for this cert + template
        const { data: existingDoc } = await admin
          .from("seo_documents")
          .select("id")
          .eq("product_key", `cert_${certId}`)
          .eq("doc_type", page.doc_type)
          .ilike("title", `%${cert.title}%`)
          .limit(1);

        if (existingDoc && existingDoc.length > 0) {
          continue; // Already exists
        }

        // Trigger seo-generate
        try {
          const genUrl = `${supabaseUrl}/functions/v1/seo-generate`;
          const resp = await fetch(genUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              template_key: page.template_key,
              product_key: `cert_${certId}`,
              extra_context: {
                thema: cert.title,
                beruf: cert.title,
                chamber: cert.chamber_type || "IHK",
                catalog_type: cert.catalog_type,
                slug: cert.slug,
              },
            }),
          });

          if (resp.ok) {
            triggered++;
          } else {
            const errBody = await resp.json().catch(() => ({ error: "Unknown" }));
            errors.push(`${page.label}: ${errBody.error || resp.status}`);
          }
        } catch (e) {
          errors.push(`${page.label}: ${e instanceof Error ? e.message : "fetch failed"}`);
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 2000));
      }

      results.push({ certification_id: certId, triggered, errors });
    }

    return new Response(JSON.stringify({
      success: true,
      processed: results.length,
      results,
    }), { status: 200, headers });
  } catch (error) {
    console.error("[seo-content-factory] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers }
    );
  }
});
