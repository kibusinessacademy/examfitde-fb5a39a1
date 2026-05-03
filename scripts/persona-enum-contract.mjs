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

// 2) DB-Enum direkt via pg_enum (RPC get_enum_values)
const enumRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_enum_values`, {
  method: "POST",
  headers: {
    apikey: ANON,
    Authorization: `Bearer ${ANON}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ enum_name: "product_persona" }),
});
if (!enumRes.ok) {
  fail(`get_enum_values RPC failed: ${enumRes.status} ${await enumRes.text()}`);
} else {
  const dbEnum = (await enumRes.json() ?? []).slice().sort();
  ok(`DB pg_enum product_persona: [${dbEnum.join(", ")}]`);

  const missingInDb = fePersonas.filter((p) => !dbEnum.includes(p));
  const extraInDb = dbEnum.filter((p) => !fePersonas.includes(p));
  if (missingInDb.length === 0) ok("Alle FE-Personas existieren in DB-Enum");
  else fail(`FE hat Personas ohne DB-Enum-Wert: ${missingInDb.join(", ")}`);

  if (extraInDb.length === 0) ok("Keine Drift: DB-Enum ⊆ FE-Whitelist");
  else fail(`DB-Enum enthält unbekannte Werte: ${extraInDb.join(", ")}`);

  if (dbEnum.includes("umschulung")) fail("Legacy 'umschulung' im DB-Enum vorhanden");
}

// 2b) Overlay-Coverage (warn-only)
const overlaysRes = await fetch(
  `${SUPABASE_URL}/rest/v1/product_persona_overlays?select=persona_type&is_active=eq.true`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
);
if (overlaysRes.ok) {
  const rows = await overlaysRes.json();
  const overlayValues = [...new Set(rows.map((r) => r.persona_type))].sort();
  ok(`Active overlay persona_type: [${overlayValues.join(", ")}]`);
  const noOverlay = fePersonas.filter((p) => !overlayValues.includes(p));
  if (noOverlay.length) console.log(`  ⚠ Personas ohne aktives Overlay: ${noOverlay.join(", ")} (warn)`);
  if (overlayValues.includes("umschulung")) fail("Legacy 'umschulung' in product_persona_overlays");
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
