#!/usr/bin/env node

/**
 * CI Guard: No direct status='done' or postcondition_verified writes
 * to package_steps outside _shared/steps.ts
 *
 * All step-done transitions must go through markStepDone() which enforces SSOT postconditions.
 * Writing postcondition_verified: true anywhere except steps.ts is strictly forbidden.
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

// Files allowed to write status='done' to package_steps or postcondition_verified
const ALLOWLIST = [
  "_shared/steps.ts",             // the SSOT markStepDone function
  "migrations",                    // migration files
  "no-direct-done-write-guard",   // this guard itself
  ".test.",                        // test files
  "_test.",                        // test files (deno)
];

// Temporary: known legacy bypass files to be migrated to markStepDone
// Each must have a tracking ticket. Remove from here as they get fixed.
const LEGACY_BYPASS = [
  "pipeline-handlers.ts",                      // P2: uses direct update for skip-steps
  "stuck-scan-hygiene.ts",                      // P2: hollow-done healer resets
  "admin-ops-actions/index.ts",                 // P3: admin force-done action
  "fanout-learning-content/index.ts",           // P2: fanout self-finalization
  "job-runner/index.ts",                        // P2: skip-step logic
  "package-run-integrity-check/index.ts",       // P1: integrity self-finalization
  "package-validate-learning-content/index.ts", // P1: validate self-finalization
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
      walk(p, files);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      files.push(p);
    }
  }
  return files;
}

let violations = 0;

const edgeFiles = walk(path.join(ROOT, "supabase", "functions"));
for (const file of edgeFiles) {
  if (ALLOWLIST.some(a => file.includes(a))) continue;
  const content = fs.readFileSync(file, "utf8");

  // Pattern 1: postcondition_verified: true (HARD FAIL — never allowed outside steps.ts)
  const pcMatches = [...content.matchAll(/postcondition_verified\s*:\s*true/g)];
  for (const m of pcMatches) {
    const line = content.substring(0, m.index).split("\n").length;
    console.error(`❌ Direct postcondition_verified:true in ${file}:${line}`);
    violations++;
  }

  // Pattern 2: .from("package_steps").update(...status: "done"...)
  // Detect .from("package_steps") followed by .update( within 200 chars,
  // then status: "done" within the next 300 chars
  const fromPattern = /\.from\(\s*['"]package_steps['"]\s*\)[\s\S]{0,200}\.update\(/g;
  const fromMatches = [...content.matchAll(fromPattern)];
  for (const m of fromMatches) {
    const afterUpdate = content.substring(m.index, m.index + m[0].length + 400);
    if (/status\s*:\s*['"]done['"]/.test(afterUpdate)) {
      const line = content.substring(0, m.index).split("\n").length;
      console.error(`❌ Direct .from("package_steps").update({status:"done"}) in ${file}:${line}`);
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\n🚫 ${violations} direct done/postcondition_verified write(s) found outside _shared/steps.ts.`);
  console.error(`   All step-done transitions must use markStepDone() from _shared/steps.ts.`);
  process.exit(1);
}

console.log("✅ No direct package_steps status='done' or postcondition_verified writes outside _shared/steps.ts");
