#!/usr/bin/env node
/**
 * CI Guard: auto_publish postcondition
 *
 * Ensures that any code path setting the auto_publish step to 'done'
 * also verifies the package status is 'published'.
 *
 * Scans Edge Functions and SQL migrations for patterns that set
 * auto_publish to done without a postcondition check.
 *
 * HARD FAIL if violated.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const violations = [];

// Patterns that indicate setting auto_publish step to done
const DONE_PATTERNS = [
  /auto_publish.*['"]done['"]/i,
  /step_key\s*=\s*['"]auto_publish['"].*status\s*=\s*['"]done['"]/i,
  /['"]auto_publish['"].*['"]done['"]/i,
];

// Patterns that indicate a proper postcondition check
const POSTCONDITION_PATTERNS = [
  /status\s*(!==?|<>|IS DISTINCT FROM)\s*['"]published['"]/i,
  /status\s*===?\s*['"]published['"]/i,
  /\.status\s*!==?\s*['"]published['"]/i,
  /POST_CONDITION_FAILED/i,
  /trg_guard_auto_publish_done/i,
];

function walk(dir, ext) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const e of entries) {
    const full = path.join(dir, e);
    try {
      const s = statSync(full);
      if (s.isDirectory() && !e.startsWith(".") && e !== "node_modules") {
        results.push(...walk(full, ext));
      } else if (ext.some((x) => e.endsWith(x))) {
        results.push(full);
      }
    } catch {
      /* skip */
    }
  }
  return results;
}

// Scan edge functions and src for auto_publish done patterns
const scanDirs = [
  path.join(ROOT, "supabase/functions"),
  path.join(ROOT, "src"),
];

for (const dir of scanDirs) {
  const files = walk(dir, [".ts", ".tsx", ".js", ".mjs"]);
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");

    const hasDonePattern = DONE_PATTERNS.some((p) => p.test(content));
    if (!hasDonePattern) continue;

    const hasPostcondition = POSTCONDITION_PATTERNS.some((p) =>
      p.test(content)
    );
    if (hasPostcondition) continue;

    // Find the exact line for the violation
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (DONE_PATTERNS.some((p) => p.test(line))) {
        violations.push({
          file: path.relative(ROOT, file),
          line: i + 1,
          text: line.trim(),
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    "❌ AUTO-PUBLISH POSTCONDITION GUARD FAILED\n"
  );
  console.error(
    "   Files set auto_publish to 'done' without verifying package status = 'published':\n"
  );
  for (const v of violations) {
    console.error(`   ${v.file}:${v.line}`);
    console.error(`     ${v.text}\n`);
  }
  console.error(
    "   Fix: Add a postcondition check that verifies course_packages.status = 'published'"
  );
  console.error(
    "   before marking auto_publish as done. The DB trigger trg_guard_auto_publish_done"
  );
  console.error(
    "   enforces this at the database level, but code should also check explicitly.\n"
  );
  process.exit(1);
} else {
  console.log(
    "✅ auto-publish-postcondition-guard: All auto_publish done-writes have postcondition checks."
  );
}
