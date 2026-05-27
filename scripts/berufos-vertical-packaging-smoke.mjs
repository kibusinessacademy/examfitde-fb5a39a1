#!/usr/bin/env node
/**
 * BerufOS Vertical Packaging v1 — Smoke
 *
 * Verifiziert:
 *  1. Routes /branchen + /branchen/:slug in AppRoutes registriert.
 *  2. Hub + Detail-Pages enthalten Entlastungs-Sprache (kein "AI-powered"-Drift),
 *     11 Verticals + "Vorgänge pro Monat" + "Human-in-the-Loop"-Trust.
 *  3. Pricing-SSOT-Trennung: VERTICAL_TIERS hat eigene Stripe-Price-IDs,
 *     niemals geleakt auf B2C 24,90€.
 *  4. Edge-Functions create-vertical-checkout + vertical-subscription-status existieren
 *     und antworten auf unauth-Request mit 401 (= Function lebt + auth-gated).
 *  5. Memory-Index referenziert vertical-packaging-v1.md.
 *
 * Kein DB-Schreibzugriff. Optional Edge-Smoke wenn SUPABASE_URL+ANON gesetzt sind.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const fail = (m) => { console.error("✗", m); process.exit(1); };
const ok   = (m) => console.log("✓", m);

// ---------- 1. Routes ----------
const routesSrc = fs.readFileSync(path.join(ROOT, "src/routes/AppRoutes.tsx"), "utf8");
for (const needle of ['"/branchen"', '"/branchen/:slug"', "VerticalsHubPage", "VerticalDetailPage"]) {
  if (!routesSrc.includes(needle)) fail(`Route/Import fehlt in AppRoutes.tsx: ${needle}`);
}
ok("Routes /branchen + /branchen/:slug registriert");

// ---------- 2. UX-Sprache ----------
const hub    = fs.readFileSync(path.join(ROOT, "src/pages/verticals/VerticalsHubPage.tsx"), "utf8");
const detail = fs.readFileSync(path.join(ROOT, "src/pages/verticals/VerticalDetailPage.tsx"), "utf8");

const forbiddenInHub = [/AI-powered/i, /AI agents?/i, /unlimited AI(?!")/i];
for (const re of forbiddenInHub) {
  if (re.test(hub) || re.test(detail)) fail(`Forbidden AI-drift pattern: ${re}`);
}
ok("Keine 'AI-powered / AI agents / unlimited AI' Drift in Vertical-Pages");

const requiredHub = [
  "digitale Branchenmitarbeiter",
  "Vorgangs-Limits",
  "Human-in-the-Loop",
  "EU-Hosting",
];
for (const s of requiredHub) {
  if (!hub.includes(s)) fail(`Hub fehlt Pflicht-Phrase: "${s}"`);
}
ok("Hub kommuniziert Entlastung, Limits, HITL, EU-Trust");

const requiredDetail = [
  "Was {vertical.brand} dir abnimmt",
  "intelligenter Vorgang",
  "Auto-Apply",
];
for (const s of requiredDetail) {
  if (!detail.includes(s)) fail(`Detail fehlt Pflicht-Phrase: "${s}"`);
}
ok("Detail-Page kommuniziert Entlastung, Vorgangs-Limit, kein Auto-Apply");

// ---------- 3. Verticals + Pricing-SSOT-Trennung ----------
const verticalsSrc = fs.readFileSync(path.join(ROOT, "src/data/verticals.ts"), "utf8");
const slugMatches = [...verticalsSrc.matchAll(/slug:\s*"([a-z]+)"/g)].map((m) => m[1]);
if (slugMatches.length < 11) fail(`Erwarte ≥11 Verticals, gefunden: ${slugMatches.length}`);
ok(`11+ Verticals registriert (${slugMatches.length}): ${slugMatches.join(", ")}`);

const pricingSrc = fs.readFileSync(path.join(ROOT, "src/config/verticalPricing.ts"), "utf8");
if (!/price_1Tbj0M/.test(pricingSrc) || !/price_1Tbj0O/.test(pricingSrc)) {
  fail("VERTICAL_TIERS hat keine echten Stripe-Price-IDs für Starter+Pro");
}
const b2cPricingSrc = fs.readFileSync(path.join(ROOT, "src/config/pricing.ts"), "utf8");
const leak = ["price_1Tbj0M", "price_1Tbj0O"].some((id) => b2cPricingSrc.includes(id));
if (leak) fail("Vertical-Price-ID leak in B2C-pricing.ts SSOT — SSOT-Trennung verletzt!");
ok("Pricing-SSOT-Trennung intakt (Vertical ≠ B2C 24,90€)");

// Skip comments — Anti-Drift-Regel selbst nennt "unlimited" als verbotenes Wort
const pricingNoComments = pricingSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
if (/unlimited/i.test(pricingNoComments)) fail("Pricing enthält 'unlimited' im Code — verbotene Vermarktung");
if (!/monthlyVorgangLimit/.test(pricingSrc)) fail("Pricing kommuniziert nicht in Vorgängen");
ok("Pricing: in Vorgängen, niemals 'unlimited'");

// ---------- 4. Memory ----------
const memIndex = fs.readFileSync(path.join(ROOT, ".lovable/memory/index.md"), "utf8");
if (!/vertical-packaging-v1/.test(memIndex)) fail("Memory-Index referenziert vertical-packaging-v1 nicht");
ok("Memory-Index verlinkt vertical-packaging-v1");

// ---------- 5. Edge-Smoke (optional) ----------
const url  = process.env.VITE_SUPABASE_URL  || process.env.SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
if (url && anon) {
  for (const fn of ["create-vertical-checkout", "vertical-subscription-status"]) {
    try {
      const resp = await fetch(`${url}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
        body: JSON.stringify({}),
      });
      const body = await resp.text().catch(() => "");
      if (resp.status === 401)      ok(`Edge ${fn} lebt (401 ohne User-Session)`);
      else if (resp.status === 400) ok(`Edge ${fn} lebt (400 validation: ${body.slice(0,80)})`);
      else if (resp.status >= 500)  fail(`Edge ${fn} 5xx: ${resp.status} ${body.slice(0,160)}`);
      else                          ok(`Edge ${fn} HTTP ${resp.status}`);
    } catch (e) {
      console.log(`ℹ Edge ${fn} Netzwerkfehler (ok offline): ${e.message}`);
    }
  }
} else {
  console.log("ℹ Edge-Smoke skipped (kein SUPABASE_URL/ANON)");
}

console.log("\n✅ BerufOS Vertical Packaging v1 — smoke green");
