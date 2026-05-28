#!/usr/bin/env node
/**
 * VerwaltungsOS Executive Cockpit — Payload-Shape-Smoke
 *
 * Schließt den Audit-Blind-Spot L1 (Smoke testet nur Gate, nicht Shape).
 * Ruft `_smoke_verwaltung_cockpit_shape` (service-role only) und validiert
 * die kanonischen Payload-Keys gegen Schema-Drift.
 */
import { config } from "dotenv";
config();

const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE) {
  console.error("[smoke] missing SUPABASE_URL / SERVICE_ROLE_KEY");
  process.exit(2);
}

const REQUIRED_TOP = ["window_days", "generated_at", "executive", "risks", "reality"];
const REQUIRED_EXEC = ["window_days", "sessions_total", "departments_total"];

const r = await fetch(`${URL}/rest/v1/rpc/_smoke_verwaltung_cockpit_shape`, {
  method: "POST",
  headers: {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ _window_days: 7 }),
});
const text = await r.text();
let json;
try { json = JSON.parse(text); } catch { json = text; }

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
}

check("RPC reachable", r.status === 200, `status=${r.status}`);
check("payload is object", json && typeof json === "object", typeof json);

if (json && typeof json === "object") {
  const missing = REQUIRED_TOP.filter((k) => !(k in json));
  check("top-level keys present", missing.length === 0,
    missing.length ? `missing: ${missing.join(",")}` : `keys: ${Object.keys(json).join(",")}`);

  const exec = json.executive ?? {};
  const missingExec = REQUIRED_EXEC.filter((k) => !(k in exec));
  check("executive keys present", missingExec.length === 0,
    missingExec.length ? `missing: ${missingExec.join(",")}` : `keys: ${Object.keys(exec).join(",")}`);

  check("risks is array", Array.isArray(json.risks), `type=${Array.isArray(json.risks) ? "array" : typeof json.risks}`);
  check("reality.departments is array",
    json.reality && Array.isArray(json.reality.departments),
    `type=${typeof json.reality?.departments}`);
}

if (failed > 0) { console.error(`\nFAIL — ${failed} check(s) failed`); process.exit(1); }
console.log("\nGREEN — Cockpit payload-shape smoke ok");
