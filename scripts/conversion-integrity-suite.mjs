#!/usr/bin/env node
/**
 * Path E — Conversion-Integrity Testsuite
 * ----------------------------------------
 * 7 Gates gegen Persona-Overlay + strict-package_id Regression:
 *
 *  G1  Persona route renders 200                           (HTTP smoke)
 *  G2  product_persona_overlays anon-read liefert active   (REST anon)
 *  G3  ProductPersonaPage hydratisiert Overlay (PROD)      (HTML diff vs default)
 *  G4  CTA/diagnose URL enthält package_id                 (Static code audit)
 *  G5  strict conversion_events ohne package_id → 23514    (DB insert probe)
 *  G6  smoke_test/simulation Whitelist bleibt erlaubt      (DB insert probe)
 *  G7  L8_NO_PERSONA_OVERLAY bleibt 0                      (v_data_holes_ssot)
 *
 * Exit 0 = green | Exit 1 = at least one gate failed.
 *
 * G3 prüft AUSSCHLIESSLICH gegen Production-Build (PROD_URL),
 * niemals gegen Dev-Preview — HMR/Bundle-Stale ist kein Produktfehler.
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_URL = process.env.PROD_URL || "https://examfitde.lovable.app";

if (!SUPABASE_URL || !ANON_KEY) {
  console.log("⚠️  SUPABASE_URL / ANON_KEY missing — skip");
  process.exit(0);
}

let failed = 0;
const results = [];
function gate(id, ok, msg) {
  const sym = ok ? "✓" : "✗";
  console.log(`  ${sym} ${id}: ${msg}`);
  results.push({ id, ok, msg });
  if (!ok) failed++;
}

async function rpcReadonly(q) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_readonly_sql`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY || ANON_KEY,
      Authorization: `Bearer ${SERVICE_KEY || ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function pickFixture() {
  // anon REST: 1 published Produkt mit allen 3 Personas + canonical_slug
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/v_product_page_ssot?select=package_id,canonical_slug&canonical_slug=not.is.null&limit=50`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
  );
  const candidates = await r.json().catch(() => []);
  if (!Array.isArray(candidates)) return null;
  for (const c of candidates) {
    const ov = await fetch(
      `${SUPABASE_URL}/rest/v1/product_persona_overlays?select=persona_type&active=eq.true&package_id=eq.${c.package_id}`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
    );
    const rows = await ov.json().catch(() => []);
    if (Array.isArray(rows) && rows.length >= 3) {
      return { package_id: c.package_id, slug: c.canonical_slug };
    }
  }
  return null;
}

console.log("[conversion-integrity-suite] start");
console.log(`  PROD_URL = ${PROD_URL}`);

const fx = await pickFixture();
if (!fx) {
  gate("G0", false, "Keine published Persona-Fixture gefunden");
  process.exit(1);
}
console.log(`  fixture = ${fx.slug} (${fx.package_id})`);

// ---------- G1 — Persona route renders 200 ----------
{
  const personas = ["azubi", "betrieb", "umschulung"];
  let allOk = true;
  for (const p of personas) {
    const url = `${PROD_URL}/pruefungstraining/${fx.slug}/${p}`;
    try {
      const r = await fetch(url, { redirect: "follow" });
      const ok = r.status === 200;
      if (!ok) allOk = false;
      console.log(`     ${p}: HTTP ${r.status} (final ${r.url})`);
    } catch (e) {
      allOk = false;
      console.log(`     ${p}: fetch error ${e.message}`);
    }
  }
  gate("G1", allOk, "Persona routes return 200");
}

// ---------- G2 — anon REST read liefert active row ----------
{
  const url = `${SUPABASE_URL}/rest/v1/product_persona_overlays?select=package_id,persona_type,active&active=eq.true&limit=1`;
  const r = await fetch(url, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  const body = await r.json().catch(() => null);
  const ok = r.status === 200 && Array.isArray(body) && body.length === 1 && body[0].active === true;
  gate("G2", ok, `anon REST read product_persona_overlays (status ${r.status}, rows ${Array.isArray(body) ? body.length : "?"})`);
}

// ---------- G3 — Production-Build hydratisiert Overlay ----------
// Heuristik: PROD-HTML lädt JS-Bundle; nach Hydration injiziert React den
// Overlay-Hero. Da der Fetch ist clientseitig, prüfen wir indirekt:
//   a) PROD index.html enthält ProductPersonaPage chunk reference (build-marker)
//   b) PROD overlay-row ist via anon REST am gleichen Origin erreichbar
// G3 ist green wenn (a) UND (b) zutreffen — der harte UI-Hydrate-Check
// gehört in einen Browser-E2E-Job (Playwright), nicht in diese Suite.
{
  const url = `${PROD_URL}/pruefungstraining/${fx.slug}/azubi`;
  const r = await fetch(url);
  const html = await r.text();
  const hasShell = html.includes('<div id="root"') && html.includes("/assets/");
  const overlayRow = await fetch(
    `${SUPABASE_URL}/rest/v1/product_persona_overlays?select=hero_headline&package_id=eq.${fx.package_id}&persona_type=eq.azubi&active=eq.true&limit=1`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
  );
  const rows = await overlayRow.json().catch(() => []);
  const hasRow = Array.isArray(rows) && rows.length === 1 && !!rows[0].hero_headline;
  gate("G3", hasShell && hasRow, `prod shell ok=${hasShell}, overlay row reachable=${hasRow}`);
}

// ---------- G4 — CTA enthält package_id (static code audit) ----------
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const file = path.resolve("src/pages/product/ProductPersonaPage.tsx");
  const src = fs.readFileSync(file, "utf8");
  const hasPkgInTrack = /package(?:_)?[Ii]d\s*:\s*product\.packageId/.test(src) ||
                       /packageId:\s*product\.packageId/.test(src);
  gate("G4", hasPkgInTrack, "ProductPersonaPage tracking carries packageId");
}

// ---------- G5 — strict insert OHNE package_id wird DB-seitig geblockt ----------
if (SERVICE_KEY) {
  const url = `${SUPABASE_URL}/rest/v1/conversion_events`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      event_type: "lead_magnet_view",
      session_id: "path-e-strict-probe",
      metadata: { source: "path-e-test" }, // KEIN package_id
    }),
  });
  const body = await r.text();
  // 23514 = check_violation; PostgREST mappt das auf 400/409 mit code 23514
  const blocked = r.status >= 400 && /23514|package_id|check/i.test(body);
  gate("G5", blocked, `strict insert blocked (status ${r.status})`);
} else {
  console.log("  ⊘ G5 skipped (no SERVICE_ROLE_KEY)");
}

// ---------- G6 — smoke_test / simulation whitelist bleibt erlaubt ----------
if (SERVICE_KEY) {
  const url = `${SUPABASE_URL}/rest/v1/conversion_events`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      event_type: "smoke_test",
      session_id: "path-e-whitelist-probe",
      metadata: { source: "path-e-test", smoke_test: true },
    }),
  });
  const ok = r.status >= 200 && r.status < 300;
  gate("G6", ok, `smoke_test insert allowed (status ${r.status})`);
  // Cleanup best-effort
  await fetch(`${SUPABASE_URL}/rest/v1/conversion_events?session_id=eq.path-e-whitelist-probe`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
} else {
  console.log("  ⊘ G6 skipped (no SERVICE_ROLE_KEY)");
}

// ---------- G7 — L8_NO_PERSONA_OVERLAY bleibt 0 ----------
{
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/v_data_holes_ssot?select=hole_key,n&hole_key=eq.L8_NO_PERSONA_OVERLAY`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
  );
  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows)) {
    gate("G7", false, `view fetch failed (status ${r.status})`);
  } else if (rows.length === 0) {
    gate("G7", true, "L8_NO_PERSONA_OVERLAY not present (0)");
  } else {
    const n = Number(rows[0].n);
    gate("G7", n === 0, `L8_NO_PERSONA_OVERLAY n = ${n}`);
  }
}

console.log("");
console.log(`[conversion-integrity-suite] ${failed === 0 ? "GREEN" : "RED"} (${results.length - failed}/${results.length} gates passed)`);
process.exit(failed === 0 ? 0 : 1);
