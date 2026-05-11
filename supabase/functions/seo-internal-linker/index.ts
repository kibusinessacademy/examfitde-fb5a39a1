// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * SEO Internal Linker
 * Builds link graph between SEO documents, Berufe pages, and product pages.
 * Inserts relevant internal links into content_md.
 */
Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { document_id, mode } = await req.json();

    // Mode: "single" (one doc) or "batch" (all published docs)
    const isBatch = mode === "batch";

    let documents: Array<{ id: string; content_md: string; doc_type: string; beruf_id: string | null; slug: string; title: string }> = [];

    if (isBatch) {
      const { data } = await admin
        .from("seo_documents")
        .select("id, content_md, doc_type, beruf_id, slug, title")
        .eq("status", "published")
        .limit(200);
      documents = data || [];
    } else if (document_id) {
      const { data } = await admin
        .from("seo_documents")
        .select("id, content_md, doc_type, beruf_id, slug, title")
        .eq("id", document_id)
        .single();
      if (data) documents = [data];
    } else {
      return new Response(JSON.stringify({ error: "document_id or mode=batch required" }), { status: 400, headers });
    }

    // Load all published docs for link targets
    const { data: allDocs } = await admin
      .from("seo_documents")
      .select("id, slug, title, doc_type, beruf_id")
      .eq("status", "published")
      .limit(500);

    // Load berufe for cross-linking
    const { data: berufe } = await admin
      .from("berufe")
      .select("id, bezeichnung_kurz")
      .eq("ist_aktiv", true)
      .limit(200);

    const berufMap = new Map((berufe || []).map(b => [b.id, b.bezeichnung_kurz]));

    // URL mapping by doc_type
    const docTypeUrlMap: Record<string, string> = {
      blog: "/wissen",
      landing: "/pruefungstraining",
      faq: "/faq",
      glossary: "/glossar",
      product: "/produkt",
      cluster: "/wissen",
    };

    let updated = 0;
    const linkReport: Array<{ doc_id: string; links_added: number }> = [];

    for (const doc of documents) {
      let content = doc.content_md || "";
      const linksAdded: Array<{ anchor: string; url: string }> = [];

      // 1) Link to related SEO docs (same beruf, different type)
      if (doc.beruf_id && allDocs) {
        const related = allDocs.filter(d =>
          d.id !== doc.id &&
          d.beruf_id === doc.beruf_id &&
          d.doc_type !== doc.doc_type
        );

        for (const rel of related.slice(0, 3)) {
          const baseUrl = docTypeUrlMap[rel.doc_type] || "/wissen";
          const linkUrl = `${baseUrl}/${rel.slug}`;
          const anchor = rel.title;

          // Only add if not already linked
          if (!content.includes(linkUrl) && !content.includes(`](${linkUrl})`)) {
            // Find a good insertion point (after the first H2)
            const h2Match = content.match(/^## .+$/m);
            if (h2Match && h2Match.index !== undefined) {
              const afterH2 = content.indexOf("\n", h2Match.index + h2Match[0].length);
              if (afterH2 !== -1) {
                // Find end of next paragraph
                const nextParagraphEnd = content.indexOf("\n\n", afterH2 + 1);
                if (nextParagraphEnd !== -1) {
                  const insertPos = nextParagraphEnd;
                  const linkText = `\n\n> 💡 **Tipp:** Lies auch unseren Artikel [${anchor}](${linkUrl}) für weitere Informationen.`;
                  content = content.slice(0, insertPos) + linkText + content.slice(insertPos);
                  linksAdded.push({ anchor, url: linkUrl });
                }
              }
            }
          }
        }
      }

      // 2) Link to Beruf detail page
      if (doc.beruf_id && berufMap.has(doc.beruf_id)) {
        const berufName = berufMap.get(doc.beruf_id)!;
        const berufSlug = generateSlug(berufName);
        const berufUrl = `/berufe/${berufSlug}`;

        if (!content.includes(berufUrl)) {
          // Replace first mention of beruf name with link
          const berufRegex = new RegExp(`(?<!\\[)${escapeRegex(berufName)}(?!\\])(?!\\()`, "i");
          if (berufRegex.test(content)) {
            content = content.replace(berufRegex, `[${berufName}](${berufUrl})`);
            linksAdded.push({ anchor: berufName, url: berufUrl });
          }
        }
      }

      // 3) Link to shop/product page
      if (!content.includes("/shop") && doc.doc_type !== "product") {
        // Add shop CTA at the end if not present
        if (!content.includes("Prüfungstraining starten")) {
          content += `\n\n---\n\n**Bereit für die Prüfung?** [Entdecke unser Prüfungstraining](/shop) und starte optimal vorbereitet in deine Abschlussprüfung.`;
          linksAdded.push({ anchor: "Prüfungstraining", url: "/shop" });
        }
      }

      // Update document if links were added
      if (linksAdded.length > 0) {
        await admin.from("seo_documents").update({
          content_md: content,
          internal_links: linksAdded,
        }).eq("id", doc.id);
        updated++;
      }

      linkReport.push({ doc_id: doc.id, links_added: linksAdded.length });
    }

    // Result-Shape Contract (content-runner classifier):
    //   ok=true + (generated>0 || batch_complete=true) → completed
    //   else → EMPTY_RESULT (DLQ via fn_drain_stuck_empty_result_growth_jobs)
    // Linker batch is finite — once we processed the published-doc snapshot,
    // there is nothing left to do, so batch_complete=true with remaining=0.
    const totalLinks = linkReport.reduce((sum, r) => sum + r.links_added, 0);
    return new Response(JSON.stringify({
      ok: true,
      generated: totalLinks,
      batch_complete: true,
      remaining: 0,
      documents_processed: documents.length,
      documents_updated: updated,
      report: linkReport,
    }), { status: 200, headers });
  } catch (error) {
    console.error("[seo-internal-linker] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers }
    );
  }
});

function generateSlug(text: string): string {
  const charMap: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "ae", Ö: "oe", Ü: "ue" };
  return text.toLowerCase().split("").map(c => charMap[c] || c).join("")
    .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").substring(0, 80);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
