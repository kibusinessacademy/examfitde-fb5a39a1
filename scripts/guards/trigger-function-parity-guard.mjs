#!/usr/bin/env node

/**
 * CI Guard: Trigger-vs-Function Limit Parity
 * 
 * Ensures that no edge function has a hardcoded limit that conflicts with
 * a DB trigger guard requiring a higher minimum. This pattern caused:
 * - quality_council: markStepDone on fail → trigger blocked
 * - generate_oral_exam: MAX_BLUEPRINTS=30 vs. 100% competency coverage trigger
 * 
 * Detection: Scans package-* functions for numeric hardcaps and checks that
 * they use dynamic allocation patterns instead.
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const FUNCTIONS_DIR = path.join(ROOT, "supabase", "functions");

// Known anti-patterns: hardcoded limits that MUST be dynamic
const FORBIDDEN_PATTERNS = [
  {
    pattern: /\bMAX_BLUEPRINTS\s*=\s*\d+/,
    message: "Hardcoded MAX_BLUEPRINTS — must use dynamic allocation based on competency count",
    allowIf: /Math\.max\(\s*\d+\s*,\s*\w*[Cc]ompetenc/,  // OK if dynamic
  },
  {
    pattern: /\bMAX_QUESTIONS\s*=\s*\d+(?!.*[Cc]ompetenc)/,
    message: "Hardcoded MAX_QUESTIONS — verify it doesn't conflict with DB trigger minimums",
    allowIf: /Math\.max\(/,
  },
  {
    pattern: /\.slice\(\s*0\s*,\s*\d{1,2}\s*\)\s*;?\s*\/\/.*(?:limit|cap|max)/i,
    message: "Hardcoded slice cap with limit comment — may conflict with DB trigger guards",
    allowIf: null,  // manual review
  },
];

// Steps that have known DB trigger guards requiring dynamic coverage
const TRIGGER_GUARDED_STEPS = [
  { step: "generate_oral_exam", guard: "trg_guard_oral_exam_completeness", requires: "100% competency coverage" },
  { step: "quality_council", guard: "governance trigger", requires: "council_approved=true before done" },
  { step: "generate_exam_pool", guard: "materialization threshold", requires: "minimum question count" },
];

let violations = 0;
let warnings = 0;

const entries = fs.readdirSync(FUNCTIONS_DIR, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  if (!entry.name.startsWith("package-")) continue;

  const indexPath = path.join(FUNCTIONS_DIR, entry.name, "index.ts");
  if (!fs.existsSync(indexPath)) continue;

  const content = fs.readFileSync(indexPath, "utf8");

  for (const { pattern, message, allowIf } of FORBIDDEN_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      if (allowIf && allowIf.test(content)) continue;  // dynamic pattern found, OK
      console.error(`❌ ${entry.name}/index.ts: ${message}`);
      console.error(`   Found: ${match[0]}`);
      violations++;
    }
  }
}

// Check that trigger-guarded steps have pre-flight validation comments
for (const { step, guard, requires } of TRIGGER_GUARDED_STEPS) {
  const fnName = `package-${step.replace(/_/g, "-")}`;
  const indexPath = path.join(FUNCTIONS_DIR, fnName, "index.ts");
  if (!fs.existsSync(indexPath)) continue;

  const content = fs.readFileSync(indexPath, "utf8");

  // Check for coverage assertion or pre-flight check
  const hasCoverageCheck = /[Cc]overage|[Pp]re-?[Ff]light|assert.*[Cc]over|COVERAGE_GUARANTEE/i.test(content);
  if (!hasCoverageCheck) {
    console.warn(`⚠️  ${fnName}: No coverage/pre-flight check found. DB guard "${guard}" requires: ${requires}`);
    warnings++;
  }
}

if (violations > 0) {
  console.error(`\n🚫 ${violations} trigger-function parity violation(s) found.`);
  console.error(`   Hardcoded limits that conflict with DB trigger guards are forbidden.`);
  console.error(`   Use dynamic allocation: Math.max(MIN, actualCount)`);
  process.exit(1);
}

if (warnings > 0) {
  console.warn(`\n⚠️  ${warnings} warning(s) — review recommended but not blocking.`);
}

console.log("✅ Trigger-function parity: no hardcoded limit conflicts found");
