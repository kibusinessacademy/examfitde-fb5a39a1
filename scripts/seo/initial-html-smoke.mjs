#!/usr/bin/env node
/**
 * Initial-HTML Smoke (Loop C3 — Cloudflare Pages Pilot Matrix)
 * --------------------------------------------------------------
 * Verifies that the host serves PER-ROUTE static HTML for prerendered
 * intent pages — i.e. SPA fallback was bypassed and dist/<path>/index.html
 * is what reached the user / crawler.
 *
 * Matrix (per sample URL unless noted):
 *   1. HTTP 200
 *   2. <title>          matches DB seo_content_pages.title
 *   3. <meta description> matches DB meta_description
 *   4. <h1> in raw HTML matches sections_json.h1
 *   5. JSON-LD Article (+ FAQ + BreadcrumbList recommended)
 *   6. OG-Tags (og:title / og:description / og:url / og:type)
 *   7. canonical = https://berufos.com<path>
 *   8. 404 route → real 404 status (one-shot)
 *   9. /sitemap.xml reachable, valid XML (one-shot)
 *  10. JS-disabled equivalent: same raw-HTML check (no JS executed by fetch);
 *      we additionally re-fetch with a plain UA + a Googlebot UA + Facebook +
 *      LinkedIn + Twitterbot UA and confirm parity (one-shot per URL).
 *  11. LinkedIn / Facebook / Google preview readiness: derived from points
 *      2/3/6/7 + Article LD; we surface a single boolean per URL.
 *
 * Usage:
 *   HOST=https://examfit.pages.dev node scripts/seo/initial-html-smoke.mjs
 *   HOST=https://berufos.com        node scripts/seo/initial-html-smoke.mjs
 *   HOST=https://examfit.pages.dev SAMPLE=5 node scripts/seo/initial-html-smoke.mjs
 *
 * Exit non-zero on any failure → CI-grade verdict.
 */
import fs from "node:fs";
import path from "node:path";

const HOST = (process.env.HOST || "https://berufos.com").replace(/\/$/, "");
const SAMPLE = Number(process.env.SAMPLE || 3);

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
const envFile = readEnvFallback();
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL ||
  envFile.SUPABASE_URL || envFile.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  envFile.SUPABASE_PUBLISHABLE_KEY || envFile.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("[smoke] missing SUPABASE_URL/KEY");
  process.exit(2);
}

const UAS = {
  default:    "Mozilla/5.0 (initial-html-smoke)",
  googlebot:  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  facebook:   "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  linkedin:   "LinkedInBot/1.0 (compatible; Mozilla/5.0; +https://www.linkedin.com)",
  twitter:    "Twitterbot/1.0",
};

async function fetchSamplePages() {
  const url =
    `${SUPABASE_URL}/rest/v1/seo_content_pages` +
    `?select=slug,title,meta_description,sections_json` +
    `&status=eq.published&intent_template=not.is.null` +
    `&order=last_generated_at.desc&limit=${SAMPLE}`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`DB fetch ${res.status}`);
  return res.json();
}

function pickMeta(html, regex) {
  const m = html.match(regex);
  return m ? m[1] : null;
}

