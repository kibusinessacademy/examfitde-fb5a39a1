#!/usr/bin/env node
/**
 * VerwaltungsOS DailyBrief v1 — Smoke
 *
 * Prüft die drei RPCs gegen anon (Forbidden) und gegen service-role (Shape).
 * Keine Writes — reine Read-Validation der Governance-Intelligence-Schicht.
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
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
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

// anon should be blocked — either PostgREST 401 (no execute grant) or RPC body 'forbidden'
function anonBlocked(status, json) {
  if (status === 401 || status === 403) return true;
  return json && typeof json === "object" && json.error === "forbidden";
}

{
  const { status, json } = await rpc("verwaltung_daily_brief_executive", { _window_days: 7 });
  check("executive RPC blocks anon", anonBlocked(status, json), `status=${status}`);
}
{
  const { status, json } = await rpc("verwaltung_daily_brief_governance_risks", { _window_days: 7 });
  check("governance-risks RPC blocks anon", anonBlocked(status, json), `status=${status}`);
}
{
  const { status, json } = await rpc("verwaltung_daily_brief_department", {
    _department_key: "buergeramt", _window_days: 7,
  });
  check("department RPC blocks anon", anonBlocked(status, json), `status=${status}`);
}

// 4. service-role (if available) → shape check
// service-role calls have no auth.uid() → 'forbidden' is the correct gate behaviour.
// We confirm only that the functions exist and respond with structured JSON.
if (SERVICE) {
  const { status, json } = await rpc("verwaltung_daily_brief_executive", { _window_days: 7 }, SERVICE);
  check("executive RPC reachable (service-role)", status === 200 && json && typeof json === "object",
    `status=${status} keys=${json && typeof json === "object" ? Object.keys(json).join(",") : "n/a"}`);
  const { status: ds, json: dj } = await rpc("verwaltung_daily_brief_department", {
    _department_key: "buergeramt", _window_days: 7,
  }, SERVICE);
  check("department RPC reachable (service-role)", ds === 200 && dj && typeof dj === "object",
    `status=${ds} body=${dj?.error ?? "ok"}`);
} else {
  console.log("(service-role smoke skipped)");
}

if (failed > 0) {
  console.error(`\nFAIL — ${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nGREEN — DailyBrief v1 smoke ok");
