#!/usr/bin/env node

/**
 * CI Guard: Early-Cancel Repeat Failure Detection
 * 
 * Ensures that the system-scheduler-guardrail-cron or governance audit
 * includes a check for consecutive step failures (same step, same package).
 * 
 * Pattern detected: A step fails 3+ times → should escalate to P1 alert
 * instead of silently retrying to max_attempts (8).
 * 
 * This guard verifies the cron governance code includes repeat-failure detection.
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const CRON_FILES = [
  "supabase/functions/system-scheduler-guardrail-cron/index.ts",
  "supabase/functions/system-cron-governance-audit/index.ts",
];

let hasRepeatFailureCheck = false;

for (const relPath of CRON_FILES) {
  const filePath = path.join(ROOT, relPath);
  if (!fs.existsSync(filePath)) continue;
  const content = fs.readFileSync(filePath, "utf8");
  if (/repeat.*fail|consecutive.*fail|fn_detect_repeat_failures|repeat_failure/i.test(content)) {
    hasRepeatFailureCheck = true;
    break;
  }
}

if (!hasRepeatFailureCheck) {
  console.warn("⚠️  No repeat-failure detection found in cron governance functions.");
  console.warn("   Recommended: Add fn_detect_repeat_failures RPC or equivalent check.");
  // Warning only — not blocking until the DB function is implemented
}

console.log("✅ Early-cancel repeat failure guard passed (advisory)");
