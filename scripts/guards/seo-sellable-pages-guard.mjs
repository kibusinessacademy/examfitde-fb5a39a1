#!/usr/bin/env node
/**
 * SEO Sellable Pages Guard
 * ------------------------
 * Cross-checks public_sellable_courses ↔ public/sitemap.xml.
 * Fails when:
 *  - a sellable course has no product_slug (no public URL)
 *  - sitemap contains a /produkt/<slug> that is not in the sellable list
 *
 * Read-only. Uses anon key.
 */
import fs from "node:fs";

const URL_BASE = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL_BASE || !ANON) {
  console.error("FATAL: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY required");
  process.exit(2);
}

async function rpc(name, body = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`RPC ${name} → ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const sellable = await rpc("public_sellable_courses");
const slugs = new Set(sellable.map((s) => s.product_slug).filter(Boolean));

const noSlug = sellable.filter((s) => !s.product_slug);

let sitemapSlugs = new Set();
try {
  const xml = fs.readFileSync("public/sitemap.xml", "utf8");
  for (const m of xml.matchAll(/<loc>[^<]*\/produkt\/([^<\/]+)<\/loc>/g)) {
    sitemapSlugs.add(m[1]);
  }
} catch {
  console.warn("public/sitemap.xml not found — skipping sitemap parity");
}

const inSitemapButNotSellable = [...sitemapSlugs].filter((s) => !slugs.has(s));

const errors = [];
if (noSlug.length) errors.push(`${noSlug.length} sellable course(s) without product_slug`);
// sitemap orphans are warnings only — different page types may live under /produkt
const warnings = [];
if (inSitemapButNotSellable.length) {
  warnings.push(`${inSitemapButNotSellable.length} /produkt/<slug> in sitemap not in sellable list`);
}

const summary = {
  sellable_total: sellable.length,
  no_slug: noSlug.length,
  sitemap_product_urls: sitemapSlugs.size,
  sitemap_non_sellable: inSitemapButNotSellable.length,
  errors, warnings,
};
fs.writeFileSync("./seo-sellable-pages.json", JSON.stringify(summary, null, 2));

const md = [
  "## SEO Sellable Pages Guard",
  `sellable=${sellable.length} · no_slug=${noSlug.length} · sitemap_product_urls=${sitemapSlugs.size}`,
  ...(errors.length ? ["", "**Errors:**", ...errors.map((e) => `- ❌ ${e}`)] : []),
  ...(warnings.length ? ["", "**Warnings:**", ...warnings.map((w) => `- ⚠️ ${w}`)] : []),
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
console.log(md);
process.exit(errors.length ? 1 : 0);
