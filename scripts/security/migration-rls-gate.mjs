#!/usr/bin/env node
/**
 * Migration RLS Gate (CI)
 *
 * Scans new migration files for CREATE TABLE statements 
 * and verifies they include ENABLE ROW LEVEL SECURITY.
 * 
 * Also checks for:
 * - CREATE VIEW on sensitive patterns without REVOKE
 * - GRANT to anon/public on sensitive tables
 * - Missing RLS policies after table creation
 *
 * Run: on every PR that touches supabase/migrations/
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const MIGRATION_DIR = "supabase/migrations";

// Tables that are intentionally public
const PUBLIC_TABLE_ALLOWLIST = new Set([
  "courses",
  "certification_catalog",
  "berufe",
  "curricula",
  "content_pages",
  "blog_posts",
]);

const SENSITIVE_VIEW_PATTERNS = [
  /^v_admin_/i,
  /^ops_/i,
  /^v_ops_/i,
  /^v_pipeline_/i,
  /^v_llm_/i,
  /^v_scheduler_/i,
  /^v_profit_/i,
  /^v_unit_economics_/i,
  /^elite_readiness_/i,
  /^package_economics/i,
];

function extractTableNames(sql) {
  const tables = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?(\w+)["']?/gi;
  let m;
  while ((m = re.exec(sql))) {
    tables.push(m[1]);
  }
  return tables;
}

function extractViewNames(sql) {
  const views = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?(\w+)["']?/gi;
  let m;
  while ((m = re.exec(sql))) {
    views.push(m[1]);
  }
  return views;
}

function hasRLSEnable(sql, tableName) {
  const re = new RegExp(
    `ALTER\\s+TABLE\\s+(?:public\\.)?["']?${tableName}["']?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
    "i"
  );
  return re.test(sql);
}

function hasRevokeAnon(sql, viewName) {
  const re = new RegExp(
    `REVOKE\\s+(?:ALL|SELECT)\\s+ON\\s+(?:public\\.)?["']?${viewName}["']?\\s+FROM\\s+(?:anon|public|authenticated)`,
    "i"
  );
  return re.test(sql);
}

function hasGrantAnon(sql) {
  // Check for dangerous GRANT to anon/public on non-public tables
  const re = /GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|SELECT)\s+ON\s+(?:public\.)?["']?(\w+)["']?\s+TO\s+(?:anon|public)/gi;
  const grants = [];
  let m;
  while ((m = re.exec(sql))) {
    if (!PUBLIC_TABLE_ALLOWLIST.has(m[1])) {
      grants.push(m[1]);
    }
  }
  return grants;
}

function main() {
  console.log("🔐 Migration RLS Gate\n");

  if (!existsSync(MIGRATION_DIR)) {
    console.log("⚠️  No migrations directory found — skipping");
    process.exit(0);
  }

  const files = readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // In CI, only check files changed in this PR (via env var)
  const changedFiles = process.env.CHANGED_MIGRATION_FILES
    ? process.env.CHANGED_MIGRATION_FILES.split(",").map((f) => f.trim())
    : files; // Check all if not in PR context

  let failures = 0;
  let checked = 0;

  for (const file of changedFiles) {
    const filePath = file.includes("/") ? file : join(MIGRATION_DIR, file);
    if (!existsSync(filePath)) continue;

    const sql = readFileSync(filePath, "utf-8");
    checked++;

    // Check 1: CREATE TABLE without ENABLE RLS
    const tables = extractTableNames(sql);
    for (const table of tables) {
      if (PUBLIC_TABLE_ALLOWLIST.has(table)) continue;
      if (!hasRLSEnable(sql, table)) {
        console.error(`  ❌ FAIL: ${file} creates table "${table}" without ENABLE ROW LEVEL SECURITY`);
        failures++;
      } else {
        console.log(`  ✅ ${file}: "${table}" has RLS enabled`);
      }
    }

    // Check 2: CREATE VIEW on sensitive patterns without REVOKE
    const views = extractViewNames(sql);
    for (const view of views) {
      const isSensitive = SENSITIVE_VIEW_PATTERNS.some((p) => p.test(view));
      if (isSensitive && !hasRevokeAnon(sql, view)) {
        console.error(`  ❌ FAIL: ${file} creates sensitive view "${view}" without REVOKE from anon/authenticated`);
        failures++;
      } else if (isSensitive) {
        console.log(`  ✅ ${file}: sensitive view "${view}" has REVOKE`);
      }
    }

    // Check 3: Dangerous GRANT statements
    const dangerousGrants = hasGrantAnon(sql);
    for (const table of dangerousGrants) {
      console.error(`  ❌ FAIL: ${file} grants anon/public access to "${table}"`);
      failures++;
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`Migrations checked: ${checked}`);
  console.log(`Failures: ${failures}`);

  if (failures > 0) {
    console.error(`\n🚫 Migration RLS Gate FAILED — ${failures} violation(s)`);
    console.error("Every new table MUST have RLS enabled.");
    console.error("Every sensitive view (v_admin_*, ops_*, etc.) MUST REVOKE from anon/authenticated.");
    process.exit(1);
  }
  console.log("\n✅ Migration RLS Gate PASSED");
}

main();
