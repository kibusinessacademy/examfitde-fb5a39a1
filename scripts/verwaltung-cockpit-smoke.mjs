#!/usr/bin/env node
/**
 * VerwaltungsOS Executive Cockpit v1 — Smoke
 *
 * Prüft das konsolidierte RPC `verwaltung_executive_cockpit`:
 *  - anon blockiert (Forbidden/401)
 *  - service-role erreichbar; Body trägt 'error: forbidden' (kein auth.uid — Gate-by-Design)
 *  - Shape: { window_days, generated_at, executive, risks, reality } sobald authentifizierter Admin-Caller
 *
 * Keine Writes — reine Read-Validation.
 */
import { config } from "dotenv";
config();

const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON) {
  console.error("[smoke] missing SUPABASE_URL / ANON");
  process.exit(1);
}

async function rpc(name, body, key = ANON) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  try { return { status: r.status, json: JSON.parse(txt) }; }
  catch { return { status: r.status, json: txt }; }
}

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
}
function anonBlocked(status, json) {
  if (status === 401 || status === 403) return true;
  return json && typeof json === "object" && json.error === "forbidden";
}

{
  const { status, json } = await rpc("verwaltung_executive_cockpit", { _window_days: 7 });
  check("cockpit RPC blocks anon", anonBlocked(status, json), `status=${status}`);
}

if (SERVICE) {
  const { status, json } = await rpc("verwaltung_executive_cockpit", { _window_days: 7 }, SERVICE);
  check("cockpit RPC reachable (service-role)",
    status === 200 && json && typeof json === "object",
    `status=${status} body=${json?.error ?? Object.keys(json).join(",")}`);
} else {
  console.log("(service-role smoke skipped)");
}

if (failed > 0) { console.error(`\nFAIL — ${failed} check(s) failed`); process.exit(1); }
console.log("\nGREEN — Executive Cockpit v1 smoke ok");
