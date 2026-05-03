#!/usr/bin/env node
/**
 * Generic Enum Contract Guard
 * ───────────────────────────
 * Verifies that critical DB enums match their frontend whitelists.
 *
 * Source of truth:
 *   - DB: pg_enum via RPC `get_enum_values(enum_name)`
 *   - FE: whitelist constants extracted from source files
 *
 * Configure new contracts in CONTRACTS below. Each entry declares:
 *   - dbEnum: pg_enum type name in `public` schema
 *   - feFile: source file containing the canonical const
 *   - feConst: name of the `as const` array
 *   - mode: "strict" (1:1) | "fe_subset" (FE ⊆ DB; DB may have legacy)
 *   - forbidden: legacy values that must NOT appear in either side
 *
 * Drift = exit 1 → CI gate.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ubdvvvsiryenhrfmqsvw.supabase.co";
const ANON =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViZHZ2dnNpcnllbmhyZm1xc3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NDA4MjgsImV4cCI6MjA4MzAxNjgyOH0.LGMpcVQMXziF3Zal4SoprwQj6KfNyqjVJXDXEh3pAEc";

const CONTRACTS = [
  {
    name: "product_persona",
    dbEnum: "product_persona",
    feFile: "src/lib/landing/productPersonaContext.ts",
    feConst: "PRODUCT_PERSONAS",
    mode: "strict",
    forbidden: ["umschulung"],
  },
  {
    name: "product_track",
    dbEnum: "product_track",
    feFile: "src/lib/tracks.ts",
    feConst: "TRACKS",
    // FE intentionally collapses FORTBILDUNG/ZERTIFIKAT → EXAM_FIRST_PLUS via aliases.
    // Therefore FE ⊆ DB; DB may carry legacy/alias-target values.
    mode: "fe_subset",
    forbidden: [],
  },
  {
    name: "app_role",
    dbEnum: "app_role",
    // No FE const required; just ensure DB stays {admin, teacher, learner}.
    expectedDb: ["admin", "learner", "teacher"],
    mode: "db_only",
    forbidden: [],
  },
];

let failed = false;
const ok = (m) => console.log("  ✓", m);
const warn = (m) => console.log("  ⚠", m);
const fail = (m) => { console.log("  ✗", m); failed = true; };

async function fetchEnum(name) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_enum_values`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({ enum_name: name }),
  });
  if (!r.ok) throw new Error(`get_enum_values(${name}) ${r.status}: ${await r.text()}`);
  return ((await r.json()) ?? []).slice().sort();
}

function extractFeConst(file, constName) {
  const src = readFileSync(resolve(process.cwd(), file), "utf8");
  const re = new RegExp(`${constName}\\s*=\\s*\\[([^\\]]+)\\]`);
  const m = src.match(re);
  if (!m) throw new Error(`${constName} not found in ${file}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
}

console.log("[enum-contract-guard] start");

for (const c of CONTRACTS) {
  console.log(`\n▸ ${c.name} (mode=${c.mode})`);
  let dbEnum;
  try { dbEnum = await fetchEnum(c.dbEnum); }
  catch (e) { fail(`DB fetch failed: ${e.message}`); continue; }
  ok(`DB: [${dbEnum.join(", ")}]`);

  for (const f of c.forbidden) {
    if (dbEnum.includes(f)) fail(`Forbidden legacy '${f}' in DB enum ${c.dbEnum}`);
  }

  if (c.mode === "db_only") {
    const exp = c.expectedDb.slice().sort();
    if (JSON.stringify(dbEnum) === JSON.stringify(exp)) ok("DB matches expected set");
    else fail(`DB drift: expected [${exp.join(", ")}], got [${dbEnum.join(", ")}]`);
    continue;
  }

  let fe;
  try { fe = extractFeConst(c.feFile, c.feConst); }
  catch (e) { fail(e.message); continue; }
  ok(`FE: [${fe.join(", ")}]`);

  for (const f of c.forbidden) {
    if (fe.includes(f)) fail(`Forbidden legacy '${f}' in FE ${c.feConst}`);
  }

  const missingInDb = fe.filter((v) => !dbEnum.includes(v));
  const extraInDb = dbEnum.filter((v) => !fe.includes(v));

  if (missingInDb.length === 0) ok("FE ⊆ DB");
  else fail(`FE values missing in DB: ${missingInDb.join(", ")}`);

  if (c.mode === "strict") {
    if (extraInDb.length === 0) ok("DB ⊆ FE (strict)");
    else fail(`DB has unknown values vs FE: ${extraInDb.join(", ")}`);
  } else if (c.mode === "fe_subset") {
    if (extraInDb.length === 0) ok("No DB-only values");
    else warn(`DB-only values (allowed under fe_subset): ${extraInDb.join(", ")}`);
  }
}

console.log(failed ? "\n[enum-contract-guard] FAIL" : "\n[enum-contract-guard] OK");
process.exit(failed ? 1 : 0);
