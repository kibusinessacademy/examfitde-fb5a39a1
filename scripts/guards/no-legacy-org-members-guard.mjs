#!/usr/bin/env node
/**
 * Guard: Block productive references to deprecated "organization_members" table.
 * SSOT for org membership is "org_memberships". No new code should read/write
 * the legacy table except migration files or explicitly documented exceptions.
 */
import fs from "node:fs";
import path from "node:path";
import { globSync } from "glob";

const FRONT_GLOBS = [
  "src/**/*.{ts,tsx,js,jsx}",
  "supabase/functions/**/*.{ts,tsx,js}",
];

const ALLOWLIST_PATTERNS = [
  "/integrations/supabase/types.ts",  // auto-generated
  "supabase/migrations/",              // historical migrations
  ".test.",
  ".spec.",
];

const FORBIDDEN_NEEDLE = "organization_members";

function isAllowlisted(file) {
  const p = file.replaceAll("\\", "/");
  return ALLOWLIST_PATTERNS.some(a => p.includes(a));
}

let violations = [];

for (const g of FRONT_GLOBS) {
  for (const file of globSync(g, { nodir: true })) {
    if (isAllowlisted(file)) continue;
    const txt = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    if (txt.includes(FORBIDDEN_NEEDLE)) {
      violations.push(file);
    }
  }
}

if (violations.length) {
  console.error("\n❌ Legacy Org Members Guard: references to deprecated 'organization_members' found.\n");
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  console.error("\nFix: use 'org_memberships' instead. The legacy table is deprecated.\n");
  process.exit(1);
}

console.log("✅ Legacy Org Members Guard passed — no productive references to organization_members.");
