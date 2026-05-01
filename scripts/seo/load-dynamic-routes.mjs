/**
 * Load dynamic SEO routes (blog articles + product pages) from Supabase REST
 * at build time, using the public anon key (read-only via RLS).
 *
 * Returns two arrays of route objects with the same shape consumed by
 * prerender.mjs:
 *   - blogRoutes:    { kind:'blog', path, slug, title, description, h1,
 *                      contentHtml, contentText, faq[], jsonLd[], lastmod, ... }
 *   - productRoutes: { kind:'product', path, slug, title, description, h1,
 *                      intro, jsonLd[], lastmod, ... }
 *
 * NEVER throws on partial failure — returns [] for the failing group so the
 * static SSOT prerender keeps working. Logs warnings instead.
 */

import fs from "node:fs";
import path from "node:path";

// Read SUPABASE_URL / KEY from process.env first; if missing (CI build runners
// can scrub them), fall back to parsing project root .env so the build still
// produces a complete sitemap.
function readEnvFallback() {
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return {};
    const out = {};
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=("?)([^"]*)\2\s*$/);
      if (m) out[m[1]] = m[3];
    }
    return out;
  } catch {
    return {};
  }
}
const _envFile = readEnvFallback();
const SITE = "https://examfit.de";
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  _envFile.SUPABASE_URL ||
  _envFile.VITE_SUPABASE_URL ||
  "";
const SUPABASE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  _envFile.SUPABASE_PUBLISHABLE_KEY ||
  _envFile.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";


