#!/usr/bin/env node
/**
 * Sitemap ↔ Canonical Parity Check
 * --------------------------------
 * Prüft, dass jede in der Sitemap-Edge-Function gelistete Cluster-URL
 * als canonical={`${SITE_URL}<route>`} in genau einer SEO-Page existiert
 * und umgekehrt jede SEO-Cluster-Page in der Sitemap registriert ist.
 *
 * Exit 1 bei Drift → CI-Fail.
 *
 * Usage:  node scripts/seo/sitemap-canonical-parity.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SITEMAP_FN = path.join(ROOT, "supabase/functions/generate-sitemap/index.ts");
const SEO_DIR = path.join(ROOT, "src/pages/seo");

// Whitelist: nur diese Routen werden geprüft (statische Cluster + Quiz + AEVO)
const TRACKED_PREFIXES = [
  "/aevo-",
  "/bilanzbuchhalter-",
  "/fiae-",
  "/fachinformatiker-",
  "/wirtschaftsfachwirt-",
  "/quiz/",
];

const sitemapSrc = fs.readFileSync(SITEMAP_FN, "utf8");

// URLs aus Sitemap extrahieren
const sitemapUrls = new Set();
const re = /\$\{SITE_URL\}(\/[a-z0-9/_-]+)/g;
let m;
while ((m = re.exec(sitemapSrc)) !== null) {
  const u = m[1];
  if (TRACKED_PREFIXES.some((p) => u.startsWith(p))) sitemapUrls.add(u);
}

// Canonicals aus SEO-Pages
const canonicalToFile = new Map();
for (const file of fs.readdirSync(SEO_DIR)) {
  if (!file.endsWith(".tsx")) continue;
  const src = fs.readFileSync(path.join(SEO_DIR, file), "utf8");
  const canonRe = /canonical=\{`\$\{SITE_URL\}([^`]+)`\}/g;
  let cm;
  while ((cm = canonRe.exec(src)) !== null) {
    const c = cm[1];
    if (!TRACKED_PREFIXES.some((p) => c.startsWith(p))) continue;
    if (canonicalToFile.has(c)) {
      console.error(`[DUP] canonical "${c}" used in both ${canonicalToFile.get(c)} and ${file}`);
      process.exitCode = 1;
    }
    canonicalToFile.set(c, file);
  }
}

const missingInPages = [...sitemapUrls].filter((u) => !canonicalToFile.has(u) && !u.startsWith("/quiz/"));
const missingInSitemap = [...canonicalToFile.keys()].filter((c) => !sitemapUrls.has(c));

console.log(`\n=== Sitemap ↔ Canonical Parity ===`);
console.log(`Sitemap tracked URLs : ${sitemapUrls.size}`);
console.log(`Page canonicals      : ${canonicalToFile.size}`);
console.log(`Missing in pages     : ${missingInPages.length}`);
console.log(`Missing in sitemap   : ${missingInSitemap.length}\n`);

if (missingInPages.length) {
  console.log("--- In sitemap but no SEO-page canonical ---");
  missingInPages.forEach((u) => console.log("  " + u));
}
if (missingInSitemap.length) {
  console.log("\n--- Page canonical but missing in sitemap ---");
  missingInSitemap.forEach((u) => console.log("  " + u));
}
if (missingInPages.length || missingInSitemap.length) {
  process.exit(1);
}
console.log("✅ Parity OK.");
