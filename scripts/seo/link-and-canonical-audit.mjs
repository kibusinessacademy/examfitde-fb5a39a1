#!/usr/bin/env node
/**
 * SEO Link & Canonical Audit
 * --------------------------
 * - Statisch (AST/Regex): scannt SEO-Pages, extrahiert canonical + interne Links.
 * - Verifiziert: alle 8 neuen Cluster-Routen sind in AppRoutes registriert
 *                und in der Sitemap-Edge-Function gelistet.
 * - Verifiziert: jeder interne href existiert als Route oder ist eine bekannte Route.
 * - Exit 1 bei Fehlern → CI-Fail.
 *
 * Usage:  node scripts/seo/link-and-canonical-audit.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SEO_DIR = path.join(ROOT, "src/pages/seo");
const APP_ROUTES = path.join(ROOT, "src/routes/AppRoutes.tsx");
const SITEMAP_FN = path.join(ROOT, "supabase/functions/generate-sitemap/index.ts");

const NEW_ROUTES = [
  "/bilanzbuchhalter-pruefungsvorbereitung",
  "/bilanzbuchhalter-buchhaltung",
  "/bilanzbuchhalter-jahresabschluss",
  "/bilanzbuchhalter-steuern",
  "/fachinformatiker-ae-pruefungsvorbereitung",
  "/fiae-anwendungsentwicklung",
  "/fiae-wiso",
  "/fiae-projektarbeit",
];

const errors = [];
const warnings = [];

function read(p) { return fs.readFileSync(p, "utf8"); }

const appRoutes = read(APP_ROUTES);
const sitemap = read(SITEMAP_FN);

// 1) Routes existieren in AppRoutes
for (const r of NEW_ROUTES) {
  if (!appRoutes.includes(`path="${r}"`) && !appRoutes.includes(`path='${r}'`)) {
    errors.push(`[AppRoutes] missing route registration: ${r}`);
  }
}

// 2) Routes in Sitemap
for (const r of NEW_ROUTES) {
  if (!sitemap.includes(r)) {
    errors.push(`[Sitemap] missing URL: ${r}`);
  }
}

// 3) Per-Page: canonical matches its route + interne Links sind valide
const PAGE_TO_ROUTE = {
  "BilanzbuchhalterPruefungsvorbereitungPage.tsx": "/bilanzbuchhalter-pruefungsvorbereitung",
  "BilanzbuchhalterBuchhaltungPage.tsx": "/bilanzbuchhalter-buchhaltung",
  "BilanzbuchhalterJahresabschlussPage.tsx": "/bilanzbuchhalter-jahresabschluss",
  "BilanzbuchhalterSteuernPage.tsx": "/bilanzbuchhalter-steuern",
  "FIAEPruefungsvorbereitungPage.tsx": "/fachinformatiker-ae-pruefungsvorbereitung",
  "FIAEAnwendungsentwicklungPage.tsx": "/fiae-anwendungsentwicklung",
  "FIAEWiSoPage.tsx": "/fiae-wiso",
  "FIAEProjektarbeitPage.tsx": "/fiae-projektarbeit",
};

// Allowlist: bekannte interne Routen-Präfixe (regex)
const KNOWN_ROUTE_PATTERNS = [
  /^\/$/,
  /^\/quiz\/[a-z0-9-]+$/,
  /^\/lernplan\/[a-z0-9-]+$/,
  /^\/bundle\/[a-z0-9-]+$/,
  /^\/produkt\/[a-z0-9-]+$/,
  /^\/pruefungstraining(\/.*)?$/,
  /^\/bilanzbuchhalter-/,
  /^\/fiae-/,
  /^\/fachinformatiker-/,
  /^\/aevo-/,
  /^\/ihk-/,
  /^\/wirtschaftsfachwirt-/,
  /^\/blog(\/.*)?$/,
  /^\/preise$/,
  /^\/shop(\/.*)?$/,
];

function isKnownRoute(href) {
  if (!href.startsWith("/")) return true; // external/anchor – skip
  return KNOWN_ROUTE_PATTERNS.some((re) => re.test(href));
}

for (const [file, expectedRoute] of Object.entries(PAGE_TO_ROUTE)) {
  const fp = path.join(SEO_DIR, file);
  if (!fs.existsSync(fp)) {
    errors.push(`[FS] page missing: ${file}`);
    continue;
  }
  const src = read(fp);

  // Title-Länge (ohne " | ExamFit"-Suffix, das SEOHead automatisch anhängt)
  const titleMatch = src.match(/title="([^"]+)"/);
  if (titleMatch) {
    const t = titleMatch[1];
    const effective = t.includes("ExamFit") ? t : `${t} | ExamFit`;
    if (effective.length > 60) {
      warnings.push(`[Title>60] ${file}: ${effective.length} chars — "${effective}"`);
    }
  } else {
    errors.push(`[SEOHead] missing title in ${file}`);
  }

  // Description-Länge
  const descMatch = src.match(/description="([^"]+)"/);
  if (descMatch && descMatch[1].length > 160) {
    warnings.push(`[Desc>160] ${file}: ${descMatch[1].length} chars`);
  } else if (!descMatch) {
    errors.push(`[SEOHead] missing description in ${file}`);
  }

  // Canonical matches expected route
  const canonRe = /canonical=\{`\$\{SITE_URL\}([^`]+)`\}/;
  const canon = src.match(canonRe);
  if (!canon) {
    errors.push(`[Canonical] missing canonical in ${file}`);
  } else if (canon[1] !== expectedRoute) {
    errors.push(`[Canonical] mismatch in ${file}: got "${canon[1]}" expected "${expectedRoute}"`);
  }

  // H1 muss genau 1x existieren
  const h1Count = (src.match(/<h1[\s>]/g) || []).length;
  if (h1Count !== 1) {
    errors.push(`[H1] ${file} has ${h1Count} <h1> tags (expected 1)`);
  }

  // Interne Links extrahieren — to="/...", href="/..."
  const linkRe = /(?:to|href)=["']([/][^"'#?]*)/g;
  let m;
  const seen = new Set();
  while ((m = linkRe.exec(src)) !== null) {
    const href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    if (!isKnownRoute(href)) {
      warnings.push(`[Link?] ${file} → ${href} (unknown pattern)`);
    }
  }
}

// 4) Report
console.log(`\n=== SEO Link & Canonical Audit ===`);
console.log(`Pages checked : ${Object.keys(PAGE_TO_ROUTE).length}`);
console.log(`Errors        : ${errors.length}`);
console.log(`Warnings      : ${warnings.length}\n`);

if (warnings.length) {
  console.log("--- Warnings ---");
  warnings.forEach((w) => console.log("  " + w));
}
if (errors.length) {
  console.log("\n--- Errors ---");
  errors.forEach((e) => console.log("  " + e));
  process.exit(1);
}
console.log("\n✅ All checks passed.");
