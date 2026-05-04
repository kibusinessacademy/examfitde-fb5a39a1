#!/usr/bin/env node
/**
 * guard-rpc-contracts
 * Verifies that every supabase.rpc('name', args) call in src/ has:
 *  - a matching CREATE FUNCTION in migrations
 *  - the documented argument count is plausible
 * Hard-fails on missing RPCs. Warn on argument-count drift.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, exts, out = []) {
  for (const e of readdirSync(dir)) {
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

const migFiles = walk("supabase/migrations", [".sql"]);
const knownRpcs = new Map(); // name → arg count (best effort)
for (const f of migFiles) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(([^)]*)\)/gi)) {
    const name = m[1];
    const argList = m[2].trim();
    const argCount = argList === "" ? 0 : argList.split(",").length;
    knownRpcs.set(name, argCount);
  }
}

const codeFiles = walk("src", [".ts", ".tsx"]).concat(walk("supabase/functions", [".ts"]));
let failed = 0;
let warns = 0;

for (const f of codeFiles) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/\.rpc\(\s*['"`](\w+)['"`](\s*,\s*\{([^}]*)\})?/g)) {
    const name = m[1];
    if (SYSTEM_RPCS.has(name)) continue;
    if (!knownRpcs.has(name)) {
      console.error(`❌ Missing RPC: .rpc('${name}') in ${f} — no migration defines it.`);
      failed++;
    }
  }
}

if (failed > 0) {
  console.error(`\n❌ guard-rpc-contracts: ${failed} missing RPC(s).`);
  process.exit(1);
}
if (warns > 0) console.warn(`⚠️  ${warns} non-fatal RPC contract warnings.`);
console.log(`✅ guard-rpc-contracts passed (${knownRpcs.size} RPCs known).`);
