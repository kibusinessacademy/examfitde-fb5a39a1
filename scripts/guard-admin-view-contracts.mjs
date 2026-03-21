#!/usr/bin/env node

/**
 * Admin View Contract Guard
 *
 * Checks that v_admin_* views in the generated types.ts file
 * contain all required columns defined in the contract.
 *
 * This prevents schema drift between DB views and frontend expectations.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TYPES_FILE = path.join(ROOT, "src/integrations/supabase/types.ts");

const VIEW_CONTRACTS = {
  v_admin_queue_ssot: [
    "job_id", "job_type", "job_status", "package_id", "package_title",
    "package_status", "priority", "attempts", "max_attempts",
    "created_at", "started_at", "completed_at", "last_error",
    "health_signal", "age_minutes", "meta", "updated_at",
    "locked_at", "locked_by", "run_after",
  ],
  v_admin_packages_ssot: [
    "package_id", "raw_title", "canonical_title", "status",
    "build_progress", "current_step", "priority",
    "council_approved", "integrity_passed",
    "created_at", "updated_at", "is_published", "track",
  ],
};

const violations = [];

function main() {
  if (!fs.existsSync(TYPES_FILE)) {
    console.error("❌ types.ts not found at:", TYPES_FILE);
    process.exit(1);
  }

  const content = fs.readFileSync(TYPES_FILE, "utf8");

  for (const [viewName, requiredColumns] of Object.entries(VIEW_CONTRACTS)) {
    const viewColumns = extractViewColumns(content, viewName);

    if (viewColumns === null) {
      violations.push(`View "${viewName}" not found in types.ts`);
      continue;
    }

    for (const col of requiredColumns) {
      if (!viewColumns.has(col)) {
        violations.push(
          `View "${viewName}" is missing required column "${col}"`
        );
      }
    }
  }

  if (violations.length > 0) {
    console.error("\n❌ Admin view contract guard failed:\n");
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    console.error(
      "\nEnsure all required columns exist in the view definitions."
    );
    console.error("See docs/admin-view-contracts.md for the full contract.\n");
    process.exit(1);
  }

  console.log("✅ Admin view contract guard passed.");
  for (const [viewName, cols] of Object.entries(VIEW_CONTRACTS)) {
    console.log(`   ${viewName}: ${cols.length} required columns verified`);
  }
}

function extractViewColumns(typesContent, viewName) {
  // Find the view definition block in types.ts
  // Pattern: viewName: { Row: { col1: type; col2: type; ... } }
  const viewRegex = new RegExp(
    `${viewName}:\\s*\\{\\s*Row:\\s*\\{([^}]+)\\}`,
    "s"
  );
  const match = typesContent.match(viewRegex);
  if (!match) return null;

  const rowBlock = match[1];
  const columnNames = new Set();

  // Extract column names from "columnName: type" patterns
  const colRegex = /(\w+)\s*:/g;
  let colMatch;
  while ((colMatch = colRegex.exec(rowBlock)) !== null) {
    columnNames.add(colMatch[1]);
  }

  return columnNames;
}

main();
