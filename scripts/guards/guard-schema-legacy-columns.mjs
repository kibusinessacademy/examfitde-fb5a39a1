#!/usr/bin/env node
/**
 * guard-schema-legacy-columns
 * Hard-fails if any forbidden legacy column reference appears in code.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["supabase/functions", "src", "scripts"];
const BLOCKED = [
  { table: "product_prices", legacyColumn: "billing_interval", replacement: "billing_type" },
];
const ALLOWLIST = [
  "scripts/guards/guard-schema-legacy-columns.mjs",
  "scripts/guards/guard-registry.mjs",
  "scripts/guards/schema-contract-product-prices.mjs",
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (path.includes("node_modules") || path.includes(".git") || path.includes("dist") || path.includes("build")) continue;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|js|mjs|sql|md)$/.test(path)) out.push(path);
  }
  return out;
}

let failed = false;
for (const root of ROOTS) {
  let files = [];
  try { files = walk(root); } catch { continue; }
  for (const file of files) {
    if (ALLOWLIST.some((a) => file.endsWith(a))) continue;
    const text = readFileSync(file, "utf8");
    for (const rule of BLOCKED) {
      if (text.includes(rule.legacyColumn)) {
        console.error(`❌ Legacy schema column detected: ${rule.legacyColumn} in ${file}. Use ${rule.replacement}.`);
        failed = true;
      }
    }
  }
}
if (failed) process.exit(1);
console.log("✅ guard-schema-legacy-columns passed");
