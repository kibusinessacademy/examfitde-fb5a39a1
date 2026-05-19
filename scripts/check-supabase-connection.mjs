#!/usr/bin/env node
/**
 * Supabase Connection Smoke Check
 * Liest .env, prüft Pflicht-Vars und testet REST + Auth Endpoints.
 * Exit 0 = OK, Exit 1 = Fehler.
 *
 * Usage: node scripts/check-supabase-connection.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", D = "\x1b[2m", B = "\x1b[1m", X = "\x1b[0m";

// .env laden (überschreibt process.env nicht)
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const PROJECT_ID = process.env.VITE_SUPABASE_PROJECT_ID;

console.log(`\n${B}Supabase Connection Check${X}\n`);

let fail = 0;
function ok(msg) { console.log(`  ${G}✓${X} ${msg}`); }
function bad(msg) { console.log(`  ${R}✗${X} ${msg}`); fail++; }
function info(msg) { console.log(`  ${D}${msg}${X}`); }

// 1. Env vars
console.log(`${B}1. Environment-Variablen${X}`);
URL ? ok(`VITE_SUPABASE_URL  ${D}${URL}${X}`) : bad("VITE_SUPABASE_URL fehlt");
KEY ? ok(`VITE_SUPABASE_PUBLISHABLE_KEY  ${D}${KEY.slice(0, 24)}…${X}`) : bad("VITE_SUPABASE_PUBLISHABLE_KEY fehlt");
PROJECT_ID ? ok(`VITE_SUPABASE_PROJECT_ID  ${D}${PROJECT_ID}${X}`) : bad("VITE_SUPABASE_PROJECT_ID fehlt");

// 2. URL ↔ Project-ID Konsistenz
if (URL && PROJECT_ID) {
  const refInUrl = URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
  if (refInUrl === PROJECT_ID) ok(`URL-Ref stimmt mit PROJECT_ID überein (${PROJECT_ID})`);
  else bad(`URL-Ref (${refInUrl}) ≠ PROJECT_ID (${PROJECT_ID})`);
}

if (fail > 0) {
  console.log(`\n${R}${B}Abbruch: Env-Vars unvollständig.${X}\n`);
  process.exit(1);
}

// 3. REST Endpoint
console.log(`\n${B}2. REST API${X}`);
try {
  const r = await fetch(`${URL}/rest/v1/`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (r.ok || r.status === 404) ok(`REST erreichbar (HTTP ${r.status})`);
  else if (r.status === 401) bad(`REST 401 — Publishable Key ungültig`);
  else bad(`REST unerwarteter Status ${r.status}`);
} catch (e) {
  bad(`REST nicht erreichbar: ${e.message}`);
}

// 4. Auth Endpoint
console.log(`\n${B}3. Auth API${X}`);
try {
  const r = await fetch(`${URL}/auth/v1/settings`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (r.ok) {
    const j = await r.json().catch(() => ({}));
    ok(`Auth erreichbar (HTTP ${r.status})`);
    if (j.external) {
      const providers = Object.entries(j.external).filter(([, v]) => v).map(([k]) => k);
      if (providers.length) info(`Aktive Provider: ${providers.join(", ")}`);
    }
  } else {
    bad(`Auth Status ${r.status}`);
  }
} catch (e) {
  bad(`Auth nicht erreichbar: ${e.message}`);
}

// 5. Lightweight RPC (existiert immer in diesem Projekt)
console.log(`\n${B}4. RPC-Probe (has_role)${X}`);
try {
  const r = await fetch(`${URL}/rest/v1/rpc/has_role`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ _user_id: "00000000-0000-0000-0000-000000000000", _role: "admin" }),
  });
  if (r.status === 404) bad("has_role RPC nicht gefunden — falsches Projekt?");
  else ok(`RPC dispatch ok (HTTP ${r.status})`);
} catch (e) {
  bad(`RPC nicht erreichbar: ${e.message}`);
}

console.log();
if (fail > 0) {
  console.log(`${R}${B}❌ Verbindung NICHT ok — ${fail} Fehler.${X}\n`);
  process.exit(1);
}
console.log(`${G}${B}✅ Supabase-Verbindung funktioniert.${X}\n`);
