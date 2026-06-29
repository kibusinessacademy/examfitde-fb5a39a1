// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * SEO Internal Linker
 * Builds link graph between SEO documents, Berufe pages, and product pages.
 * Inserts relevant internal links into content_md AND upserts them as SSOT
 * rows into seo_internal_link_suggestions (F2.b).
 *
 * SSOT-Write contract (F2.b, depends on F2.a schema hardening):
 *   - Conflict-Key: (source_url, target_url, link_type)
 *   - status='active' on insert/update
 *   - Rows with status='rejected' are NEVER revived (filtered before upsert)
 *   - source_doc_id set when known
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

    // Load active backlink rules → preferred targets per beruf (priority asc)
    const { data: backlinkRules } = await admin
      .from("seo_beruf_backlink_rules")
      .select("beruf_id, target_url, target_label, anchor_hint, priority, max_links_per_doc, link_type")
      .eq("is_active", true)
      .order("priority", { ascending: true })
      .limit(500);

    const rulesByBeruf = new Map<string, typeof backlinkRules>();
    for (const r of backlinkRules ?? []) {
      if (!r.beruf_id) continue;
      const arr = rulesByBeruf.get(r.beruf_id) ?? [];
      arr.push(r);
      rulesByBeruf.set(r.beruf_id, arr);
    }

    // URL mapping by doc_type
    const docTypeUrlMap: Record<string, string> = {
      blog: "/wissen",
      landing: "/pruefungstraining",
      faq: "/faq",
      glossary: "/glossar",
      product: "/produkt",
      cluster: "/wissen",
    };

    const docUrlFor = (d: { doc_type: string; slug: string }) =>
      `${docTypeUrlMap[d.doc_type] || "/wissen"}/${d.slug}`;

    // Per-link record we will upsert into seo_internal_link_suggestions
    type LinkRow = {
      source_url: string;
      target_url: string;
      link_type: string;
      anchor_text: string;
      source_title: string | null;
      target_title: string | null;
      source_doc_id: string | null;
      target_doc_id: string | null;
    };

    let updated = 0;
    const linkReport: Array<{ doc_id: string; links_added: number }> = [];
    const allLinkRows: LinkRow[] = [];

    for (const doc of documents) {
      let content = doc.content_md || "";
      const linksAdded: Array<{ anchor: string; url: string }> = [];
      const docLinkRows: LinkRow[] = [];
      const sourceUrl = docUrlFor(doc);

      // 1) Link to related SEO docs (same beruf, different type) → cluster_to_cluster
      if (doc.beruf_id && allDocs) {
        const related = allDocs.filter(d =>
          d.id !== doc.id &&
          d.beruf_id === doc.beruf_id &&
          d.doc_type !== doc.doc_type
        );

        for (const rel of related.slice(0, 3)) {
          const linkUrl = docUrlFor(rel);
          const anchor = rel.title;

          if (!content.includes(linkUrl) && !content.includes(`](${linkUrl})`)) {
            const h2Match = content.match(/^## .+$/m);
            if (h2Match && h2Match.index !== undefined) {
              const afterH2 = content.indexOf("\n", h2Match.index + h2Match[0].length);
              if (afterH2 !== -1) {
                const nextParagraphEnd = content.indexOf("\n\n", afterH2 + 1);
                if (nextParagraphEnd !== -1) {
                  const insertPos = nextParagraphEnd;
                  const linkText = `\n\n> 💡 **Tipp:** Lies auch unseren Artikel [${anchor}](${linkUrl}) für weitere Informationen.`;
                  content = content.slice(0, insertPos) + linkText + content.slice(insertPos);
                  linksAdded.push({ anchor, url: linkUrl });
                  docLinkRows.push({
                    source_url: sourceUrl,
                    target_url: linkUrl,
                    link_type: "cluster_to_cluster",
                    anchor_text: anchor,
                    source_title: doc.title,
                    target_title: rel.title,
                    source_doc_id: doc.id,
                    target_doc_id: rel.id,
                  });
                }
              }
            }
          }
        }
      }

      // 2) Link to Beruf detail page → cluster_to_pillar
      if (doc.beruf_id && berufMap.has(doc.beruf_id)) {
        const berufName = berufMap.get(doc.beruf_id)!;
        const berufSlug = generateSlug(berufName);
        const berufUrl = `/berufe/${berufSlug}`;

        if (!content.includes(berufUrl)) {
          const berufRegex = new RegExp(`(?<!\\[)${escapeRegex(berufName)}(?!\\])(?!\\()`, "i");
          if (berufRegex.test(content)) {
            content = content.replace(berufRegex, `[${berufName}](${berufUrl})`);
            linksAdded.push({ anchor: berufName, url: berufUrl });
            docLinkRows.push({
              source_url: sourceUrl,
              target_url: berufUrl,
              link_type: "cluster_to_pillar",
              anchor_text: berufName,
              source_title: doc.title,
              target_title: berufName,
              source_doc_id: doc.id,
              target_doc_id: null,
            });
          }
        }
      }

      // 2b) Preferred backlink rules per Beruf (admin-curated, priority asc)
      if (doc.beruf_id && rulesByBeruf.has(doc.beruf_id)) {
        const rules = rulesByBeruf.get(doc.beruf_id) ?? [];
        let appended = 0;
        for (const rule of rules) {
          if (!rule.target_url || content.includes(rule.target_url)) continue;
          const anchor = rule.anchor_hint || rule.target_label || rule.target_url;
          const cap = Math.max(1, rule.max_links_per_doc ?? 1);
          if (appended >= cap) break;
          content += `\n\n→ Empfohlen: [${anchor}](${rule.target_url})`;
          linksAdded.push({ anchor, url: rule.target_url });
          docLinkRows.push({
            source_url: sourceUrl,
            target_url: rule.target_url,
            link_type: rule.link_type || "rule_curated",
            anchor_text: anchor,
            source_title: doc.title,
            target_title: rule.target_label ?? anchor,
            source_doc_id: doc.id,
            target_doc_id: null,
          });
          appended++;
        }
      }


      // 3) Link to shop/product page → cluster_to_product
      if (!content.includes("/shop") && doc.doc_type !== "product") {
        if (!content.includes("Prüfungstraining starten")) {
          content += `\n\n---\n\n**Bereit für die Prüfung?** [Entdecke unser Prüfungstraining](/shop) und starte optimal vorbereitet in deine Abschlussprüfung.`;
          linksAdded.push({ anchor: "Prüfungstraining", url: "/shop" });
          docLinkRows.push({
            source_url: sourceUrl,
            target_url: "/shop",
            link_type: "cluster_to_product",
            anchor_text: "Prüfungstraining",
            source_title: doc.title,
            target_title: "Prüfungstraining Shop",
            source_doc_id: doc.id,
            target_doc_id: null,
          });
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

      allLinkRows.push(...docLinkRows);
      linkReport.push({ doc_id: doc.id, links_added: linksAdded.length });
    }

    // ---- F2.b: SSOT-Upsert into seo_internal_link_suggestions ----
    // Conflict-Key: (source_url, target_url, link_type)
    // Filter rejected rows BEFORE upsert (never auto-revive).
    let upserted = 0;
    let skippedRejected = 0;

    if (allLinkRows.length > 0) {
      // Pull existing rejected keys for this batch
      const sourceUrls = Array.from(new Set(allLinkRows.map(r => r.source_url)));
      const targetUrls = Array.from(new Set(allLinkRows.map(r => r.target_url)));
      const { data: rejectedRows } = await admin
        .from("seo_internal_link_suggestions")
        .select("source_url, target_url, link_type")
        .eq("status", "rejected")
        .in("source_url", sourceUrls)
        .in("target_url", targetUrls);

      const rejectedKey = new Set(
        (rejectedRows || []).map(r => `${r.source_url}\u0001${r.target_url}\u0001${r.link_type}`)
      );

      const upsertable = allLinkRows.filter(r => {
        const k = `${r.source_url}\u0001${r.target_url}\u0001${r.link_type}`;
        if (rejectedKey.has(k)) {
          skippedRejected++;
          return false;
        }
        return true;
      });

      if (upsertable.length > 0) {
        const payload = upsertable.map(r => ({
          source_url: r.source_url,
          target_url: r.target_url,
          link_type: r.link_type,
          anchor_text: r.anchor_text,
          source_title: r.source_title,
          target_title: r.target_title,
          source_doc_id: r.source_doc_id,
          target_doc_id: r.target_doc_id,
          status: "active",
          reason: "auto:internal-linker",
          updated_at: new Date().toISOString(),
        }));

        const { error: upErr, count } = await admin
          .from("seo_internal_link_suggestions")
          .upsert(payload, {
            onConflict: "source_url,target_url,link_type",
            ignoreDuplicates: false,
            count: "exact",
          });

        if (upErr) {
          console.error("[seo-internal-linker] upsert error:", upErr);
        } else {
          upserted = count ?? upsertable.length;
        }
      }
    }

    // ---- Audit ----
    await admin.from("auto_heal_log").insert({
      action_type: "seo_internal_linker_run",
      target_type: "system",
      result_status: "ok",
      trigger_source: isBatch ? "batch" : "single",
      metadata: {
        mode: isBatch ? "batch" : "single",
        documents_processed: documents.length,
        documents_updated: updated,
        suggestions_upserted: upserted,
        suggestions_skipped_rejected: skippedRejected,
        total_links_generated: allLinkRows.length,
      },
    });

    // ---- Result-Shape (UNCHANGED — F2 contract from sitemap-decommission-and-linker-result-shape-v1) ----
    // ok=true + (generated>0 || batch_complete=true) → completed
    // else → EMPTY_RESULT (DLQ via fn_drain_stuck_empty_result_growth_jobs)
    const totalLinks = linkReport.reduce((sum, r) => sum + r.links_added, 0);
    return new Response(JSON.stringify({
      ok: true,
      generated: totalLinks,
      batch_complete: true,
      remaining: 0,
      documents_processed: documents.length,
      documents_updated: updated,
      suggestions_upserted: upserted,
      suggestions_skipped_rejected: skippedRejected,
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
