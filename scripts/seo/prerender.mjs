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

  if (route.kind === "pillar") {
    const breadcrumbHtml = (route.breadcrumbs || []).length
      ? `<nav aria-label="Breadcrumb"><ol>${(route.breadcrumbs || [])
          .map((b) =>
            b.href
              ? `<li><a href="${escapeHtml(b.href)}">${escapeHtml(b.label)}</a></li>`
              : `<li>${escapeHtml(b.label)}</li>`
          )
          .join("")}</ol></nav>`
      : "";
    const sections = route.sections || {};
    const spokesHtml = (route.internalLinks || []).length
      ? `<nav aria-label="Themen-Übersicht"><h2>Alle Themen im Überblick</h2><ul>${(route.internalLinks || [])
          .map(
            (l) =>
              `<li><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></li>`
          )
          .join("")}</ul></nav>`
      : "";
    const ctaHtml = route.cta && route.cta.href
      ? `<p><a href="${escapeHtml(route.cta.href)}">${escapeHtml(route.cta.label || "Prüfung starten")}</a></p>`
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
    ${sections.curriculum_overview ? `<section aria-label="Curriculum-Überblick"><h2>Curriculum-Überblick</h2><p>${escapeHtml(sections.curriculum_overview)}</p></section>` : ""}
    ${sections.learning_journey ? `<section aria-label="Lernpfad"><h2>Lernpfad</h2><p>${escapeHtml(sections.learning_journey)}</p></section>` : ""}
    ${sections.exam_strategy ? `<section aria-label="Prüfungsstrategie"><h2>Prüfungsstrategie</h2><p>${escapeHtml(sections.exam_strategy)}</p></section>` : ""}
    ${spokesHtml}
    ${faq ? `<section aria-label="Häufige Fragen"><h2>Häufige Fragen</h2>${faq}</section>` : ""}
    ${ctaHtml}
  </article>
</div>`.trim();
  }
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
  ${route.contentHtml ? `<section aria-label="Inhalt">${route.contentHtml}</section>` : ""}
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
    `<meta name="twitter:title" content="${escapeHtml(route.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(route.description)}" />`,
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
    .replace(/<meta\s+name=["']twitter:card["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+name=["']twitter:title["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+name=["']twitter:description["'][^>]*>\s*/gi, "");
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

    // Intent landing pages — DB-driven from seo_content_pages.
    // Soft thresholds: title up to 250 (DB allows long competency names);
    // description 70-165; jsonLd required (Article + optional Breadcrumb/FAQ).
    if (r.kind === "intent") {
      if (!r.slug) errors.push(`${r.path}: intent missing slug`);
      if (!r.title || r.title.length < 20)
        errors.push(`${r.path}: intent title ${r.title?.length} <20`);
      if (!r.description || r.description.length < 70 || r.description.length > 165)
        errors.push(`${r.path}: intent description ${r.description?.length} out of 70-165`);
      if (!r.h1) errors.push(`${r.path}: intent missing h1`);
      if (!r.jsonLd || r.jsonLd.length === 0)
        errors.push(`${r.path}: intent missing jsonLd`);
      continue;
    }

    // Pillar landing pages — curriculum hubs.
    if (r.kind === "pillar") {
      if (!r.slug) errors.push(`${r.path}: pillar missing slug`);
      if (!r.title || r.title.length < 20 || r.title.length > 75)
        errors.push(`${r.path}: pillar title ${r.title?.length} out of 20-75`);
      if (!r.description || r.description.length < 70 || r.description.length > 165)
        errors.push(`${r.path}: pillar description ${r.description?.length} out of 70-165`);
      if (!r.h1) errors.push(`${r.path}: pillar missing h1`);
      if ((r.internalLinks || []).length < 6)
        errors.push(`${r.path}: pillar internal_links ${(r.internalLinks || []).length} <6`);
      if (!r.jsonLd || r.jsonLd.length === 0)
        errors.push(`${r.path}: pillar missing jsonLd`);
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
    // Intent pages have shorter rendered above-the-fold; the rich SSOT body
    // (intro+pain_points+expert_tip+faq+links) typically yields 800-1500 chars.
    // Soft floor for intents = 600; SSOT routes keep 1200 hard floor.
    const minVisible = r.kind === "intent" ? 600 : r.kind === "pillar" ? 1500 : 1200;
    if (visible.length < minVisible)
      errors.push(`${r.path}: rendered visible text ${visible.length} <${minVisible}`);
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

  // Step 1b: load DB-driven routes (blog + product + intent).
  // — blog + product remain SITEMAP-ONLY (Lovable Hosting hard SPA-fallback).
  // — intent pages (seo_content_pages) are PRERENDERED to dist/kurse/.../index.html
  //   so Vercel / Cloudflare Pages can serve per-route HTML. On Lovable Hosting
  //   the per-route HTML is silently ignored — same outcome as today, no regression.
  //   See mem://architektur/seo/hosting-spa-fallback-blocks-prerender-v1
  //       mem://architektur/seo/sitemap-only-mode-for-db-routes-v1.
  let dynamicRoutes = [];
  let intentRoutes = [];
  let pillarRoutes = [];
  let wissenRoutes = [];
  try {
    const mod = await import(
      pathToFileURL(path.resolve(process.cwd(), "scripts/seo/load-dynamic-routes.mjs")).href
    );
    const { blog, products, intents, pillars, wissen } = await mod.loadDynamicRoutes();
    dynamicRoutes = [...blog, ...products];
    intentRoutes = intents || [];
    pillarRoutes = pillars || [];
    wissenRoutes = wissen || [];
  } catch (e) {
    console.warn("[seo-prerender] dynamic route loader failed:", e.message);
  }

  const live = ssotRoutes.filter((r) => r.status !== "stub");

  // Step 2: validate SSOT + intent + pillar routes (all will be written).
  validate([...ssotRoutes, ...intentRoutes, ...pillarRoutes]);

  // Steps 3-4: build + inject per-route HTML — SSOT + intent + pillar routes
  for (const route of live) {
    writeRouteHtml(route, baseHtml);
  }
  for (const route of intentRoutes) {
    writeRouteHtml(route, baseHtml);
  }
  for (const route of pillarRoutes) {
    writeRouteHtml(route, baseHtml);
  }

  // Steps 5-6: sitemap covers SSOT + dynamic blog/product + intent + pillar +
  // wissen (P5 semantic graph, sitemap-only on Lovable Hosting).
  buildSitemaps([
    ...ssotRoutes, ...dynamicRoutes, ...intentRoutes, ...pillarRoutes, ...wissenRoutes,
  ]);

  // Step 7: validate generated HTML on disk
  postValidateHtml([...live, ...intentRoutes, ...pillarRoutes]);

  const blogCount = dynamicRoutes.filter((r) => r.kind === "blog").length;
  const productCount = dynamicRoutes.filter((r) => r.kind === "product").length;
  console.log(
    `[seo-prerender] Wrote ${live.length} SSOT + ${intentRoutes.length} intent + ${pillarRoutes.length} pillar route HTMLs; sitemap also includes ${blogCount} blog + ${productCount} product + ${wissenRoutes.length} wissen URLs`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runSeoPrerender().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