function inspect(html) {
  return {
    title: pickMeta(html, /<title>([^<]+)<\/title>/i),
    desc:  pickMeta(html, /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i),
    canon: pickMeta(html, /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i),
    h1:    pickMeta(html, /<h1[^>]*>([^<]+)<\/h1>/i),
    ogTitle:       pickMeta(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i),
    ogDescription: pickMeta(html, /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i),
    ogUrl:         pickMeta(html, /<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i),
    ogType:        pickMeta(html, /<meta\s+property=["']og:type["']\s+content=["']([^"']+)["']/i),
    hasArticleLd:    /"@type"\s*:\s*"Article"/i.test(html),
    hasFaqLd:        /"@type"\s*:\s*"FAQPage"/i.test(html),
    hasBreadcrumbLd: /"@type"\s*:\s*"BreadcrumbList"/i.test(html),
    bytes: html.length,
  };
}

async function checkUrl(host, page) {
  const url = `${host}/kurse/${page.slug}`;

  // Per-UA parity (point 10/11): default + 4 crawler UAs.
  const variants = {};
  for (const [name, ua] of Object.entries(UAS)) {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": ua } });
    const html = await res.text();
    variants[name] = { status: res.status, ...inspect(html) };
  }
  const base = variants.default;
  const errs = [];

  if (base.status !== 200) errs.push(`status=${base.status}`);

  // 2. Title
  if (!base.title) errs.push("no <title>");
  else if (!page.title.startsWith(base.title.slice(0, 30)) &&
           !base.title.includes(page.title.slice(0, 30)))
    errs.push(`title drift: got "${base.title.slice(0, 60)}"`);

  // 3. Description
  if (!base.desc) errs.push("no description");
  else if (page.meta_description && base.desc !== page.meta_description)
    errs.push("description drift");

  // 4. H1 in raw HTML (= JS-disabled equivalent)
  const expectedH1 = (page.sections_json && page.sections_json.h1) || page.title;
  if (!base.h1) errs.push("no <h1> (JS-disabled FAIL)");
  else if (base.h1.trim().slice(0, 30) !== expectedH1.trim().slice(0, 30))
    errs.push(`h1 drift: got "${base.h1.slice(0, 60)}" expected "${expectedH1.slice(0, 60)}"`);

  // 5. JSON-LD
  if (!base.hasArticleLd) errs.push("no Article JSON-LD");

  // 6. OG-Tags (all four required for crawler previews)
  for (const k of ["ogTitle", "ogDescription", "ogUrl", "ogType"]) {
    if (!base[k]) errs.push(`missing ${k}`);
  }

  // 7. Canonical
  const expectedCanonical = `https://berufos.com/kurse/${page.slug}`;
  if (base.canon !== expectedCanonical)
    errs.push(`canonical drift: got "${base.canon}" expected "${expectedCanonical}"`);

  // 10. UA-Parität: title + h1 + canonical müssen für ALLE Crawler identisch zur default-Antwort sein.
  for (const [name, v] of Object.entries(variants)) {
    if (name === "default") continue;
    if (v.title !== base.title)   errs.push(`UA[${name}] title drift`);
    if (v.h1    !== base.h1)      errs.push(`UA[${name}] h1 drift`);
    if (v.canon !== base.canon)   errs.push(`UA[${name}] canonical drift`);
  }

  // 11. Preview-Readiness (LinkedIn/Facebook/Google) → derived
  const previewReady =
    !!base.ogTitle && !!base.ogDescription && !!base.ogUrl && !!base.ogType &&
    base.hasArticleLd;

  return {
    url,
    ok: errs.length === 0,
    base,
    variantStatuses: Object.fromEntries(
      Object.entries(variants).map(([k, v]) => [k, v.status])
    ),
    previewReady,
    errors: errs,
  };
}

async function checkSitemap(host) {
  const res = await fetch(`${host}/sitemap.xml`);
  const body = await res.text();
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    ok: res.ok && /<sitemapindex|<urlset/i.test(body),
    bytes: body.length,
  };
}

async function check404(host) {
  const url = `${host}/__definitely_does_not_exist_${Date.now()}`;
  const res = await fetch(url, { redirect: "manual" });
  return { url, status: res.status, ok: res.status === 404 };
}

async function checkNoindexHeader(host) {
  const res = await fetch(`${host}/dashboard`, { method: "HEAD", redirect: "manual" });
  return {
    status: res.status,
    xRobotsTag: res.headers.get("x-robots-tag"),
    cacheControl: res.headers.get("cache-control"),
  };
}

(async () => {
  console.log(`\n=== Initial-HTML Smoke against ${HOST} ===\n`);
  const pages = await fetchSamplePages();
  if (pages.length === 0) {
    console.error("[smoke] no published intent pages — abort");
    process.exit(2);
  }

  const results = [];
  for (const p of pages) {
    const r = await checkUrl(HOST, p);
    results.push(r);
    console.log(
      `${r.ok ? "✅" : "❌"} ${r.url}\n` +
        `   status(default/google/fb/li/tw)=${r.variantStatuses.default}/${r.variantStatuses.googlebot}/${r.variantStatuses.facebook}/${r.variantStatuses.linkedin}/${r.variantStatuses.twitter}\n` +
        `   bytes=${r.base.bytes}  Article=${r.base.hasArticleLd}  FAQ=${r.base.hasFaqLd}  Breadcrumb=${r.base.hasBreadcrumbLd}  Preview-Ready=${r.previewReady}\n` +
        `   <h1>: ${r.base.h1}\n` +
        `   <title>: ${r.base.title}\n` +
        `   og:title: ${r.base.ogTitle || "(missing)"}\n` +
        `   canonical: ${r.base.canon}\n`
    );
    if (!r.ok) console.log(`   ✗ ${r.errors.join("; ")}\n`);
  }

  const sitemap = await checkSitemap(HOST);
  console.log(`Sitemap:           ${sitemap.ok ? "✅" : "❌"}  status=${sitemap.status}  ${sitemap.contentType}  ${sitemap.bytes}B`);

  const four04 = await check404(HOST);
  console.log(`404 route:         ${four04.ok ? "✅" : "❌"}  status=${four04.status}  ${four04.url}`);

  const noindex = await checkNoindexHeader(HOST);
  const noindexOk = /noindex/i.test(noindex.xRobotsTag || "");
  console.log(`Noindex /dashboard: ${noindexOk ? "✅" : "⚠️ "} status=${noindex.status}  X-Robots-Tag=${noindex.xRobotsTag || "(none)"}\n`);

  const failed = results.filter((r) => !r.ok).length;
  const previewReadyCount = results.filter((r) => r.previewReady).length;

  console.log(`=== Verdict ===`);
  console.log(`URLs pass:          ${results.length - failed}/${results.length}`);
  console.log(`Preview-ready:      ${previewReadyCount}/${results.length}  (LinkedIn/Facebook/Google rich previews)`);
  console.log(`Sitemap OK:         ${sitemap.ok}`);
  console.log(`404 OK:             ${four04.ok}`);
  console.log(`Noindex Header:     ${noindexOk}  (warn-only on Lovable; required on CF Pages)`);
  console.log("");

  // Hard-fail conditions: per-route HTML + sitemap + 404. Noindex header is
  // warn-only because Lovable hosting doesn't honour _headers.
  if (failed > 0 || !sitemap.ok || !four04.ok) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
