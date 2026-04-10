import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * seo-refresh-feeds – RSS/Atom feed generation for published content
 *
 * Query params:
 *   feed=blog       – Blog articles RSS
 *   feed=landing    – Landing pages RSS
 *   feed=latest     – Latest published content (all types)
 *   feed=atom_blog  – Atom format for blog
 *   format=json     – Returns feed metadata as JSON (for admin)
 */

const SITE_URL = "https://examfit.de";
const FEED_TITLE = "ExamFit – Prüfungsvorbereitung & Wissen";
const FEED_DESCRIPTION = "Aktuelle Artikel, Landingpages und Wissensressourcen von ExamFit.de";
const MAX_FEED_ITEMS = 50;

interface FeedItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid: string;
  category?: string;
  author?: string;
}

function toRssXML(items: FeedItem[], title: string, description: string, feedUrl: string): string {
  const now = new Date().toUTCString();
  const entries = items.map(i => `    <item>
      <title><![CDATA[${i.title}]]></title>
      <link>${escapeXml(i.link)}</link>
      <description><![CDATA[${i.description}]]></description>
      <pubDate>${new Date(i.pubDate).toUTCString()}</pubDate>
      <guid isPermaLink="true">${escapeXml(i.guid)}</guid>
      ${i.category ? `<category><![CDATA[${i.category}]]></category>` : ""}
      ${i.author ? `<author>${escapeXml(i.author)}</author>` : ""}
    </item>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${SITE_URL}</link>
    <description>${escapeXml(description)}</description>
    <language>de-de</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
    <generator>ExamFit SEO Engine</generator>
${entries}
  </channel>
</rss>`;
}

function toAtomXML(items: FeedItem[], title: string, feedUrl: string): string {
  const now = new Date().toISOString();
  const entries = items.map(i => `  <entry>
    <title><![CDATA[${i.title}]]></title>
    <link href="${escapeXml(i.link)}" rel="alternate"/>
    <id>${escapeXml(i.guid)}</id>
    <updated>${new Date(i.pubDate).toISOString()}</updated>
    <summary><![CDATA[${i.description}]]></summary>
    ${i.author ? `<author><name>${escapeXml(i.author)}</name></author>` : ""}
    ${i.category ? `<category term="${escapeXml(i.category)}"/>` : ""}
  </entry>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(title)}</title>
  <link href="${SITE_URL}" rel="alternate"/>
  <link href="${escapeXml(feedUrl)}" rel="self"/>
  <id>${SITE_URL}/</id>
  <updated>${now}</updated>
  <generator>ExamFit SEO Engine</generator>
${entries}
</feed>`;
}

function escapeXml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  const url = new URL(req.url);
  const feed = url.searchParams.get("feed") || "blog";
  const format = url.searchParams.get("format");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const items: FeedItem[] = [];
    const feedUrl = `${req.url}`;

    if (feed === "blog" || feed === "atom_blog" || feed === "latest") {
      // Blog articles
      const { data: articles } = await sb.from("blog_articles")
        .select("slug, title, meta_description, category, author_name, published_at, updated_at, noindex, status")
        .eq("status", "published").order("published_at", { ascending: false }).limit(MAX_FEED_ITEMS);
      for (const a of articles || []) {
        if (a.noindex || !a.slug) continue;
        items.push({
          title: a.title, link: `${SITE_URL}/blog/${a.slug}`,
          description: a.meta_description || a.title,
          pubDate: a.published_at || a.updated_at,
          guid: `${SITE_URL}/blog/${a.slug}`,
          category: a.category || undefined, author: a.author_name || undefined,
        });
      }
      // blog_posts table
      const { data: posts } = await sb.from("blog_posts")
        .select("slug, title, meta_description, category, author_name, published_at, updated_at, noindex, status")
        .eq("status", "published").order("published_at", { ascending: false }).limit(MAX_FEED_ITEMS);
      for (const p of posts || []) {
        if (p.noindex || !p.slug) continue;
        if (items.some(i => i.guid === `${SITE_URL}/blog/${p.slug}`)) continue; // dedupe
        items.push({
          title: p.title, link: `${SITE_URL}/blog/${p.slug}`,
          description: p.meta_description || p.title,
          pubDate: p.published_at || p.updated_at,
          guid: `${SITE_URL}/blog/${p.slug}`,
          category: p.category || undefined, author: p.author_name || undefined,
        });
      }
    }

    if (feed === "landing" || feed === "latest") {
      const { data: docs } = await sb.from("seo_documents")
        .select("slug, meta_title, meta_description, published_at, updated_at, noindex, status")
        .eq("status", "published").eq("doc_type", "landing")
        .order("published_at", { ascending: false }).limit(MAX_FEED_ITEMS);
      for (const d of docs || []) {
        if (d.noindex || !d.slug) continue;
        items.push({
          title: d.meta_title || d.slug, link: `${SITE_URL}/pruefungstraining/${d.slug}`,
          description: d.meta_description || d.meta_title || d.slug,
          pubDate: d.published_at || d.updated_at,
          guid: `${SITE_URL}/pruefungstraining/${d.slug}`,
        });
      }
    }

    if (feed === "latest") {
      // SEO documents (non-landing)
      const { data: docs } = await sb.from("seo_documents")
        .select("slug, doc_type, meta_title, meta_description, published_at, updated_at, noindex")
        .eq("status", "published").not("doc_type", "eq", "landing")
        .order("updated_at", { ascending: false }).limit(30);
      const typeMap: Record<string, string> = { blog: "/wissen", faq: "/faq", glossary: "/glossar", cluster: "/wissen" };
      for (const d of docs || []) {
        if (d.noindex || !d.slug) continue;
        const base = typeMap[d.doc_type] || "/wissen";
        const link = `${SITE_URL}${base}/${d.slug}`;
        if (items.some(i => i.guid === link)) continue;
        items.push({
          title: d.meta_title || d.slug, link,
          description: d.meta_description || d.meta_title || d.slug,
          pubDate: d.published_at || d.updated_at, guid: link,
        });
      }
    }

    // Sort by pubDate desc, limit
    items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    const limited = items.slice(0, MAX_FEED_ITEMS);

    // JSON format for admin
    if (format === "json") {
      // Log feed refresh
      await sb.from("seo_submission_logs").insert({
        provider: "feed_refresh", source_type: "system",
        source_id: "00000000-0000-0000-0000-000000000000",
        url: feedUrl, action: "refresh", status: "success",
        submitted_at: new Date().toISOString(),
      }).then(() => {});

      return new Response(JSON.stringify({
        ok: true, feed, item_count: limited.length,
        items: limited.map(i => ({ title: i.title, link: i.link, pubDate: i.pubDate, category: i.category })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Atom format
    if (feed === "atom_blog") {
      return new Response(toAtomXML(limited, `${FEED_TITLE} – Blog`, feedUrl), {
        headers: { ...corsHeaders, "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "public, max-age=1800" },
      });
    }

    // RSS format
    const title = feed === "blog" ? `${FEED_TITLE} – Blog` : feed === "landing" ? `${FEED_TITLE} – Landingpages` : FEED_TITLE;
    return new Response(toRssXML(limited, title, FEED_DESCRIPTION, feedUrl), {
      headers: { ...corsHeaders, "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=1800" },
    });
  } catch (err) {
    console.error("[seo-refresh-feeds] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
