#!/usr/bin/env node

/**
 * CI Guard: No direct status='done' or postcondition_verified writes outside _shared/steps.ts
 *
 * All step-done transitions must go through markStepDone() which enforces SSOT postconditions.
 * Writing postcondition_verified: true anywhere except steps.ts is strictly forbidden.
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

// Files allowed to write status='done' or postcondition_verified
const ALLOWLIST = [
  "_shared/steps.ts",             // the SSOT markStepDone function
  "_shared/post-conditions",      // postcondition definitions
  "migrations",                    // migration files
  "no-direct-done-write-guard",   // this guard itself
  ".test.",                        // test files
  "_test.",                        // test files (deno)
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
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Pattern 1: postcondition_verified: true (direct injection)
    if (/postcondition_verified\s*:\s*true/.test(line)) {
      console.error(`❌ Direct postcondition_verified:true in ${file}:${lineNum}`);
      violations++;
    }

    // Pattern 2: status: "done" or status: 'done' in .update() context
    // Only flag if within ~5 lines of .update( or .from("package_steps")
    if (/status\s*:\s*['"]done['"]/.test(line)) {
      // Check surrounding context (5 lines before)
      const context = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
      if (/\.update\(|\.from\(\s*['"]package_steps['"]/.test(context)) {
        console.error(`❌ Direct status='done' write to package_steps in ${file}:${lineNum}`);
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n🚫 ${violations} direct done/postcondition_verified write(s) found outside _shared/steps.ts.`);
  console.error(`   All step-done transitions must use markStepDone() from _shared/steps.ts.`);
  process.exit(1);
}

console.log("✅ No direct status='done' or postcondition_verified writes outside _shared/steps.ts");