function clamp(s, min, max) {
  if (!s) return s;
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function escapeHtmlInline(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Minimal Markdown → HTML for the prerendered above-the-fold body.
 * Handles: # h1, ## h2, ### h3, paragraphs, **bold**, *italic*, `code`,
 * ordered/unordered lists, links. Keeps things deterministic & dependency-free.
 */
function mdToHtml(md) {
  if (!md) return "";
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inUl = false;
  let inOl = false;
  let para = [];

  const flushPara = () => {
    if (para.length === 0) return;
    out.push(`<p>${inlines(para.join(" "))}</p>`);
    para = [];
  };
  const closeLists = () => {
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
  };
  const inlines = (s) => {
    let t = escapeHtmlInline(s);
    // links [text](url)
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    // bold
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // italic
    t = t.replace(/(^|\W)\*([^*\n]+)\*(\W|$)/g, "$1<em>$2</em>$3");
    // inline code
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    return t;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      closeLists();
      continue;
    }
    let m;
    if ((m = line.match(/^###\s+(.*)$/))) {
      flushPara(); closeLists();
      out.push(`<h3>${inlines(m[1])}</h3>`);
    } else if ((m = line.match(/^##\s+(.*)$/))) {
      flushPara(); closeLists();
      out.push(`<h2>${inlines(m[1])}</h2>`);
    } else if ((m = line.match(/^#\s+(.*)$/))) {
      flushPara(); closeLists();
      out.push(`<h1>${inlines(m[1])}</h1>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      flushPara();
      if (inOl) { out.push("</ol>"); inOl = false; }
      if (!inUl) { out.push("<ul>"); inUl = true; }
      out.push(`<li>${inlines(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
      flushPara();
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (!inOl) { out.push("<ol>"); inOl = true; }
      out.push(`<li>${inlines(m[1])}</li>`);
    } else {
      para.push(line);
    }
  }
  flushPara();
  closeLists();
  return out.join("\n");
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}: ${await res.text()}`);
  }
  return res.json();
}

async function fetchAll(table, select, filter = "", pageSize = 1000) {
  const out = [];
  let from = 0;
  for (;;) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${filter ? "&" + filter : ""}&limit=${pageSize}&offset=${from}`;
    const batch = await fetchJson(url);
    out.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

export async function loadBlogRoutes() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("[seo-dynamic] SUPABASE_URL / KEY missing — skipping blog routes");
    return [];
  }
  let rows = [];
  try {
    rows = await fetchAll(
      "blog_articles",
      "slug,title,meta_description,content_md,published_at,updated_at,word_count,faq_json,hero_image_url,hero_image_alt,topic_cluster",
      "status=eq.published&slug=not.is.null"
    );
  } catch (e) {
    console.warn("[seo-dynamic] blog fetch failed:", e.message);
    return [];
  }

  const routes = [];
  for (const r of rows) {
    if (!r.slug || !r.title) continue;
    const path = `/blog/${r.slug}`;

    // Title: clamp to <=60 if too long, but keep full as h1
    const title = clamp(r.title, 1, 60);
    const description = r.meta_description
      ? clamp(r.meta_description, 70, 160)
      : `Prüfungsvorbereitung & Tipps zum Thema „${r.title}". Lerne effizient mit ExamFit.`.slice(0, 160);

    // Content body is best-effort: used only if hosting later honors per-route HTML.
    // For sitemap-only mode (current Lovable hosting), we still emit the route
    // even when contentMd is missing — Googlebot will JS-render the page.
    const contentHtml = mdToHtml(r.content_md || "");
    const contentText = htmlToText(contentHtml);

    const faqArr = Array.isArray(r.faq_json) ? r.faq_json : [];
    const faq = faqArr
      .map((f) => ({
        q: typeof f.q === "string" ? f.q : (typeof f.question === "string" ? f.question : null),
        a: typeof f.a === "string" ? f.a : (typeof f.answer === "string" ? f.answer : null),
      }))
      .filter((f) => f.q && f.a);

    const canonical = `${SITE}${path}`;

    const jsonLd = [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: r.title,
        description,
        mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
        url: canonical,
        datePublished: r.published_at || undefined,
        dateModified: r.updated_at || r.published_at || undefined,
        wordCount: r.word_count || undefined,
        inLanguage: "de-DE",
        image: r.hero_image_url || undefined,
        author: { "@type": "Organization", name: "ExamFit" },
        publisher: {
          "@type": "Organization",
          name: "ExamFit",
          logo: {
            "@type": "ImageObject",
            url: `${SITE}/pwa-512x512.png`,
          },
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Start", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE}/blog` },
          { "@type": "ListItem", position: 3, name: r.title, item: canonical },
        ],
      },
    ];
    if (faq.length > 0) {
      jsonLd.push({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      });
    }

    routes.push({
      kind: "blog",
      path,
      slug: r.slug,
      title,
      description,
      h1: r.title,
      contentHtml,
      contentText,
      faq,
      jsonLd,
      lastmod: (r.updated_at || r.published_at || new Date().toISOString()).slice(0, 10),
      heroImage: r.hero_image_url || null,
      heroImageAlt: r.hero_image_alt || r.title,
      topicCluster: r.topic_cluster || null,
      sitemapGroup: "blog",
      changefreq: "weekly",
      priority: 0.6,
    });

    // Persona-Einstiegspfade — 3 URLs pro published Produkt (SSOT-Routing).
    const PERSONA_DEFS = [
      { key: "azubi", label: "für Azubis", suffix: "für Azubis" },
      { key: "betrieb", label: "für Ausbildungsbetriebe", suffix: "für Ausbildungsbetriebe" },
      { key: "institution", label: "für Berufsschulen & Kammern", suffix: "für Bildungsinstitutionen" },
    ];
    for (const p of PERSONA_DEFS) {
      const personaPath = `${path}/${p.key}`;
      const personaCanonical = `${SITE}${personaPath}`;
      const personaTitle = clamp(`${r.canonical_title} ${p.suffix} | ExamFit`, 1, 60);
      const personaDesc = clamp(
        `${r.canonical_title} ${p.label}: Diagnose-Check, prüfungsnahe Inhalte und KI-Coach mit Quellen. Jetzt kostenlos starten.`,
        70,
        160,
      );
      routes.push({
        kind: "product_persona",
        path: personaPath,
        slug: r.canonical_slug,
        persona: p.key,
        title: personaTitle,
        description: personaDesc,
        h1: `${titleBase} ${p.suffix}`,
        intro:
          r.product_intro ||
          r.hero_subline ||
          `${r.canonical_title} ${p.label} — Diagnose-Check, prüfungsnahe Inhalte und KI-Coach.`,
        jsonLd: [
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Start", item: `${SITE}/` },
              { "@type": "ListItem", position: 2, name: "Prüfungstraining", item: `${SITE}/pruefungstraining` },
              { "@type": "ListItem", position: 3, name: r.canonical_title, item: `${SITE}${path}` },
              { "@type": "ListItem", position: 4, name: p.label, item: personaCanonical },
            ],
          },
        ],
        lastmod: (r.updated_at || r.published_at || new Date().toISOString()).slice(0, 10),
        sitemapGroup: "products",
        changefreq: "weekly",
        priority: 0.7,
      });
    }
  }

  // Soft quality-gate (warning-only, never fails build):
  const warnings = [];
  for (const route of routes) {
    if (!route.title || route.title.length < 30 || route.title.length > 60)
      warnings.push(`title length ${route.title?.length}: ${route.path}`);
    if (!route.description || route.description.length < 70 || route.description.length > 160)
      warnings.push(`desc length ${route.description?.length}: ${route.path}`);
    if (route.contentText && route.contentText.length > 0 && route.contentText.length < 600)
      warnings.push(`body <600 chars: ${route.path}`);
  }
  if (warnings.length > 0) {
    console.warn(`[seo-dynamic][quality] ${warnings.length} blog routes with soft warnings:`);
    for (const w of warnings.slice(0, 20)) console.warn(`  - ${w}`);
    if (warnings.length > 20) console.warn(`  ... and ${warnings.length - 20} more`);
  }

  return routes;
}

export async function loadProductRoutes() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("[seo-dynamic] SUPABASE_URL / KEY missing — skipping product routes");
    return [];
  }
  let rows = [];
  try {
    rows = await fetchAll(
      "v_product_page_published_ssot",
      "canonical_slug,canonical_url,canonical_title,product_intro,hero_headline,hero_subline,beruf_display_name,kammer,track,published_at,updated_at,seo_title:canonical_title,product_type",
      ""
    );
  } catch (e) {
    console.warn("[seo-dynamic] product fetch failed:", e.message);
    return [];
  }

  const routes = [];
  for (const r of rows) {
    if (!r.canonical_slug || !r.canonical_title) continue;
    const path = `/pruefungstraining/${r.canonical_slug}`;
    const titleBase = r.hero_headline || r.canonical_title;
    const title = clamp(`${titleBase} – Prüfungstraining | ExamFit`, 1, 60);
    const description = clamp(
      r.hero_subline ||
        r.product_intro ||
        `Prüfungstraining für ${r.canonical_title} mit adaptivem Lernplan, Simulationen und KI-Tutor mit Quellenangaben.`,
      70,
      160
    );
    const canonical = `${SITE}${path}`;

    const jsonLd = [
      {
        "@context": "https://schema.org",
        "@type": "Product",
        name: r.canonical_title,
        description,
        url: canonical,
        brand: { "@type": "Brand", name: "ExamFit" },
        category: "Prüfungsvorbereitung",
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Start", item: `${SITE}/` },
          {
            "@type": "ListItem",
            position: 2,
            name: "Prüfungstraining",
            item: `${SITE}/pruefungstraining`,
          },
          { "@type": "ListItem", position: 3, name: r.canonical_title, item: canonical },
        ],
      },
    ];

    routes.push({
      kind: "product",
      path,
      slug: r.canonical_slug,
      title,
      description,
      h1: titleBase,
      intro:
        r.product_intro ||
        r.hero_subline ||
        `Bereite dich gezielt auf die Prüfung als ${r.canonical_title} vor: adaptiver Lernplan, prüfungsnahe Simulationen, KI-Tutor mit Quellenangaben und realistische Selbsteinschätzung.`,
      jsonLd,
      lastmod: (r.updated_at || r.published_at || new Date().toISOString()).slice(0, 10),
      sitemapGroup: "products",
      changefreq: "weekly",
      priority: 0.8,
    });
  }
  return routes;
}

export async function loadDynamicRoutes() {
  const [blog, products] = await Promise.all([
    loadBlogRoutes(),
    loadProductRoutes(),
  ]);
  console.log(
    `[seo-dynamic] loaded ${blog.length} blog routes, ${products.length} product routes`
  );
  return { blog, products };
}
