import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * generate-sitemap-index – Generates sitemap-index.xml with split sitemaps
 * 
 * /sitemap.xml → sitemap index
 * /sitemap.xml?type=static → static pages
 * /sitemap.xml?type=blog → blog articles
 * /sitemap.xml?type=berufe → profession pages
 * /sitemap.xml?type=products → store products + curriculum products
 * /sitemap.xml?type=seo → SEO documents
 * /sitemap.xml?type=training → Prüfungstraining pages
 */

const SITE_URL = "https://examfit.de";

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function generateSlug(text: string): string {
  const charMap: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "ae", Ö: "oe", Ü: "ue" };
  return text.toLowerCase().split("").map(c => charMap[c] || c).join("")
    .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").substring(0, 80);
}

interface SitemapURL {
  loc: string; lastmod?: string; changefreq?: string; priority?: number;
  images?: Array<{ loc: string; title?: string; caption?: string }>;
}

function renderSitemap(urls: SitemapURL[]): string {
  const entries = urls.map(u => {
    let e = `  <url>\n    <loc>${escapeXml(u.loc)}</loc>\n`;
    if (u.lastmod) e += `    <lastmod>${u.lastmod}</lastmod>\n`;
    if (u.changefreq) e += `    <changefreq>${u.changefreq}</changefreq>\n`;
    if (u.priority !== undefined) e += `    <priority>${u.priority.toFixed(1)}</priority>\n`;
    if (u.images) {
      for (const img of u.images) {
        e += `    <image:image>\n      <image:loc>${escapeXml(img.loc)}</image:loc>\n`;
        if (img.title) e += `      <image:title>${escapeXml(img.title)}</image:title>\n`;
        if (img.caption) e += `      <image:caption>${escapeXml(img.caption)}</image:caption>\n`;
        e += `    </image:image>\n`;
      }
    }
    return e + `  </url>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries}
</urlset>`;
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  const xmlHeaders = { ...corsHeaders, "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=86400" };

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);
    const today = new Date().toISOString().split("T")[0];

    // If no type → return sitemap index
    if (!type) {
      const sitemapFnUrl = `${supabaseUrl}/functions/v1/generate-sitemap-index`;
      const index = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${sitemapFnUrl}?type=static</loc><lastmod>${today}</lastmod></sitemap>
  <sitemap><loc>${sitemapFnUrl}?type=blog</loc><lastmod>${today}</lastmod></sitemap>
  <sitemap><loc>${sitemapFnUrl}?type=berufe</loc><lastmod>${today}</lastmod></sitemap>
  <sitemap><loc>${sitemapFnUrl}?type=products</loc><lastmod>${today}</lastmod></sitemap>
  <sitemap><loc>${sitemapFnUrl}?type=seo</loc><lastmod>${today}</lastmod></sitemap>
  <sitemap><loc>${sitemapFnUrl}?type=training</loc><lastmod>${today}</lastmod></sitemap>
</sitemapindex>`;
      return new Response(index, { headers: xmlHeaders });
    }

    const urls: SitemapURL[] = [];

    switch (type) {
      case "static": {
        const pages = [
          { path: "/", priority: 1.0, changefreq: "daily" },
          { path: "/berufe", priority: 0.9, changefreq: "weekly" },
          { path: "/ihk-pruefungen", priority: 0.9, changefreq: "weekly" },
          { path: "/lernkurse", priority: 0.9, changefreq: "weekly" },
          { path: "/pruefungstrainer", priority: 0.9, changefreq: "weekly" },
          { path: "/bundle", priority: 0.9, changefreq: "weekly" },
          { path: "/shop", priority: 0.8, changefreq: "weekly" },
          { path: "/wissen", priority: 0.8, changefreq: "daily" },
          { path: "/blog", priority: 0.8, changefreq: "daily" },
          { path: "/preise", priority: 0.7, changefreq: "monthly" },
          { path: "/unternehmen", priority: 0.6, changefreq: "monthly" },
          { path: "/work", priority: 0.9, changefreq: "weekly" },
          { path: "/work/corporate", priority: 0.7, changefreq: "monthly" },
          { path: "/frage-des-tages", priority: 0.7, changefreq: "daily" },
          { path: "/bestehens-rechner", priority: 0.7, changefreq: "monthly" },
        ];
        for (const p of pages) {
          urls.push({ loc: `${SITE_URL}${p.path}`, lastmod: today, changefreq: p.changefreq, priority: p.priority });
        }
        break;
      }

      case "blog": {
        const { data: articles } = await db
          .from("blog_articles")
          .select("slug, title, updated_at, published_at, hero_image_url, hero_image_alt")
          .eq("status", "published")
          .order("published_at", { ascending: false })
          .limit(500);
        if (articles) {
          for (const a of articles) {
            const images: SitemapURL["images"] = [];
            if (a.hero_image_url) {
              images.push({
                loc: a.hero_image_url.startsWith("http") ? a.hero_image_url : `${SITE_URL}${a.hero_image_url}`,
                title: a.title,
                caption: a.hero_image_alt || undefined,
              });
            }
            urls.push({
              loc: `${SITE_URL}/blog/${a.slug}`,
              lastmod: a.updated_at?.split("T")[0] || a.published_at?.split("T")[0] || today,
              changefreq: "weekly", priority: 0.7,
              images: images.length ? images : undefined,
            });
          }
        }
        break;
      }

      case "berufe": {
        const { data: berufe } = await db.from("berufe").select("bezeichnung_kurz, updated_at").eq("ist_aktiv", true);
        if (berufe) {
          for (const b of berufe) {
            const slug = generateSlug(b.bezeichnung_kurz);
            const lastmod = b.updated_at?.split("T")[0] || today;
            urls.push({ loc: `${SITE_URL}/berufe/${slug}`, lastmod, changefreq: "weekly", priority: 0.8 });
            for (const product of ["lernkurs", "pruefungstrainer", "bundle"]) {
              urls.push({ loc: `${SITE_URL}/${product}/${slug}`, lastmod, changefreq: "weekly", priority: 0.7 });
            }
            urls.push({ loc: `${SITE_URL}/ihk-pruefungen/${slug}`, lastmod, changefreq: "weekly", priority: 0.7 });
          }
        }
        break;
      }

      case "products": {
        const { data: products } = await db.from("store_products").select("name, updated_at, image_url").eq("is_active", true);
        if (products) {
          for (const p of products) {
            const images: SitemapURL["images"] = [];
            if (p.image_url) images.push({ loc: p.image_url.startsWith("http") ? p.image_url : `${SITE_URL}${p.image_url}`, title: p.name });
            urls.push({ loc: `${SITE_URL}/shop/${generateSlug(p.name)}`, lastmod: p.updated_at?.split("T")[0] || today, changefreq: "weekly", priority: 0.6, images: images.length ? images : undefined });
          }
        }
        const { data: cpProducts } = await db.from("curriculum_products").select("slug, updated_at").eq("is_published", true).not("slug", "is", null);
        if (cpProducts) {
          for (const cp of cpProducts) {
            if (cp.slug) urls.push({ loc: `${SITE_URL}/produkt/${cp.slug}`, lastmod: cp.updated_at?.split("T")[0] || today, changefreq: "weekly", priority: 0.6 });
          }
        }
        break;
      }

      case "seo": {
        const { data: seoDocs } = await db.from("seo_documents").select("slug, doc_type, updated_at, meta_title, og_image_path").eq("status", "published");
        const map: Record<string, string> = { blog: "/wissen", landing: "/pruefungstraining", faq: "/faq", glossary: "/glossar", product: "/produkt", cluster: "/wissen" };
        if (seoDocs) {
          for (const d of seoDocs) {
            const base = map[d.doc_type] || "/wissen";
            const images: SitemapURL["images"] = [];
            if (d.og_image_path) images.push({ loc: d.og_image_path.startsWith("http") ? d.og_image_path : `${SITE_URL}${d.og_image_path}`, title: d.meta_title || d.slug });
            urls.push({ loc: `${SITE_URL}${base}/${d.slug}`, lastmod: d.updated_at?.split("T")[0] || today, changefreq: "weekly", priority: d.doc_type === "landing" ? 0.8 : 0.6, images: images.length ? images : undefined });
          }
        }
        break;
      }

      case "training": {
        const pages = [
          { path: "/pruefungstraining", priority: 0.9 },
          { path: "/pruefungstraining/ausbildung", priority: 0.8 },
          { path: "/pruefungstraining/fachwirt", priority: 0.8 },
          { path: "/pruefungstraining/meister", priority: 0.8 },
          { path: "/pruefungstraining/betriebswirt", priority: 0.8 },
          { path: "/pruefungstraining/sachkunde", priority: 0.8 },
          { path: "/pruefungstraining/aevo", priority: 0.8 },
        ];
        for (const p of pages) urls.push({ loc: `${SITE_URL}${p.path}`, lastmod: today, changefreq: "weekly", priority: p.priority });

        const { data: certs } = await db.from("certification_catalog").select("slug, updated_at").not("slug", "is", null);
        if (certs) {
          for (const c of certs) {
            if (c.slug) urls.push({ loc: `${SITE_URL}/pruefungstraining/${c.slug}`, lastmod: c.updated_at?.split("T")[0] || today, changefreq: "weekly", priority: 0.7 });
          }
        }
        break;
      }
    }

    return new Response(renderSitemap(urls), { headers: xmlHeaders });
  } catch (error) {
    console.error("Sitemap index error:", error);
    return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
