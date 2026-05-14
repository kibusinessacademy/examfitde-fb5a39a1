/**
 * SEO Prerender + Sitemap Build Script (pure JS, no TS syntax)
 * --------------------------------------------------------------
 * Invoked from vite.config.ts after `vite build`.
 * Reads routes from globalThis.__SEO_ROUTES__ (populated by the plugin).
 *
 * For each LIVE route:
 *   1. Reads dist/index.html
 *   2. Injects <title>, <meta description>, <link canonical>, JSON-LD into <head>
 *   3. Injects above-the-fold body content into <div id="root">
 *   4. Writes to dist/<path>/index.html
 *
 * Also writes:
 *   dist/sitemap.xml                    (index, examfit.de origin)
 *   dist/sitemaps/{static,products,blog,content}.xml
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SITE = "https://examfit.de";
const DIST = path.resolve(process.cwd(), "dist");
const TODAY = new Date().toISOString().slice(0, 10);

async function loadRoutes() {
  const fromGlobal = globalThis.__SEO_ROUTES__;
  if (Array.isArray(fromGlobal)) return fromGlobal;
  throw new Error(
    "[seo-prerender] No routes provided via globalThis.__SEO_ROUTES__. " +
      "This script must be invoked from the Vite plugin in vite.config.ts."
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderAboveTheFold(route) {
  // Blog/product routes provide pre-rendered HTML content directly.
  if (route.kind === "blog") {
    const breadcrumb = `
  <nav aria-label="Breadcrumb">
    <ol>
      <li><a href="/">Start</a></li>
      <li><a href="/blog">Blog</a></li>
      <li>${escapeHtml(route.h1)}</li>
    </ol>
  </nav>`;
    const heroImg = route.heroImage
      ? `<img src="${escapeHtml(route.heroImage)}" alt="${escapeHtml(route.heroImageAlt || route.h1)}" loading="eager" />`
      : "";
    const faq = (route.faq || [])
      .map(
        (f) =>
          `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`
      )
      .join("");
    return `
<div id="prerender-content">
  ${breadcrumb}
  <article>
    <header>
      <h1>${escapeHtml(route.h1)}</h1>
      ${heroImg}
    </header>
    ${route.contentHtml || ""}
    ${faq ? `<section aria-label="Häufige Fragen"><h2>Häufige Fragen</h2>${faq}</section>` : ""}
  </article>
</div>`.trim();
  }

  if (route.kind === "product") {
    return `
<div id="prerender-content">
  <nav aria-label="Breadcrumb">
    <ol>
      <li><a href="/">Start</a></li>
      <li><a href="/pruefungstraining">Prüfungstraining</a></li>
      <li>${escapeHtml(route.h1)}</li>
    </ol>
  </nav>
  <header><h1>${escapeHtml(route.h1)}</h1></header>
  <section aria-label="Einführung"><p>${escapeHtml(route.intro)}</p></section>
</div>`.trim();
  }

  if (route.kind === "intent") {
    const breadcrumbHtml = (route.breadcrumbs || []).length
      ? `<nav aria-label="Breadcrumb"><ol>${(route.breadcrumbs || [])
          .map((b) =>
            b.href
              ? `<li><a href="${escapeHtml(b.href)}">${escapeHtml(b.label)}</a></li>`
              : `<li>${escapeHtml(b.label)}</li>`
          )
          .join("")}</ol></nav>`
      : "";
    const links = route.internalLinks || {};
    const linkBlocks = ["hub", "quiz", "tutor", "trainer"]
      .filter((k) => links[k] && links[k].href)
      .map(
        (k) =>
          `<li><a href="${escapeHtml(links[k].href)}">${escapeHtml(links[k].label || k)}</a></li>`
      )
      .join("");
    const siblings = Array.isArray(links.siblings) ? links.siblings : [];
    const siblingsHtml = siblings.length
      ? `<nav aria-label="Verwandte Themen"><h2>Verwandte Themen</h2><ul>${siblings
          .map(
            (s) =>
              `<li><a href="${escapeHtml(s.href)}">${escapeHtml(s.label)}</a></li>`
          )
          .join("")}</ul></nav>`
      : "";
    const ctaHtml = route.cta && route.cta.primary && route.cta.primary.href
      ? `<p><a href="${escapeHtml(route.cta.primary.href)}">${escapeHtml(route.cta.primary.label || "Jetzt starten")}</a>${
          route.cta.secondary && route.cta.secondary.href
            ? ` &nbsp; <a href="${escapeHtml(route.cta.secondary.href)}">${escapeHtml(route.cta.secondary.label || "Mehr erfahren")}</a>`
            : ""
        }</p>`
      : "";
    const faq = (route.faq || [])
      .map(
        (f) =>
          `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`
      )
      .join("");
    return `
<div id="prerender-content">
  ${breadcrumbHtml}
  <article>
    <header><h1>${escapeHtml(route.h1)}</h1></header>
    ${route.intro ? `<section aria-label="Einführung"><p>${escapeHtml(route.intro)}</p></section>` : ""}
    ${route.painPoints ? `<section aria-label="Typische Stolperfallen"><h2>Typische Stolperfallen</h2><p>${escapeHtml(route.painPoints)}</p></section>` : ""}
    ${route.expertTip ? `<section aria-label="Experten-Tipp"><h2>Experten-Tipp</h2><p>${escapeHtml(route.expertTip)}</p></section>` : ""}
    ${faq ? `<section aria-label="Häufige Fragen"><h2>Häufige Fragen</h2>${faq}</section>` : ""}
    ${linkBlocks ? `<nav aria-label="Weiterführend"><h2>Weiterführend</h2><ul>${linkBlocks}</ul></nav>` : ""}
    ${siblingsHtml}
    ${ctaHtml}
  </article>
</div>`.trim();
  }

  // Default: SSOT routes with keyFacts + faq
  const facts = (route.keyFacts || [])
    .map(
      (k) =>
        `<li><strong>${escapeHtml(k.label)}:</strong> ${escapeHtml(k.value)}</li>`
    )
    .join("");
  const faq = (route.faq || [])
    .map(
      (f) =>
        `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`
    )
    .join("");

  return `
<div id="prerender-content">
  <header>
    <h1>${escapeHtml(route.h1)}</h1>
  </header>
  <section aria-label="Einführung">
    <p>${escapeHtml(route.intro)}</p>
  </section>
  ${facts ? `<section aria-label="Eckdaten"><h2>Eckdaten</h2><ul>${facts}</ul></section>` : ""}
  ${faq ? `<section aria-label="Häufige Fragen"><h2>Häufige Fragen</h2>${faq}</section>` : ""}
</div>`.trim();
}

function injectHead(html, route) {
  // Apex with trailing slash for homepage to match sitemap/llms.txt
  const canonical = `${SITE}${route.path === "/" ? "/" : route.path}`;
  const jsonLd = (route.jsonLd || [])
    .map(
      (obj) =>
        `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`
    )
    .join("\n    ");

  const headInjection = [
    `<title>${escapeHtml(route.title)}</title>`,
    `<meta name="description" content="${escapeHtml(route.description)}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:title" content="${escapeHtml(route.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(route.description)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    jsonLd,
  ].join("\n    ");

  // Strip duplicates that the static index.html might already contain.
  // The prerender is the source of truth for per-route SEO tags.
  let stripped = html
    .replace(/<title>[\s\S]*?<\/title>\s*/gi, "")
    .replace(/<meta\s+name=["']description["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+name=["']title["'][^>]*>\s*/gi, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+property=["']og:title["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+property=["']og:description["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+property=["']og:url["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+property=["']og:type["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+name=["']twitter:card["'][^>]*>\s*/gi, "");
  return stripped.replace(/<\/head>/i, `    ${headInjection}\n  </head>`);
}

function injectBody(html, route) {
  const overlay = renderAboveTheFold(route);
  return html.replace(
    /<div id="root">\s*<\/div>/,
    `<div id="root">${overlay}</div>`
  );
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeRouteHtml(route, baseHtml) {
  const html = injectBody(injectHead(baseHtml, route), route);

  let outPath;
  if (route.path === "/") {
    outPath = path.join(DIST, "index.html");
  } else {
    const dir = path.join(DIST, route.path.replace(/^\//, ""));
    ensureDir(dir);
    outPath = path.join(dir, "index.html");
  }
  fs.writeFileSync(outPath, html, "utf8");
}

function buildSitemaps(routes) {
  const groups = { static: [], products: [], blog: [], content: [] };
  for (const r of routes) {
    if (r.status === "stub") continue;
    if (groups[r.sitemapGroup]) groups[r.sitemapGroup].push(r);
  }

  // ── Sitemap-Strategy: SSOT is Edge Function `generate-sitemap` ──
  // Static dist/sitemaps/*.xml stubs are NO LONGER written, because they would
  // shadow the Edge Function on Lovable Hosting and only contain hub URLs (≤3 each).
  // The Edge Function queries the DB live and returns 118 blog + 28 product URLs.
  // dist/sitemap.xml is a thin index pointing to the Function endpoints.
  const SUPABASE_FN = "https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/generate-sitemap";
  const subTypes = ["static", "berufe", "blog", "landing", "products", "content"];
  const subSitemaps = subTypes
    .map(
      (t) =>
        `  <sitemap>
    <loc>${SUPABASE_FN}?type=${t}</loc>
    <lastmod>${TODAY}</lastmod>
  </sitemap>`
    )
    .join("\n");
  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${subSitemaps}
</sitemapindex>`;
  fs.writeFileSync(path.join(DIST, "sitemap.xml"), indexXml, "utf8");

  // Defensive: remove any pre-existing dist/sitemaps/*.xml stubs from earlier builds.
  const stubDir = path.join(DIST, "sitemaps");
  if (fs.existsSync(stubDir)) {
    for (const f of fs.readdirSync(stubDir)) {
      if (f.endsWith(".xml")) fs.unlinkSync(path.join(stubDir, f));
    }
  }
}

// Forbidden claim substrings (kept in sync with scripts/seo/quality-gate.mjs)
const FORBIDDEN = [
  "originalfragen",
  "originalformat",
  "original-punktebewertung",
  "originalbewertung",
  "offizielle ihk-fragen",
  "echte ihk-fragen",
  "garantiert bestehen",
  "garantierte bestehensquote",
  "bestehensgarantie",
  "100% bestehen",
  "100 % bestehen",
  "über 50.000",
  "ueber 50.000",
  "über 50000",
  "50.000 auszubildende",
  "über 300",
  "ueber 300",
  "über 500",
  "ueber 500",
  "über 1.000",
  "ueber 1.000",
  "über 1000",
  "ueber 1000",
];

function combinedVisibleText(r) {
  const facts = (r.keyFacts || []).map((f) => `${f.label}: ${f.value}`).join(" ");
  const faq = (r.faq || []).map((f) => `${f.q} ${f.a}`).join(" ");
  return [r.h1, r.intro, facts, faq].join("\n");
}

function validate(routes) {
  const errors = [];
  for (const r of routes) {
    if (r.status === "stub") continue;

    // Dynamic blog routes — DB-driven, different validation profile.
    if (r.kind === "blog") {
      if (!r.slug) errors.push(`${r.path}: blog missing slug`);
      if (!r.title || r.title.length < 20 || r.title.length > 75)
        errors.push(`${r.path}: blog title length ${r.title?.length} out of 20-75`);
      if (!r.description || r.description.length < 70 || r.description.length > 165)
        errors.push(`${r.path}: blog description ${r.description?.length} out of 70-165`);
      if (!r.contentText || r.contentText.length < 1200)
        errors.push(`${r.path}: blog contentText ${r.contentText?.length} <1200`);
      if (!r.jsonLd || r.jsonLd.length === 0)
        errors.push(`${r.path}: blog missing jsonLd`);
      const lower = (r.contentText || "").toLowerCase();
      for (const claim of FORBIDDEN) {
        if (lower.includes(claim))
          errors.push(`${r.path}: blog forbidden claim "${claim}"`);
      }
      continue;
    }

    // Dynamic product routes
    if (r.kind === "product") {
      if (!r.slug) errors.push(`${r.path}: product missing slug`);
      if (!r.title || r.title.length < 20 || r.title.length > 75)
        errors.push(`${r.path}: product title ${r.title?.length} out of 20-75`);
      if (!r.description || r.description.length < 70 || r.description.length > 165)
        errors.push(`${r.path}: product description ${r.description?.length} out of 70-165`);
      if (!r.intro || r.intro.length < 80)
        errors.push(`${r.path}: product intro <80`);
      if (!r.jsonLd || r.jsonLd.length === 0)
        errors.push(`${r.path}: product missing jsonLd`);
      continue;
    }

    // SSOT route validation (unchanged)
    if (!r.h1) errors.push(`${r.path}: missing h1`);
    if (!r.title || r.title.length < 30 || r.title.length > 60)
      errors.push(`${r.path}: title length ${r.title?.length} out of 30-60`);
    if (!r.description || r.description.length < 70 || r.description.length > 160)
      errors.push(
        `${r.path}: description length ${r.description?.length} out of 70-160`
      );
    if (!r.intro || r.intro.length < 500)
      errors.push(`${r.path}: intro shorter than 500 chars (${r.intro?.length})`);
    if ((r.keyFacts || []).length < 4)
      errors.push(`${r.path}: <4 keyFacts (${r.keyFacts?.length})`);
    if ((r.faq || []).length < 4)
      errors.push(`${r.path}: <4 faq entries (${r.faq?.length})`);
    if (!r.jsonLd || r.jsonLd.length === 0)
      errors.push(`${r.path}: missing jsonLd`);

    const visible = combinedVisibleText(r);
    if (visible.length < 1200)
      errors.push(`${r.path}: visible text ${visible.length} chars (<1200)`);
    const lower = visible.toLowerCase();
    for (const claim of FORBIDDEN) {
      if (lower.includes(claim))
        errors.push(`${r.path}: forbidden claim "${claim}"`);
    }
  }
  if (errors.length > 0) {
    console.error(`[seo-prerender] Validation errors (${errors.length}):`);
    for (const e of errors.slice(0, 50)) console.error(" - " + e);
    if (errors.length > 50) console.error(` ... and ${errors.length - 50} more`);
    throw new Error(`SEO validation failed: ${errors.length} issue(s)`);
  }
}

function postValidateHtml(routes) {
  const errors = [];
  for (const r of routes) {
    if (r.status === "stub") continue;
    const file =
      r.path === "/"
        ? path.join(DIST, "index.html")
        : path.join(DIST, r.path.replace(/^\//, ""), "index.html");
    if (!fs.existsSync(file)) {
      errors.push(`${r.path}: file not written (${file})`);
      continue;
    }
    const html = fs.readFileSync(file, "utf8");
    if (!/<h1[\s>]/i.test(html)) errors.push(`${r.path}: no <h1> in HTML`);
    if (!/<link\s+rel="canonical"/i.test(html))
      errors.push(`${r.path}: no canonical`);
    if (!/<script[^>]+application\/ld\+json/i.test(html))
      errors.push(`${r.path}: no JSON-LD`);
    // Strip scripts+styles, then strip tags → visible text proxy
    const visible = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (visible.length < 1200)
      errors.push(`${r.path}: rendered visible text ${visible.length} <1200`);
  }
  if (errors.length > 0) {
    console.error("[seo-prerender] Post-HTML validation errors:");
    for (const e of errors) console.error(" - " + e);
    throw new Error(`SEO post-HTML validation failed: ${errors.length} issue(s)`);
  }
}

export async function runSeoPrerender() {
  if (!fs.existsSync(DIST)) {
    console.warn(`[seo-prerender] dist/ not found, skipping`);
    return;
  }
  const baseHtml = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  const ssotRoutes = await loadRoutes();

  // Step 1b: load DB-driven routes (blog + product) FOR SITEMAP ONLY.
  // Lovable Hosting serves the SPA fallback (root index.html) for every path
  // and ignores dist/<route>/index.html, so per-route HTML for these routes
  // would never be served. The sitemap.xml IS served as a static file though,
  // so listing all blog/product URLs lets Googlebot discover + JS-render them.
  // See mem://architektur/seo/hosting-spa-fallback-blocks-prerender-v1.
  let dynamicRoutes = [];
  try {
    const mod = await import(
      pathToFileURL(path.resolve(process.cwd(), "scripts/seo/load-dynamic-routes.mjs")).href
    );
    const { blog, products } = await mod.loadDynamicRoutes();
    dynamicRoutes = [...blog, ...products];
  } catch (e) {
    console.warn("[seo-prerender] dynamic route loader failed:", e.message);
  }

  const live = ssotRoutes.filter((r) => r.status !== "stub");

  // Step 2: validate SSOT routes only (dynamic ones are sitemap-only)
  validate(ssotRoutes);

  // Steps 3-4: build + inject per-route HTML — SSOT routes only
  for (const route of live) {
    writeRouteHtml(route, baseHtml);
  }

  // Steps 5-6: sitemap covers SSOT + dynamic blog/product so crawlers discover them
  buildSitemaps([...ssotRoutes, ...dynamicRoutes]);

  // Step 7: validate generated HTML on disk (SSOT only — dynamic not written)
  postValidateHtml(live);

  const blogCount = dynamicRoutes.filter((r) => r.kind === "blog").length;
  const productCount = dynamicRoutes.filter((r) => r.kind === "product").length;
  console.log(
    `[seo-prerender] Wrote ${live.length} SSOT route HTMLs; sitemap includes ${blogCount} blog + ${productCount} product URLs (sitemap-only, hosting blocks per-route HTML)`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runSeoPrerender().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
