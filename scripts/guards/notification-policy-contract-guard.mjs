#!/usr/bin/env node
/**
 * Notification Policy Contract Guard (Track 2.F)
 *
 * Enforces invariants from docs/contracts/notification-policy-contract.md.
 * Warn-only baseline today, hard-fail on new violations.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "supabase/functions"];
const SKIP = new Set(["node_modules", ".git", "dist", "build", "__tests__", "test", "tests", "e2e"]);
const EXTS = [".ts", ".tsx", ".mjs", ".js"];

const CRITICAL_INTENTS = ["exam_countdown", "payment_reminder", "support_reply"];

const violations = [];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (EXTS.some((e) => name.endsWith(e))) yield p;
  }
}

function check(file, src) {
  const rel = relative(ROOT, file);

  // I1: direct insert into notification_dispatch_decisions outside of DB
  if (/INSERT\s+INTO\s+notification_dispatch_decisions/i.test(src) ||
      /from\(['"]notification_dispatch_decisions['"]\)\s*\.insert/i.test(src)) {
    violations.push({ rel, msg: "I1: direct write to notification_dispatch_decisions (canonical writer is fn_enforce_notification_policy)" });
  }

  // I2: suppressing critical intent from code
  for (const intent of CRITICAL_INTENTS) {
    const re = new RegExp(`['"\`]${intent}['"\`][\\s\\S]{0,160}?suppress`, "i");
    if (re.test(src)) {
      violations.push({ rel, msg: `I2: critical intent '${intent}' near 'suppress' — must be safety-clamped` });
    }
  }

  // I1 (loose): edge sends without prior enforce call (only checked in send-learner-push)
  if (rel.endsWith("send-learner-push/index.ts")) {
    if (!/fn_enforce_notification_policy/.test(src)) {
      violations.push({ rel, msg: "I1: send-learner-push must call fn_enforce_notification_policy before delivery" });
    }
  }
}

for (const d of SCAN_DIRS) {
  try {
    for (const f of walk(join(ROOT, d))) {
      check(f, readFileSync(f, "utf8"));
    }
  } catch { /* dir may not exist locally */ }
}

if (violations.length === 0) {
  console.log("✅ notification-policy-contract-guard: 0 violations");
  process.exit(0);
}

console.error(`❌ notification-policy-contract-guard: ${violations.length} violation(s)`);
for (const v of violations) console.error(` - ${v.rel}: ${v.msg}`);
process.exit(1);
