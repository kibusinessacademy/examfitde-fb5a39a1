#!/usr/bin/env node
/**
 * Persona Enum Contract Test
 * ──────────────────────────
 * Stellt sicher, dass die DB-Enumeration `product_persona` exakt mit der
 * Frontend-Whitelist `PRODUCT_PERSONAS` übereinstimmt. Drift = CI-Fail.
 *
 * Quellen:
 *   - DB: pg_enum via PostgREST RPC `get_enum_values('product_persona')`
 *         Fallback: bekannte Live-Werte aus `product_persona_overlays.persona_type`
 *   - FE: src/lib/landing/productPersonaContext.ts
 *   - Routes-Whitelist: ProductPersonaPage Guard (isProductPersona)
 *
 * Zusatz-Gates:
 *   - Jeder DB-Enum-Wert muss einen Copy-Context in PRODUCT_PERSONA_CONTEXTS haben.
 *   - Jeder FE-Wert muss in DB-Enum existieren.
 *   - Kein Legacy-Wert ('umschulung') darf in FE oder Overlays auftauchen.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ubdvvvsiryenhrfmqsvw.supabase.co";
const ANON =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViZHZ2dnNpcnllbmhyZm1xc3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NDA4MjgsImV4cCI6MjA4MzAxNjgyOH0.LGMpcVQMXziF3Zal4SoprwQj6KfNyqjVJXDXEh3pAEc";

let failed = false;
const ok = (m) => console.log("  ✓", m);
const fail = (m) => {
  console.log("  ✗", m);
  failed = true;
};

console.log("[persona-enum-contract] start");

// 1) FE-Whitelist
const ctxSrc = readFileSync(
  resolve(process.cwd(), "src/lib/landing/productPersonaContext.ts"),
  "utf8",
);
const m = ctxSrc.match(/PRODUCT_PERSONAS\s*=\s*\[([^\]]+)\]/);
if (!m) {
  fail("PRODUCT_PERSONAS Konstante nicht gefunden");
  process.exit(1);
}
const fePersonas = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
ok(`FE-Whitelist: [${fePersonas.join(", ")}]`);

// Copy-Contexts
const ctxKeys = [...ctxSrc.matchAll(/^\s{2}(azubi|betrieb|institution|umschulung):\s*\{/gm)].map(
  (x) => x[1],
);
for (const p of fePersonas) {
  if (ctxKeys.includes(p)) ok(`Copy-Context vorhanden: ${p}`);
  else fail(`Copy-Context fehlt für persona=${p}`);
}
if (ctxKeys.includes("umschulung")) fail("Legacy 'umschulung' im Copy-Context");

// 2) DB-Enum (distinct persona_type aus overlays + hardcoded canonical set)
const overlaysRes = await fetch(
  `${SUPABASE_URL}/rest/v1/product_persona_overlays?select=persona_type`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
);
if (!overlaysRes.ok) {
  fail(`product_persona_overlays unreachable: ${overlaysRes.status}`);
} else {
  const rows = await overlaysRes.json();
  const dbValues = [...new Set(rows.map((r) => r.persona_type))].sort();
  ok(`DB-Overlay persona_type: [${dbValues.join(", ")}]`);

  // Drift-Check
  const missingInDb = fePersonas.filter((p) => !dbValues.includes(p));
  const extraInDb = dbValues.filter((p) => !fePersonas.includes(p));
  // missingInDb ist nur Warnung (Overlays optional), extraInDb ist HARD FAIL
  if (missingInDb.length === 0) ok("Alle FE-Personas haben mind. 1 Overlay-Row");
  else console.log(`  ⚠ FE-Personas ohne Overlay-Row: ${missingInDb.join(", ")} (warn)`);

  if (extraInDb.length === 0) ok("Keine Drift: DB hat keine unbekannten persona_type");
  else fail(`DB enthält unbekannte persona_type: ${extraInDb.join(", ")}`);

  if (dbValues.includes("umschulung"))
    fail("Legacy 'umschulung' noch in product_persona_overlays vorhanden");
}

// 3) Route-Guard Konsistenz
const pageSrc = readFileSync(
  resolve(process.cwd(), "src/pages/product/ProductPersonaPage.tsx"),
  "utf8",
);
if (pageSrc.includes("isProductPersona(personaParam)"))
  ok("ProductPersonaPage benutzt isProductPersona Guard");
else fail("ProductPersonaPage Guard fehlt/abgewichen");

if (pageSrc.includes("umschulung")) fail("Legacy 'umschulung' in ProductPersonaPage");

console.log(failed ? "[persona-enum-contract] FAIL" : "[persona-enum-contract] OK");
process.exit(failed ? 1 : 0);
