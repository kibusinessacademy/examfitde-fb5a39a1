#!/usr/bin/env node
/**
 * Test-Fixture-Contract Guard (B)
 *
 * Blocks raw writes to commerce/entitlement tables from smoke/E2E edge
 * functions. All such writes must go through the factories in
 * `supabase/functions/_shared/test-fixtures/`.
 *
 * Scope:
 *   - Files under supabase/functions/**\/*smoke*
 *   - Files under supabase/functions/**\/*e2e*
 *
 * Forbidden patterns (outside _shared/test-fixtures/):
 *   - .from('<table>').insert(  | .upsert(
 *   - INSERT INTO public?.<table>
 *
 * Scoped tables:
 *   orders, order_items, profiles,
 *   learner_course_grants, entitlements,
 *   store_products, products
 *
 * Baseline waivers (legacy, will be migrated in Path C):
 *   supabase/functions/b2c-ssot-smoke/index.ts
 *   supabase/functions/test-orchestrator/tests/wave3-entitlement-fulfillment.test.ts
 *
 * Cutoff: 2026-05-17T08:00:00Z — new violations in files added/edited after
 * this timestamp fail the build.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "supabase", "functions");
const FIXTURE_DIR = join(FN_DIR, "_shared", "test-fixtures");

const SCOPED_TABLES = [
  "orders",
  "order_items",
  "profiles",
  "learner_course_grants",
  "entitlements",
  "store_products",
  "products",
];

// Baseline waivers (legacy). b2c-ssot-smoke was migrated to factories in Pfad C (2026-05-17).
const BASELINE_WAIVERS = new Set([
  "supabase/functions/test-orchestrator/tests/wave3-entitlement-fulfillment.test.ts",
]);

function listFiles(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out = out.concat(listFiles(full));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function isSmokeOrE2E(filePath) {
  const lower = filePath.toLowerCase();
  return (
    (lower.includes("smoke") || lower.includes("e2e")) &&
    !filePath.startsWith(FIXTURE_DIR) &&
    (lower.endsWith(".ts") || lower.endsWith(".mjs") || lower.endsWith(".js"))
  );
}

function buildPatterns() {
  const tableAlt = SCOPED_TABLES.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return [
    // Supabase-JS: .from('orders').insert( / .upsert(
    new RegExp(`\\.from\\(\\s*['"\`](?:${tableAlt})['"\`]\\s*\\)\\s*\\.(?:insert|upsert)\\s*\\(`, "g"),
    // Raw SQL: INSERT INTO orders / public.orders
    new RegExp(`INSERT\\s+INTO\\s+(?:public\\.)?(?:${tableAlt})\\b`, "gi"),
  ];
}

function scan() {
  const files = listFiles(FN_DIR).filter(isSmokeOrE2E);
  const patterns = buildPatterns();
  const violations = [];

  for (const file of files) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (BASELINE_WAIVERS.has(rel)) continue;

    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const pat of patterns) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(src)) !== null) {
        const line = src.slice(0, m.index).split("\n").length;
        violations.push({ file: rel, line, match: m[0] });
      }
    }
  }

  return violations;
}

const violations = scan();

if (violations.length === 0) {
  console.log("✓ test-fixture-contract-guard: no raw fixture writes in smoke/e2e edge functions");
  process.exit(0);
}

console.error("✗ test-fixture-contract-guard: raw fixture writes detected");
console.error("");
console.error("  Smoke/E2E edge functions must write through");
console.error("  supabase/functions/_shared/test-fixtures/ — never raw inserts.");
console.error("");
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.match}`);
}
console.error("");
console.error(`  Total: ${violations.length} violation(s)`);
console.error("  Either route through the factory module, or — for one-shot");
console.error("  legacy migration — add the file path to BASELINE_WAIVERS in");
console.error("  scripts/guards/test-fixture-contract-guard.mjs with a tracking ticket.");
process.exit(1);
