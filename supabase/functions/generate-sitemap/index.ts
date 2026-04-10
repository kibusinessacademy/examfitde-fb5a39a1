import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * generate-sitemap – Sitemap Index + per-type XML sitemaps
 *
 * Actions:
 *   index       – Returns sitemap index referencing all sub-sitemaps
 *   blog        – Blog articles sitemap
 *   landing     – SEO landing pages sitemap
 *   products    – Product pages sitemap
 *   static      – Static pages sitemap
 *   berufe      – Berufe + certification catalog sitemap
 *   content     – SEO documents + content pages sitemap
 *   full        – Legacy monolithic sitemap (all URLs)
 *   robots      – Returns robots.txt with sitemap reference
 *   indexnow_key – Returns IndexNow verification key
 */

const SITE_URL = "https://examfit.de";
const FUNCTIONS_URL_BASE = `${SITE_URL}/functions/v1/generate-sitemap`;
const INDEXNOW_KEY = "examfit-indexnow-key-2026";

interface SitemapURL {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
  images?: Array<{ loc: string; title?: string; caption?: string }>;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function toSitemapXML(urls: SitemapURL[]): string {
  const entries = urls.map((u) => {
    let e = `  <url>\n    <loc>${escapeXml(u.loc)}</loc>\n`;
    if (u.lastmod) e += `    <lastmod>${u.lastmod}</lastmod>\n`;
    if (u.changefreq) e += `    <changefreq>${u.changefreq}</changefreq>\n`;
    if (u.priority !== undefined) e += `    <priority>${u.priority.toFixed(1)}</priority>\n`;
    for (const img of u.images || []) {
      e += `    <image:image>\n      <image:loc>${escapeXml(img.loc)}</image:loc>\n`;
      if (img.title) e += `      <image:title>${escapeXml(img.title)}</image:title>\n`;
      if (img.caption) e += `      <image:caption>${escapeXml(img.caption)}</image:caption>\n`;
      e += `    </image:image>\n`;
    }
    return e + `  </url>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries}
</urlset>`;
}

function toSitemapIndex(sitemaps: Array<{ loc: string; lastmod: string }>): string {
  const entries = sitemaps.map(s =>
    `  <sitemap>\n    <loc>${escapeXml(s.loc)}</loc>\n    <lastmod>${s.lastmod}</lastmod>\n  </sitemap>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`;
}

function generateSlug(text: string): string {
  const m: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "ae", Ö: "oe", Ü: "ue" };
  return text.toLowerCase().split("").map(c => m[c] || c).join("")
    .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-")
    .replace(/^-|-$/g, "").substring(0, 80);
}

function xmlResponse(body: string, corsHeaders: Record<string, string>): Response {
  return new Response(body, {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = getCorsHeaders(origin);

  const url = new URL(req.url);
  const action = url.searchParams.get("type") || "index";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const today = new Date().toISOString().split("T")[0];

  try {
    // ── robots.txt ──
    if (action === "robots") {
      const robotsTxt = `User-agent: *
Allow: /

Sitemap: ${FUNCTIONS_URL_BASE}?type=index

# IndexNow Key
# ${SITE_URL}/${INDEXNOW_KEY}.txt
`;
      return new Response(robotsTxt, {
        headers: { ...headers, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
      });
    }

    // ── IndexNow verification key ──
    if (action === "indexnow_key") {
      return new Response(INDEXNOW_KEY, {
        headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // ── Sitemap Index ──
    if (action === "index") {
      const sitemaps = [
        { loc: `${FUNCTIONS_URL_BASE}?type=static`, lastmod: today },
        { loc: `${FUNCTIONS_URL_BASE}?type=berufe`, lastmod: today },
        { loc: `${FUNCTIONS_URL_BASE}?type=blog`, lastmod: today },
        { loc: `${FUNCTIONS_URL_BASE}?type=landing`, lastmod: today },
        { loc: `${FUNCTIONS_URL_BASE}?type=products`, lastmod: today },
        { loc: `${FUNCTIONS_URL_BASE}?type=content`, lastmod: today },
      ];
      return xmlResponse(toSitemapIndex(sitemaps), headers);
    }

    // ── Static pages ──
    if (action === "static") {
      const pages: SitemapURL[] = [
        { loc: `${SITE_URL}/`, lastmod: today, changefreq: "daily", priority: 1.0 },
        { loc: `${SITE_URL}/berufe`, lastmod: today, changefreq: "weekly", priority: 0.9 },
        { loc: `${SITE_URL}/ihk-pruefungen`, lastmod: today, changefreq: "weekly", priority: 0.9 },
        { loc: `${SITE_URL}/lernkurse`, lastmod: today, changefreq: "weekly", priority: 0.9 },
        { loc: `${SITE_URL}/pruefungstrainer`, lastmod: today, changefreq: "weekly", priority: 0.9 },
        { loc: `${SITE_URL}/bundle`, lastmod: today, changefreq: "weekly", priority: 0.9 },
        { loc: `${SITE_URL}/shop`, lastmod: today, changefreq: "weekly", priority: 0.8 },
        { loc: `${SITE_URL}/wissen`, lastmod: today, changefreq: "daily", priority: 0.8 },
        { loc: `${SITE_URL}/blog`, lastmod: today, changefreq: "daily", priority: 0.8 },
        { loc: `${SITE_URL}/preise`, lastmod: today, changefreq: "monthly", priority: 0.7 },
        { loc: `${SITE_URL}/unternehmen`, lastmod: today, changefreq: "monthly", priority: 0.6 },
        { loc: `${SITE_URL}/work`, lastmod: today, changefreq: "weekly", priority: 0.9 },
        { loc: `${SITE_URL}/work/corporate`, lastmod: today, changefreq: "monthly", priority: 0.7 },
        { loc: `${SITE_URL}/pruefungstraining`, lastmod: today, changefreq: "weekly", priority: 0.9 },
        { loc: `${SITE_URL}/pruefungstraining/ausbildung`, lastmod: today, changefreq: "weekly", priority: 0.8 },
        { loc: `${SITE_URL}/pruefungstraining/fachwirt`, lastmod: today, changefreq: "weekly", priority: 0.8 },
        { loc: `${SITE_URL}/pruefungstraining/meister`, lastmod: today, changefreq: "weekly", priority: 0.8 },
        { loc: `${SITE_URL}/pruefungstraining/betriebswirt`, lastmod: today, changefreq: "weekly", priority: 0.8 },
        { loc: `${SITE_URL}/pruefungstraining/sachkunde`, lastmod: today, changefreq: "weekly", priority: 0.8 },
        { loc: `${SITE_URL}/pruefungstraining/aevo`, lastmod: today, changefreq: "weekly", priority: 0.8 },
      ];
      return xmlResponse(toSitemapXML(pages), headers);
    }

    // ── Blog articles ──
    if (action === "blog") {
      const urls: SitemapURL[] = [];
      const { data: articles } = await sb.from("blog_articles")
        .select("slug, title, updated_at, hero_image_url, hero_image_alt, published_at, noindex")
        .eq("status", "published").order("published_at", { ascending: false }).limit(500);
      for (const a of articles || []) {
        if (a.noindex || !a.slug) continue;
        const images: SitemapURL["images"] = [];
        if (a.hero_image_url) images.push({
          loc: a.hero_image_url.startsWith("http") ? a.hero_image_url : `${SITE_URL}${a.hero_image_url}`,
          title: a.title, caption: a.hero_image_alt || undefined,
        });
        urls.push({ loc: `${SITE_URL}/blog/${a.slug}`, lastmod: (a.updated_at || a.published_at || "").split("T")[0] || today, changefreq: "weekly", priority: 0.7, images: images.length ? images : undefined });
      }
      // Also blog_posts table
      const { data: posts } = await sb.from("blog_posts")
        .select("slug, title, updated_at, published_at, noindex, og_image_url")
        .eq("status", "published").order("published_at", { ascending: false }).limit(500);
      for (const p of posts || []) {
        if (p.noindex || !p.slug) continue;
        const images: SitemapURL["images"] = [];
        if (p.og_image_url) images.push({ loc: p.og_image_url.startsWith("http") ? p.og_image_url : `${SITE_URL}${p.og_image_url}`, title: p.title });
        urls.push({ loc: `${SITE_URL}/blog/${p.slug}`, lastmod: (p.updated_at || p.published_at || "").split("T")[0] || today, changefreq: "weekly", priority: 0.7, images: images.length ? images : undefined });
      }
      // Deduplicate by loc
      const seen = new Set<string>();
      const deduped = urls.filter(u => { if (seen.has(u.loc)) return false; seen.add(u.loc); return true; });
      return xmlResponse(toSitemapXML(deduped), headers);
    }

    // ── Landing pages (SEO documents type=landing) ──
    if (action === "landing") {
      const urls: SitemapURL[] = [];
      const { data: docs } = await sb.from("seo_documents")
        .select("slug, updated_at, meta_title, og_image_path, noindex")
        .eq("status", "published").eq("doc_type", "landing").limit(500);
      for (const d of docs || []) {
        if (d.noindex || !d.slug) continue;
        const images: SitemapURL["images"] = [];
        if (d.og_image_path) images.push({ loc: d.og_image_path.startsWith("http") ? d.og_image_path : `${SITE_URL}${d.og_image_path}`, title: d.meta_title || d.slug });
        urls.push({ loc: `${SITE_URL}/pruefungstraining/${d.slug}`, lastmod: (d.updated_at || "").split("T")[0] || today, changefreq: "weekly", priority: 0.8, images: images.length ? images : undefined });
      }
      // Content pages with page_type = landing
      const { data: cp } = await sb.from("content_pages")
        .select("slug, updated_at, meta_title, og_image_url, noindex")
        .eq("status", "published").eq("page_type", "landing").limit(500);
      for (const p of cp || []) {
        if (p.noindex || !p.slug) continue;
        urls.push({ loc: `${SITE_URL}/${p.slug}`, lastmod: (p.updated_at || "").split("T")[0] || today, changefreq: "weekly", priority: 0.8 });
      }
      return xmlResponse(toSitemapXML(urls), headers);
    }

    // ── Products ──
    if (action === "products") {
      const urls: SitemapURL[] = [];
      const { data: products } = await sb.from("products")
        .select("slug, updated_at, title").eq("status", "active").eq("visibility", "public").limit(500);
      for (const p of products || []) {
        if (!p.slug) continue;
        urls.push({ loc: `${SITE_URL}/produkt/${p.slug}`, lastmod: (p.updated_at || "").split("T")[0] || today, changefreq: "weekly", priority: 0.7 });
      }
      const { data: cp } = await sb.from("curriculum_products")
        .select("slug, updated_at").eq("is_published", true).not("slug", "is", null).limit(500);
      for (const c of cp || []) {
        if (!c.slug) continue;
        urls.push({ loc: `${SITE_URL}/produkt/${c.slug}`, lastmod: (c.updated_at || "").split("T")[0] || today, changefreq: "weekly", priority: 0.6 });
      }
      const { data: store } = await sb.from("store_products")
        .select("name, updated_at, image_url").eq("is_active", true).limit(500);
      for (const s of store || []) {
        urls.push({ loc: `${SITE_URL}/shop/${generateSlug(s.name)}`, lastmod: (s.updated_at || "").split("T")[0] || today, changefreq: "weekly", priority: 0.6 });
      }
      return xmlResponse(toSitemapXML(urls), headers);
    }

    // ── Berufe + certifications ──
    if (action === "berufe") {
      const urls: SitemapURL[] = [];
      const { data: berufe } = await sb.from("berufe")
        .select("bezeichnung_kurz, updated_at, ist_aktiv").eq("ist_aktiv", true).limit(500);
      for (const b of berufe || []) {
        const slug = generateSlug(b.bezeichnung_kurz);
        const lm = (b.updated_at || "").split("T")[0] || today;
        urls.push({ loc: `${SITE_URL}/berufe/${slug}`, lastmod: lm, changefreq: "weekly", priority: 0.8 });
        for (const t of ["lernkurs", "pruefungstrainer", "bundle"]) {
          urls.push({ loc: `${SITE_URL}/${t}/${slug}`, lastmod: lm, changefreq: "weekly", priority: 0.7 });
        }
        urls.push({ loc: `${SITE_URL}/ihk-pruefungen/${slug}`, lastmod: lm, changefreq: "weekly", priority: 0.7 });
      }
      const { data: certs } = await sb.from("certification_catalog")
        .select("slug, updated_at").not("slug", "is", null).limit(500);
      for (const c of certs || []) {
        if (!c.slug) continue;
        urls.push({ loc: `${SITE_URL}/pruefungstraining/${c.slug}`, lastmod: (c.updated_at || "").split("T")[0] || today, changefreq: "weekly", priority: 0.7 });
      }
      return xmlResponse(toSitemapXML(urls), headers);
    }

    // ── Content (SEO docs: blog/faq/glossary/cluster + content pages) ──
    if (action === "content") {
      const urls: SitemapURL[] = [];
      const typeMap: Record<string, string> = { blog: "/wissen", faq: "/faq", glossary: "/glossar", cluster: "/wissen", product: "/produkt" };
      const { data: docs } = await sb.from("seo_documents")
        .select("slug, doc_type, updated_at, noindex, og_image_path, meta_title")
        .eq("status", "published").not("doc_type", "eq", "landing").limit(500);
      for (const d of docs || []) {
        if (d.noindex || !d.slug) continue;
        const base = typeMap[d.doc_type] || "/wissen";
        urls.push({ loc: `${SITE_URL}${base}/${d.slug}`, lastmod: (d.updated_at || "").split("T")[0] || today, changefreq: "weekly", priority: 0.6 });
      }
      const { data: cp } = await sb.from("content_pages")
        .select("slug, page_type, updated_at, noindex")
        .eq("status", "published").limit(500);
      for (const p of cp || []) {
        if (p.noindex || !p.slug || p.page_type === "landing") continue;
        urls.push({ loc: `${SITE_URL}/${p.slug}`, lastmod: (p.updated_at || "").split("T")[0] || today, changefreq: "monthly", priority: 0.5 });
      }
      return xmlResponse(toSitemapXML(urls), headers);
    }

    // ── Full (legacy) ──
    if (action === "full") {
      // Redirect to index
      return new Response(null, { status: 301, headers: { ...headers, Location: `${FUNCTIONS_URL_BASE}?type=index` } });
    }

    return new Response(JSON.stringify({ error: `Unknown type: ${action}` }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[generate-sitemap] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } });
  }
});
