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
  const canonical = `${SITE}${route.path === "/" ? "" : route.path}`;
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

  const stripped = html.replace(/<title>[\s\S]*?<\/title>\s*/i, "");
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

  ensureDir(path.join(DIST, "sitemaps"));

  for (const [group, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    const urls = items
      .map((r) => {
        const loc = `${SITE}${r.path === "/" ? "" : r.path}`;
        const lastmod = r.lastmod || TODAY;
        const changefreq = r.changefreq || "weekly";
        const priority = (r.priority ?? 0.5).toFixed(1);
        return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
      })
      .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
    fs.writeFileSync(path.join(DIST, "sitemaps", `${group}.xml`), xml, "utf8");
  }

  const subSitemaps = Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(
      ([group]) =>
        `  <sitemap>
    <loc>${SITE}/sitemaps/${group}.xml</loc>
    <lastmod>${TODAY}</lastmod>
  </sitemap>`
    )
    .join("\n");
  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${subSitemaps}
</sitemapindex>`;
  fs.writeFileSync(path.join(DIST, "sitemap.xml"), indexXml, "utf8");
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
    console.error("[seo-prerender] Validation errors:");
    for (const e of errors) console.error(" - " + e);
    throw new Error(`SEO validation failed: ${errors.length} issue(s)`);
  }
}

export async function runSeoPrerender() {
  if (!fs.existsSync(DIST)) {
    console.warn(`[seo-prerender] dist/ not found, skipping`);
    return;
  }
  const baseHtml = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  const routes = await loadRoutes();
  const live = routes.filter((r) => r.status !== "stub");

  validate(routes);

  for (const route of live) {
    writeRouteHtml(route, baseHtml);
  }

  buildSitemaps(routes);

  console.log(
    `[seo-prerender] Wrote ${live.length} route HTMLs and sitemap index to dist/`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runSeoPrerender().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
