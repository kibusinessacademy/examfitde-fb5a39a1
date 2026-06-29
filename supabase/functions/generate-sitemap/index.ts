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

const SITE_URL = "https://berufos.com";
// Sitemap-Index sub-loc URLs MUST point to a publicly resolvable origin.
// Custom domain `berufos.com` does NOT proxy /functions/v1/*, so use Supabase project origin.
const SUPABASE_PROJECT_REF = "ubdvvvsiryenhrfmqsvw";
const FUNCTIONS_URL_BASE = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/generate-sitemap`;
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

// P6 Cut 3b — Hard-Gate gegen interne Drift: alle URLs, deren Pfad gegen eines
// dieser Patterns matcht, werden NIE in eine Sitemap emittiert. Mirror der
// noindex/redirect/gone-Klassen aus route_crawl_policy (defense-in-depth, falls
// ein Entity-Resolver versehentlich einen verbotenen Pfad zurückliefert).
const SITEMAP_FORBIDDEN_PREFIXES = [
  "/products", "/product/", "/category/", "/learning/", "/dashboard",
  "/checkout", "/search", "/legal/", "/account", "/admin", "/admin-v2",
  "/app", "/auth", "/course/", "/courses", "/daily-challenge", "/diag",
  "/drill", "/exam-results", "/exam-simulation", "/exam-trainer", "/heatmap",
  "/installieren", "/lernplan/", "/lesson", "/newsletter/", "/oral-exam",
  "/org", "/partner", "/payment-success", "/pruefungsreife-ergebnis/",
  "/purchase-success", "/renew", "/shuttle", "/spaced-repetition", "/success",
  "/tools/", "/user/", "/willkommen", "/work", "/about", "/ausbildungsberufe",
  "/kontakt", "/registrieren", "/repair-courses", "/sitemap",
];

function isAllowedSitemapPath(loc: string): boolean {
  try {
    const u = new URL(loc);
    const p = u.pathname;
    for (const pre of SITEMAP_FORBIDDEN_PREFIXES) {
      if (p === pre || p.startsWith(pre.endsWith("/") ? pre : pre + "/") || p === pre.replace(/\/$/, "")) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function toSitemapXML(urlsIn: SitemapURL[]): string {
  const urls = urlsIn.filter((u) => isAllowedSitemapPath(u.loc));
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

    // ── Static pages (P6 Cut 3 — SSOT route_crawl_policy) ──
    if (action === "static") {
      // Fetch from SSOT. Falls Query failt, Fallback auf hardcoded Liste, damit
      // Sitemap nie leer wird (DB-Outage Resilience).
      const { data: rows, error: rpErr } = await sb
        .from("route_crawl_policy")
        .select("pattern, priority, changefreq")
        .eq("state", "index")
        .eq("match_type", "exact")
        .order("priority", { ascending: false });
      if (rpErr) console.error("[generate-sitemap] route_crawl_policy query error:", rpErr);

      // Per-route lastmod resolver — nutzt tatsächliches Content-Update-Datum
      // statt pauschal `today`. Quellen:
      //   /berufe → MAX(lastmod) aus v_paket_sitemap_entries
      //   /       → MAX über berufe + blog
      //   /blog   → MAX aus v_blog_sitemap_entries
      //   /wissen → MAX aus v_wissen_sitemap_entries
      //   /preise → PRICING_LAST_UPDATED constant (manuell gepflegt bei Preisänderung)
      //   others  → today
      const PRICING_LAST_UPDATED = "2026-05-26"; // bump bei Preis-/Plan-Änderungen
      const [paketRes, blogRes, wissenRes] = await Promise.all([
        sb.from("v_paket_sitemap_entries").select("lastmod").order("lastmod", { ascending: false }).limit(1),
        sb.from("v_blog_sitemap_entries").select("lastmod").order("lastmod", { ascending: false }).limit(1),
        sb.from("v_wissen_sitemap_entries").select("lastmod").order("lastmod", { ascending: false }).limit(1),
      ]);
      const toDay = (v: unknown) => (v ? String(v).split("T")[0] : today);
      const berufeMax = toDay(paketRes.data?.[0]?.lastmod);
      const blogMax = toDay(blogRes.data?.[0]?.lastmod);
      const wissenMax = toDay(wissenRes.data?.[0]?.lastmod);
      const homeMax = [berufeMax, blogMax].sort().reverse()[0] || today;

      function resolveStaticLastmod(path: string): string {
        switch (path) {
          case "/": return homeMax;
          case "/berufe":
          case "/themen":
          case "/paket":
          case "/shop": return berufeMax;
          case "/blog": return blogMax;
          case "/wissen": return wissenMax;
          case "/preise": return PRICING_LAST_UPDATED;
          default: return today;
        }
      }

      const ssot: SitemapURL[] = (rows ?? []).map((r) => ({
        loc: `${SITE_URL}${r.pattern}`,
        lastmod: resolveStaticLastmod(r.pattern),
        changefreq: r.changefreq ?? undefined,
        priority: r.priority != null ? Number(r.priority) : undefined,
      }));

      const fallback: SitemapURL[] = [
        { loc: `${SITE_URL}/`, lastmod: resolveStaticLastmod("/"), changefreq: "daily", priority: 1.0 },
        { loc: `${SITE_URL}/themen`, lastmod: resolveStaticLastmod("/themen"), changefreq: "weekly", priority: 0.95 },
        { loc: `${SITE_URL}/berufe`, lastmod: resolveStaticLastmod("/berufe"), changefreq: "weekly", priority: 0.9 },
        { loc: `${SITE_URL}/preise`, lastmod: resolveStaticLastmod("/preise"), changefreq: "weekly", priority: 0.95 },
        { loc: `${SITE_URL}/paket`, lastmod: resolveStaticLastmod("/paket"), changefreq: "weekly", priority: 0.9 },
        { loc: `${SITE_URL}/shop`, lastmod: resolveStaticLastmod("/shop"), changefreq: "weekly", priority: 0.8 },
        { loc: `${SITE_URL}/wissen`, lastmod: resolveStaticLastmod("/wissen"), changefreq: "daily", priority: 0.8 },
        { loc: `${SITE_URL}/blog`, lastmod: resolveStaticLastmod("/blog"), changefreq: "daily", priority: 0.8 },
      ];

      const pages = ssot.length > 0 ? ssot : fallback;
      console.info(`[generate-sitemap] class=static count=${pages.length} home_lastmod=${homeMax} berufe_lastmod=${berufeMax} preise_lastmod=${PRICING_LAST_UPDATED}`);
      return xmlResponse(toSitemapXML(pages), headers);
    }



    // ── Blog articles (P6 Cut 3c — SSOT v_blog_sitemap_entries) ──
    if (action === "blog") {
      const urls: SitemapURL[] = [];
      const { data: rows, error: vErr } = await sb
        .from("v_blog_sitemap_entries")
        .select("slug, lastmod");
      if (vErr) console.error("[generate-sitemap] v_blog_sitemap_entries error:", vErr);
      for (const r of rows || []) {
        if (!r.slug) continue;
        const lm = (r.lastmod || "").toString().split("T")[0] || today;
        urls.push({ loc: `${SITE_URL}/blog/${r.slug}`, lastmod: lm, changefreq: "weekly", priority: 0.7 });
      }
      console.info(`[generate-sitemap] class=blog count=${urls.length}`);
      return xmlResponse(toSitemapXML(urls), headers);
    }

    // ── Landing pages → /pruefungstraining/* (P6 Cut 3c — SSOT v_pruefungstraining_sitemap_entries) ──
    if (action === "landing") {
      const urls: SitemapURL[] = [];
      const { data: rows, error: vErr } = await sb
        .from("v_pruefungstraining_sitemap_entries")
        .select("slug, lastmod");
      if (vErr) console.error("[generate-sitemap] v_pruefungstraining_sitemap_entries error:", vErr);
      for (const r of rows || []) {
        if (!r.slug) continue;
        const lm = (r.lastmod || "").toString().split("T")[0] || today;
        urls.push({ loc: `${SITE_URL}/pruefungstraining/${r.slug}`, lastmod: lm, changefreq: "weekly", priority: 0.8 });
      }
      // Optional: content_pages with page_type=landing (kept for legacy parity, has noindex column)
      const { data: cp } = await sb.from("content_pages")
        .select("slug, updated_at, noindex")
        .eq("status", "published").eq("page_type", "landing").limit(500);
      for (const p of cp || []) {
        if (p.noindex || !p.slug) continue;
        urls.push({ loc: `${SITE_URL}/${p.slug}`, lastmod: (p.updated_at || "").split("T")[0] || today, changefreq: "weekly", priority: 0.8 });
      }
      console.info(`[generate-sitemap] class=pruefungstraining count=${urls.length}`);
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
        const images = s.image_url
          ? [{ loc: s.image_url.startsWith("http") ? s.image_url : `${SITE_URL}${s.image_url}`, title: s.name, caption: `${s.name} – ExamFit Kurspaket` }]
          : undefined;
        urls.push({ loc: `${SITE_URL}/shop/${generateSlug(s.name)}`, lastmod: (s.updated_at || "").split("T")[0] || today, changefreq: "weekly", priority: 0.6, images });
      }

      console.info(`[generate-sitemap] class=products count=${urls.length}`);
      return xmlResponse(toSitemapXML(urls), headers);
    }

    // ── Berufe + certifications + Paketseiten ──
    if (action === "berufe") {
      const urls: SitemapURL[] = [];

      // Load beruf image cache once → attach as <image:image> per Beruf-URL
      const { data: imgRows } = await sb
        .from("beruf_image_cache")
        .select("slug, image_url, alt_text, title")
        .eq("status", "ready")
        .not("image_url", "is", null);
      const imgBySlug = new Map<string, { loc: string; title?: string; caption?: string }>();
      for (const r of imgRows || []) {
        if (!r.slug || !r.image_url) continue;
        const caption = (r.alt_text || r.title || "").toString().slice(0, 300);
        imgBySlug.set(r.slug, {
          loc: r.image_url.startsWith("http") ? r.image_url : `${SITE_URL}${r.image_url}`,
          title: r.title || undefined,
          caption: caption || undefined,
        });
      }

      const { data: berufe } = await sb.from("berufe")
        .select("bezeichnung_kurz, updated_at, ist_aktiv").eq("ist_aktiv", true).limit(500);
      for (const b of berufe || []) {
        const slug = generateSlug(b.bezeichnung_kurz);
        const lm = (b.updated_at || "").split("T")[0] || today;
        const img = imgBySlug.get(slug);
        const images = img ? [img] : undefined;
        urls.push({ loc: `${SITE_URL}/berufe/${slug}`, lastmod: lm, changefreq: "weekly", priority: 0.8, images });
        urls.push({ loc: `${SITE_URL}/ihk-pruefungen/${slug}`, lastmod: lm, changefreq: "weekly", priority: 0.7, images });
      }
      // P6 Cut 3b: /paket/:slug NUR aus published course_packages (SSOT v_paket_sitemap_entries).
      const { data: pakete, error: paketeErr } = await sb.from("v_paket_sitemap_entries")
        .select("bezeichnung_kurz, lastmod");
      if (paketeErr) console.error("[generate-sitemap] v_paket_sitemap_entries query error:", paketeErr);
      let paketCount = 0;
      for (const p of pakete || []) {
        const slug = generateSlug(p.bezeichnung_kurz);
        const lm = (p.lastmod || "").toString().split("T")[0] || today;
        const img = imgBySlug.get(slug);
        urls.push({ loc: `${SITE_URL}/paket/${slug}`, lastmod: lm, changefreq: "weekly", priority: 0.85, images: img ? [img] : undefined });
        paketCount++;
      }

      const { data: certs } = await sb.from("certification_catalog")
        .select("slug, created_at").not("slug", "is", null).limit(500);
      for (const c of certs || []) {
        if (!c.slug) continue;
        urls.push({ loc: `${SITE_URL}/pruefungstraining/${c.slug}`, lastmod: (c.created_at || "").split("T")[0] || today, changefreq: "weekly", priority: 0.7 });
      }
      const { data: seoMap } = await sb.from("v_certification_seo_with_product")
        .select("canonical_url_path").limit(500);
      for (const m of seoMap || []) {
        if (!m.canonical_url_path) continue;
        urls.push({ loc: `${SITE_URL}${m.canonical_url_path}`, lastmod: today, changefreq: "weekly", priority: 0.75 });
      }
      console.info(`[generate-sitemap] class=berufe total=${urls.length} paket=${paketCount} images=${imgBySlug.size}`);
      return xmlResponse(toSitemapXML(urls), headers);
    }


    // ── Content / Wissen (P6 Cut 3c — SSOT v_wissen_sitemap_entries + seo_content_pages) ──
    if (action === "content") {
      const urls: SitemapURL[] = [];
      const { data: wissen, error: wErr } = await sb
        .from("v_wissen_sitemap_entries")
        .select("path, lastmod");
      if (wErr) console.error("[generate-sitemap] v_wissen_sitemap_entries error:", wErr);
      for (const r of wissen || []) {
        if (!r.path) continue;
        const lm = (r.lastmod || "").toString().split("T")[0] || today;
        urls.push({ loc: `${SITE_URL}${r.path}`, lastmod: lm, changefreq: "weekly", priority: 0.6 });
      }
      let wissenCount = urls.length;

      // content_pages (has noindex column)
      const { data: cp } = await sb.from("content_pages")
        .select("slug, page_type, updated_at, noindex")
        .eq("status", "published").limit(500);
      for (const p of cp || []) {
        if (p.noindex || !p.slug || p.page_type === "landing") continue;
        urls.push({ loc: `${SITE_URL}/${p.slug}`, lastmod: (p.updated_at || "").split("T")[0] || today, changefreq: "monthly", priority: 0.5 });
      }
      // SEO Intent-Pages → /kurse/<curriculum>/intent_<key>/<competency>
      const { data: intents } = await sb.from("seo_content_pages")
        .select("slug, last_generated_at, updated_at, quality_score")
        .eq("page_type", "intent_page").eq("status", "published")
        .gte("quality_score", 80).limit(2000);
      const seen = new Set<string>();
      for (const r of intents || []) {
        if (!r.slug || r.slug.split("/").length !== 3) continue;
        const lm = (r.last_generated_at || r.updated_at || "").split("T")[0] || today;
        const loc = `${SITE_URL}/kurse/${r.slug}`;
        if (seen.has(loc)) continue;
        seen.add(loc);
        urls.push({ loc, lastmod: lm, changefreq: "weekly", priority: 0.7 });
      }
      // SEO Pillar-Pages → /kurse/<curriculum-slug>
      const { data: pillars } = await sb.from("seo_content_pages")
        .select("slug, last_generated_at, updated_at, quality_score")
        .eq("page_type", "pillar_page").eq("status", "published")
        .gte("quality_score", 80).limit(500);
      for (const r of pillars || []) {
        if (!r.slug || r.slug.includes("/")) continue;
        const lm = (r.last_generated_at || r.updated_at || "").split("T")[0] || today;
        const loc = `${SITE_URL}/kurse/${r.slug}`;
        if (seen.has(loc)) continue;
        seen.add(loc);
        urls.push({ loc, lastmod: lm, changefreq: "weekly", priority: 0.8 });
      }
      console.info(`[generate-sitemap] class=content total=${urls.length} wissen=${wissenCount}`);
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
