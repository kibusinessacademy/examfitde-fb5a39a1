#!/usr/bin/env node
/**
 * guard-rpc-contracts (v2 — DB introspection)
 *
 * For every .rpc('name') call in src/ + supabase/functions:
 *  1. Verify the function exists in DB via admin_list_rpc_contracts().
 *  2. Verify SECURITY DEFINER status matches "admin_*" / "_internal_*" naming
 *     (must be SECURITY DEFINER).
 *  3. Verify execute rights: admin_*/claim_*/ops_*/_internal_*
 *     must NOT be granted to anon/authenticated.
 *
 * Falls back to migration-grep for offline runs (no env). Then warn-only.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, exts, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (p.includes("node_modules") || p.includes(".git") || p.includes("dist")) continue;
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

const SYSTEM_RPCS = new Set([
  "check_schema_drift","sync_schema_contracts","get_current_rpc_version","resolve_current_rpc",
]);

const codeFiles = walk("src", [".ts", ".tsx"]).concat(walk("supabase/functions", [".ts"]));
const usedRpcs = new Set();
for (const f of codeFiles) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/\.rpc\(\s*['"`](\w+)['"`]/g)) {
    if (!SYSTEM_RPCS.has(m[1])) usedRpcs.add(m[1]);
  }
}

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  // Fallback: migration grep
  const migs = walk("supabase/migrations", [".sql"]);
  const known = new Set();
  for (const f of migs) {
    const t = readFileSync(f, "utf8");
    for (const m of t.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi)) known.add(m[1]);
  }
  let missing = 0;
  for (const r of usedRpcs) if (!known.has(r)) { console.error(`❌ Missing RPC (offline grep): ${r}`); missing++; }
  if (missing > 0) process.exit(1);
  console.log(`✅ guard-rpc-contracts (offline) passed (${usedRpcs.size} RPCs verified vs migrations).`);
  process.exit(0);
}

const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await sb.rpc("admin_list_rpc_contracts", { p_name_pattern: "%" });
if (error) { console.error("❌ RPC error:", error.message); process.exit(1); }

const dbRpcs = new Map();
for (const r of data) {
  if (!dbRpcs.has(r.proname)) dbRpcs.set(r.proname, []);
  dbRpcs.get(r.proname).push(r);
}

let errs = 0, warns = 0;
for (const r of usedRpcs) {
  if (!dbRpcs.has(r)) { console.error(`❌ Missing RPC: ${r} — referenced in code, not in DB.`); errs++; continue; }
  const overloads = dbRpcs.get(r);
  const internalish = /^(admin_|claim_|ops_|_internal_)/.test(r);
  if (internalish) {
    const leak = overloads.find((o) => o.granted_to_anon || o.granted_to_authenticated);
    if (leak) { console.error(`❌ RPC ${r} is internal but granted to anon/authenticated.`); errs++; }
    const noSecdef = overloads.find((o) => !o.security_definer);
    if (noSecdef) { console.warn(`⚠️  RPC ${r} not SECURITY DEFINER (may be intentional).`); warns++; }
  }
}
if (errs > 0) {
  console.error(`\n❌ guard-rpc-contracts: ${errs} hard error(s), ${warns} warning(s).`);
  process.exit(1);
}
console.log(`✅ guard-rpc-contracts passed (${usedRpcs.size} RPCs verified, ${warns} warning(s)).`);
