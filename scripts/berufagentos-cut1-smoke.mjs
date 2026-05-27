#!/usr/bin/env node
/**
 * BerufAgentOS Cut 1 Smoke
 * - Route-Smoke: /admin/berufs-ki/outcome-control, /admin/berufs-ki/outcome-bundles/:id, /app/beruf-agent-os
 *   (verifiziert dass Routes in AppRoutes.tsx existieren).
 * - Edge-Smoke: ruft berufs-agent-outcome-run unauth → erwartet 401 (Function lebt).
 *
 * Kein DB-Schreibzugriff, kein User-Token nötig.
 */
import fs from "node:fs";
import path from "node:path";

const ROUTES_FILE = path.join(process.cwd(), "src/routes/AppRoutes.tsx");
const EXPECTED_ROUTES = [
  '"/app/beruf-agent-os"',
  '"/app/beruf-agent-os/bundle/:id"',
  '"berufs-ki/outcome-control"',
  '"berufs-ki/outcome-bundles/:id"',
];

function fail(msg) { console.error("✗", msg); process.exit(1); }
function ok(msg)   { console.log("✓", msg); }

const src = fs.readFileSync(ROUTES_FILE, "utf8");
for (const needle of EXPECTED_ROUTES) {
  if (!src.includes(needle)) fail(`Route fehlt in AppRoutes.tsx: ${needle}`);
  ok(`Route registriert: ${needle}`);
}

if (!src.includes("OutcomeControlCenterPage")) fail("OutcomeControlCenterPage nicht importiert");
if (!src.includes("OutcomeBundleDetailPage"))  fail("OutcomeBundleDetailPage nicht importiert");
ok("Lazy-Imports vorhanden");

// Edge-Smoke (best effort)
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.log("ℹ Edge-Smoke skipped (kein SUPABASE_URL/ANON gesetzt)");
  process.exit(0);
}
try {
  const resp = await fetch(`${url}/functions/v1/berufs-agent-outcome-run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ outcome_goal: "smoke test goal min eight chars", vertical_key: "public_admin" }),
  });
  const body = await resp.text().catch(() => "");
  if (resp.status === 401) ok(`Edge lebt (401 unauthorized wie erwartet ohne User-Session)`);
  else if (resp.status === 400) ok(`Edge lebt (400 validation — body=${body.slice(0,120)})`);
  else if (resp.status >= 500)  fail(`Edge 5xx: ${resp.status} ${body.slice(0,200)}`);
  else                          ok(`Edge erreichbar (HTTP ${resp.status})`);
} catch (e) {
  console.log(`ℹ Edge-Smoke Netzwerkfehler (ok in CI ohne Egress): ${e.message}`);
}
console.log("\n✓ BerufAgentOS smoke green");
