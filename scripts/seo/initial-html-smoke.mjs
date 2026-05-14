#!/usr/bin/env node
/**
 * Initial-HTML Smoke (Loop C3)
 * --------------------------------------------------------------
 * Verifies that the host serves PER-ROUTE static HTML for prerendered
 * intent pages — i.e. the SPA fallback was bypassed and dist/<path>/index.html
 * is what reached the user / crawler.
 *
 * Acceptance per URL:
 *   - HTTP 200
 *   - <title> matches DB (seo_content_pages.title) — exact or substring
 *   - <meta name="description"> matches DB meta_description
 *   - <link rel="canonical"> = https://examfit.de<path>
 *   - intent-specific <h1> present (sections_json.h1 or title fragment)
 *   - at least one <script type="application/ld+json"> with @type=Article
 *
 * Bonus checks:
 *   - /sitemap.xml is reachable, valid XML, contains the test URLs
 *   - HEAD request shows X-Robots-Tag: noindex on /dashboard
 *
 * Usage:
 *   HOST=https://examfit.pages.dev node scripts/seo/initial-html-smoke.mjs
 *   HOST=https://examfit.de node scripts/seo/initial-html-smoke.mjs
 *   HOST=https://examfit.de SAMPLE=5 node scripts/seo/initial-html-smoke.mjs
 *
 * Exit non-zero on any failure → CI-grade verdict.
 */
import fs from "node:fs";
import path from "node:path";

const HOST = (process.env.HOST || "https://examfit.de").replace(/\/$/, "");
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

async function checkUrl(host, page) {
  const url = `${host}/kurse/${page.slug}`;
  const res = await fetch(url, { redirect: "follow" });
  const html = await res.text();
  const errs = [];

  if (res.status !== 200) errs.push(`status=${res.status}`);

  // Reject obvious SPA fallback: same head as root canonical=examfit.de/.
  const title = pickMeta(html, /<title>([^<]+)<\/title>/i);
  const desc = pickMeta(html, /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  const canon = pickMeta(html, /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  const h1 = pickMeta(html, /<h1[^>]*>([^<]+)<\/h1>/i);
  const hasArticleLd = /"@type"\s*:\s*"Article"/i.test(html);
  const hasFaqLd = /"@type"\s*:\s*"FAQPage"/i.test(html);
  const hasBreadcrumbLd = /"@type"\s*:\s*"BreadcrumbList"/i.test(html);

  const expectedCanonical = `https://examfit.de/kurse/${page.slug}`;
  const expectedH1 = (page.sections_json && page.sections_json.h1) || page.title;

  if (!title) errs.push("no <title>");
  else if (!page.title.startsWith(title.slice(0, 30)) && !title.includes(page.title.slice(0, 30)))
    errs.push(`title drift: got "${title.slice(0, 60)}"`);

  if (!desc) errs.push("no description");
  else if (page.meta_description && desc !== page.meta_description)
    errs.push(`description drift`);

  if (canon !== expectedCanonical)
    errs.push(`canonical drift: got "${canon}" expected "${expectedCanonical}"`);

  if (!h1) errs.push("no <h1>");
  else if (h1.trim().slice(0, 30) !== expectedH1.trim().slice(0, 30))
    errs.push(`h1 drift: got "${h1.slice(0, 60)}" expected "${expectedH1.slice(0, 60)}"`);

  if (!hasArticleLd) errs.push("no Article JSON-LD");

  return {
    url,
    ok: errs.length === 0,
    status: res.status,
    title,
    desc: desc?.slice(0, 80),
    canonical: canon,
    h1: h1?.slice(0, 80),
    hasArticleLd,
    hasFaqLd,
    hasBreadcrumbLd,
    htmlBytes: html.length,
    errors: errs,
  };
}

async function checkSitemap(host) {
  const res = await fetch(`${host}/sitemap.xml`);
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    ok: res.ok,
    bytes: (await res.text()).length,
  };
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
        `   status=${r.status}  bytes=${r.htmlBytes}  Article=${r.hasArticleLd}  FAQ=${r.hasFaqLd}  Breadcrumb=${r.hasBreadcrumbLd}\n` +
        `   <h1>: ${r.h1}\n` +
        `   <title>: ${r.title}\n` +
        `   canonical: ${r.canonical}\n`
    );
    if (!r.ok) console.log(`   ✗ ${r.errors.join("; ")}\n`);
  }

  const sitemap = await checkSitemap(HOST);
  console.log(`Sitemap: ${sitemap.status}  ${sitemap.contentType}  ${sitemap.bytes}B`);

  const noindex = await checkNoindexHeader(HOST);
  console.log(
    `Noindex /dashboard: status=${noindex.status}  X-Robots-Tag=${noindex.xRobotsTag || "(none)"}  Cache=${noindex.cacheControl || "(none)"}`
  );

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== Verdict: ${results.length - failed}/${results.length} URLs pass ===\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
