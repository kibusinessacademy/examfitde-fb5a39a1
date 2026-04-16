#!/usr/bin/env node

/**
 * CI Guard: Every package-* edge function must import a finalization helper.
 *
 * Ensures no package-* function can be deployed without either:
 *   - finalizeStepDone / finalizeStepFailed (from step-finalize.ts)
 *   - markStepDone / markStepFailed (from steps.ts)
 *
 * Functions in EXEMPT list are allowed to skip (e.g. utility functions).
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const FUNCTIONS_DIR = path.join(ROOT, "supabase", "functions");

// Functions that are NOT pipeline steps and don't need finalization
const EXEMPT = [
  "package-run-integrity-check",  // uses its own integrity finalization
];

const REQUIRED_PATTERNS = [
  /finalizeStepDone/,
  /finalizeStepFailed/,
  /markStepDone/,
  /markStepFailed/,
];

let violations = 0;

const entries = fs.readdirSync(FUNCTIONS_DIR, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  if (!entry.name.startsWith("package-")) continue;
  if (EXEMPT.includes(entry.name)) continue;

  const indexPath = path.join(FUNCTIONS_DIR, entry.name, "index.ts");
  if (!fs.existsSync(indexPath)) continue;

  const content = fs.readFileSync(indexPath, "utf8");

  const hasAny = REQUIRED_PATTERNS.some(p => p.test(content));
  if (!hasAny) {
    console.error(`❌ ${entry.name}/index.ts: No finalization helper (finalizeStepDone/Failed or markStepDone/Failed) found`);
    violations++;
  }
}

if (violations > 0) {
  console.error(`\n🚫 ${violations} package-* function(s) missing finalization helpers.`);
  console.error(`   Every package-* function must import finalizeStepDone/finalizeStepFailed from _shared/step-finalize.ts.`);
  process.exit(1);
}

console.log("✅ All package-* functions have finalization helpers");
