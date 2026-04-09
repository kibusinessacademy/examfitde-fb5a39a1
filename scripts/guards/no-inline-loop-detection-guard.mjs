#!/usr/bin/env node

/**
 * CI Guard: No inline terminal-loop / job-liveness detection
 * outside stuck-scan-helpers.ts
 *
 * All "is this job genuinely active?" logic MUST go through the
 * SSOT functions in stuck-scan-helpers.ts:
 *   - isTerminalRetryLoop()
 *   - filterGenuinelyActiveJobs()
 *   - isStepFinalizable()
 *
 * This guard prevents ad-hoc loop detection patterns that cause
 * finalization deadlocks when watchers disagree on job liveness.
 *
 * Ref: Incident April 2026 — inline job-count checks in healers
 * missed terminal retry loops, causing 18 steps to deadlock.
 */

import { glob } from "glob";
import { readFileSync } from "fs";

const SSOT_FILE = "supabase/functions/_shared/stuck-scan-helpers.ts";

// Patterns that indicate inline loop detection (outside SSOT)
const FORBIDDEN_PATTERNS = [
  // Raw attempt+error checks that should use isTerminalRetryLoop
  /attempts\s*>=?\s*\d+\s*&&.*last_error/,
  /last_error.*includes\s*\(\s*["']STALE_LOCK/,
  /last_error.*includes\s*\(\s*["']LOOP_KILLED/,
  /last_error.*includes\s*\(\s*["']ZOMBIE_TERMINAL/,
  /last_error.*includes\s*\(\s*["']LOCK_CHURN/,
];

// Files allowed to contain these patterns
const ALLOWED_FILES = new Set([
  SSOT_FILE,
  "supabase/functions/_shared/stuck-scan-stale-lock-loop.ts", // dedicated stale-lock handler
  "supabase/functions/content-runner/index.ts", // produces STALE_LOCK errors (not detection)
  "scripts/guards/no-inline-loop-detection-guard.mjs", // this file
]);

const files = glob.sync("supabase/functions/**/*.ts", {
  ignore: ["**/node_modules/**"],
});

const violations = [];

for (const file of files) {
  if (ALLOWED_FILES.has(file)) continue;

  const content = readFileSync(file, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          file,
          line: i + 1,
          text: line.trim().slice(0, 120),
          pattern: pattern.source,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.warn(`\n⚠️  no-inline-loop-detection-guard: ${violations.length} potential inline loop detection(s) found\n`);
  console.warn("All job-liveness / terminal-loop checks MUST use the SSOT functions from:");
  console.warn(`  ${SSOT_FILE}\n`);
  console.warn("  - isTerminalRetryLoop(job)");
  console.warn("  - filterGenuinelyActiveJobs(jobs)");
  console.warn("  - isStepFinalizable(sb, step, jobType)\n");

  for (const v of violations) {
    console.warn(`  ${v.file}:${v.line}`);
    console.warn(`    ${v.text}\n`);
  }

  // warn-only for now — will be promoted to exit(1) after legacy cleanup
  // process.exit(1);
} else {
  console.log("✅ no-inline-loop-detection-guard: all loop detection goes through SSOT");
}
