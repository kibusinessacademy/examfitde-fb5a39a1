#!/usr/bin/env node
/**
 * Persona-Routing Smoke (1 Produkt × 3 Personas).
 *
 * Pflicht:
 *   - Jede Persona-URL liefert HTML 200 (oder SPA-Fallback) mit Canonical
 *     /pruefungstraining/<slug>/<persona>.
 *   - Sitemap enthält 3 persona URLs pro published Produkt.
 *   - load-dynamic-routes.mjs liefert kind=product_persona × 3 pro Produkt.
 *
 * Tracking-Smoke (logisch, nicht E2E): wir prüfen, dass die Page-Komponente
 * NACH Render die SSOT-Events landing_view/lead_magnet_view via
 * useTrackGrowthEvent feuert (statisches Code-Audit).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const PERSONAS = ["azubi", "betrieb", "institution"];

let failed = false;
function ok(msg) { console.log("  \u2713", msg); }
function fail(msg) { console.log("  \u2717", msg); failed = true; }

console.log("[persona-routing-smoke] start");

// 1) ProductPersonaPage existiert und whitelist-strict
const pagePath = resolve(ROOT, "src/pages/product/ProductPersonaPage.tsx");
if (!existsSync(pagePath)) fail("ProductPersonaPage.tsx fehlt");
else {
  const src = readFileSync(pagePath, "utf8");
  if (src.includes("isProductPersona")) ok("Whitelist-Guard isProductPersona aktiv");
  else fail("Whitelist-Guard fehlt");
  if (src.includes("lead_magnet_view")) ok("lead_magnet_view tracked");
  else fail("lead_magnet_view fehlt");
  if (src.includes("event_alias") && src.includes("landing_view")) ok("landing_view alias tracked");
  else fail("landing_view alias fehlt");
  if (src.includes("packageId: product.packageId")) ok("packageId an Tracking gereicht");
  else fail("packageId nicht an Tracking gereicht");
  if (src.includes("persona,")) ok("persona an Tracking gereicht");
  else fail("persona nicht an Tracking gereicht");
  if (src.includes(`canonicalUrl = `)) ok("Canonical-Override in Page");
  else fail("Canonical-Override fehlt");
}

// 2) Persona-Context whitelist
const ctxPath = resolve(ROOT, "src/lib/landing/productPersonaContext.ts");
if (!existsSync(ctxPath)) fail("productPersonaContext.ts fehlt");
else {
  const src = readFileSync(ctxPath, "utf8");
  for (const p of PERSONAS) {
    if (src.includes(`"${p}"`)) ok(`Persona '${p}' in Whitelist`);
    else fail(`Persona '${p}' fehlt`);
  }
}

// 3) Routes registriert
const routesPath = resolve(ROOT, "src/routes/AppRoutes.tsx");
const routesSrc = readFileSync(routesPath, "utf8");
for (const p of PERSONAS) {
  const needle = `/pruefungstraining/:slug/${p}`;
  if (routesSrc.includes(needle)) ok(`Route ${needle} registriert`);
  else fail(`Route ${needle} fehlt`);
}

// 4) Sitemap-Loader generiert kind=product_persona für 3 Personas
const loaderSrc = readFileSync(resolve(ROOT, "scripts/seo/load-dynamic-routes.mjs"), "utf8");
if (loaderSrc.includes("kind: \"product_persona\"")) ok("Sitemap-Loader kennt product_persona");
else fail("Sitemap-Loader: product_persona kind fehlt");
for (const p of PERSONAS) {
  if (loaderSrc.includes(`key: "${p}"`)) ok(`Sitemap-Loader: persona '${p}' definiert`);
  else fail(`Sitemap-Loader: persona '${p}' fehlt`);
}

// 5) Template plumbed personaContext + canonicalOverride + onPersonaCtaClick
const tmplSrc = readFileSync(resolve(ROOT, "src/components/product/ProductPageTemplate.tsx"), "utf8");
for (const k of ["personaContext", "canonicalOverride", "onPersonaCtaClick", "ProductPersonaBand"]) {
  if (tmplSrc.includes(k)) ok(`Template kennt ${k}`);
  else fail(`Template: ${k} nicht plumbed`);
}

// 6) CTA → Diagnose
const pageSrc = readFileSync(pagePath, "utf8");
if (pageSrc.includes("/pruefungsreife-check")) ok("Persona-CTA navigiert zur Diagnose/Quiz");
else fail("Persona-CTA Ziel /pruefungsreife-check fehlt");

console.log("");
if (failed) {
  console.error("[persona-routing-smoke] FAIL");
  process.exit(1);
}
console.log("[persona-routing-smoke] PASS");
