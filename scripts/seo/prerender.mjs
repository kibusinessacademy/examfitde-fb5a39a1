/**
 * SEO Prerender + Sitemap Build Script
 * --------------------------------------------------------------
 * Runs after `vite build` (hooked from vite.config.ts).
 *
 * For each LIVE route in src/content/seoRoutes.ts:
 *   1. Reads dist/index.html
 *   2. Injects: <title>, <meta description>, <link canonical>, JSON-LD
 *   3. Injects above-the-fold body content (H1 + intro + key facts + FAQ)
 *      inside <div id="root">, BEFORE React hydrates
 *   4. Writes to dist/<path>/index.html
 *
 * Also writes:
 *   dist/sitemap.xml                    (index)
 *   dist/sitemaps/static.xml
 *   dist/sitemaps/products.xml
 *   dist/sitemaps/blog.xml
 *   dist/sitemaps/content.xml
 *
 * Hydration safety:
 *   The injected HTML is a static <noscript>+SSR-style block. React will
 *   replace #root contents on mount; the prerendered block does not need
 *   to exactly match React output (it lives inside a wrapper div that
 *   React will overwrite). Crawlers see the content; users see React.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SITE = "https://examfit.de";
const DIST = path.resolve(process.cwd(), "dist");
const TODAY = new Date().toISOString().slice(0, 10);

// Use a tsx-loader-free approach: compile-and-import the SSOT via a tiny shim.
// We re-use Vite's TS handling by writing a JSON-cache of the SSOT first.
// Simpler alternative: use `tsx` API. We rely on dynamic import with the .ts
// file, which Node 20+ supports through --experimental-strip-types when run
// via the Vite plugin (the plugin will set NODE_OPTIONS).
async function loadRoutes() {
  // The Vite plugin loads routes by transforming TS via esbuild and passes
  // them in via globalThis. See vite.config.ts.
  const fromGlobal = (globalThis as any).__SEO_ROUTES__;
  if (Array.isArray(fromGlobal)) return fromGlobal;
  throw new Error(
    "[seo-prerender] No routes provided via globalThis.__SEO_ROUTES__. " +
    "This script must be invoked from the Vite plugin in vite.config.ts."
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderAboveTheFold(route: any): string {
  const facts = (route.keyFacts || [])
    .map(
      (k: any) =>
        `<li><strong>${escapeHtml(k.label)}:</strong> ${escapeHtml(k.value)}</li>`
    )
    .join("");
  const faq = (route.faq || [])
    .map(
      (f: any) =>
        `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(
          f.a
        )}</p></details>`
    )
    .join("");

  // Wrapped in a <div id="prerender-content"> that React's mount on #root
  // will overwrite. Crawlers without JS read it as-is.
  return `
<div id="prerender-content">
  <header>
    <h1>${escapeHtml(route.h1)}</h1>
  </header>
  <section aria-label="Einführung">
    <p>${escapeHtml(route.intro)}</p>
  </section>
  ${
    facts
      ? `<section aria-label="Eckdaten"><h2>Eckdaten</h2><ul>${facts}</ul></section>`
      : ""
  }
  ${
    faq
      ? `<section aria-label="Häufige Fragen"><h2>Häufige Fragen</h2>${faq}</section>`
      : ""
  }
</div>`.trim();
}

function injectHead(html: string, route: any): string {
  const canonical = `${SITE}${route.path === "/" ? "" : route.path}`;
  const jsonLd = (route.jsonLd || [])
    .map(
      (obj: any) =>
        `<script type="application/ld+json">${JSON.stringify(obj).replace(
          /</g,
          "\\u003c"
        )}</script>`
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

  // Strip the dev <title> if present, then inject before </head>.
  const stripped = html.replace(/<title>[\s\S]*?<\/title>\s*/i, "");
  return stripped.replace(/<\/head>/i, `    ${headInjection}\n  </head>`);
}

function injectBody(html: string, route: any): string {
  const overlay = renderAboveTheFold(route);
  // Insert inside <div id="root">…</div>. The dist index.html has an empty
  // root div; we replace it with one that contains the prerender-content.
  return html.replace(
    /<div id="root">\s*<\/div>/,
    `<div id="root">${overlay}</div>`
  );
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeRouteHtml(route: any, baseHtml: string) {
  const html = injectBody(injectHead(baseHtml, route), route);

  let outPath: string;
  if (route.path === "/") {
    outPath = path.join(DIST, "index.html"); // overwrite root
  } else {
    const dir = path.join(DIST, route.path.replace(/^\//, ""));
    ensureDir(dir);
    outPath = path.join(dir, "index.html");
  }
  fs.writeFileSync(outPath, html, "utf8");
}

function buildSitemaps(routes: any[]) {
  const groups: Record<string, any[]> = {
    static: [],
    products: [],
    blog: [],
    content: [],
  };
  for (const r of routes) {
    if (r.status === "stub") continue;
    groups[r.sitemapGroup].push(r);
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
    fs.writeFileSync(
      path.join(DIST, "sitemaps", `${group}.xml`),
      xml,
      "utf8"
    );
  }

  // Sitemap index → all on examfit.de
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

function validate(routes: any[]) {
  const errors: string[] = [];
  for (const r of routes) {
    if (r.status === "stub") continue;
    if (!r.h1) errors.push(`${r.path}: missing h1`);
    if (!r.title || r.title.length < 30 || r.title.length > 70)
      errors.push(`${r.path}: title length ${r.title?.length} out of 30-70`);
    if (
      !r.description ||
      r.description.length < 70 ||
      r.description.length > 170
    )
      errors.push(
        `${r.path}: description length ${r.description?.length} out of 70-170`
      );
    if (!r.intro || r.intro.length < 400)
      errors.push(`${r.path}: intro shorter than 400 chars (${r.intro?.length})`);
    if ((r.keyFacts || []).length < 5)
      errors.push(`${r.path}: <5 keyFacts (${r.keyFacts?.length})`);
    if ((r.faq || []).length < 6)
      errors.push(`${r.path}: <6 faq entries (${r.faq?.length})`);
    if (!r.jsonLd || r.jsonLd.length === 0)
      errors.push(`${r.path}: missing jsonLd`);
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
  const live = routes.filter((r: any) => r.status !== "stub");

  validate(routes);

  for (const route of live) {
    writeRouteHtml(route, baseHtml);
  }

  buildSitemaps(routes);

  console.log(
    `[seo-prerender] Wrote ${live.length} route HTMLs and sitemap index to dist/`
  );
}

// Allow direct invocation for debugging:
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runSeoPrerender().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
