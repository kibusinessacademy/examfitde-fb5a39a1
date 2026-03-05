#!/usr/bin/env node
/**
 * Offline Schema Drift Check:
 * Ensures migrations dir exists and schema snapshot is updated when migrations change.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";

const SNAPSHOT = "supabase/schema.sql";

if (!fs.existsSync("supabase/migrations")) {
  console.error("\n❌ Offline Drift: supabase/migrations missing.\n");
  process.exit(1);
}

if (fs.existsSync(SNAPSHOT)) {
  const base = process.env.CI_DIFF_BASE || "origin/main";
  let changed = [];
  try {
    changed = execSync(`git diff --name-only ${base}...HEAD`, { stdio: ["ignore", "pipe", "pipe"] })
      .toString("utf8").split("\n").map(s => s.trim()).filter(Boolean);
  } catch {
    // No git context — skip
  }

  const migChanged = changed.some(f => f.startsWith("supabase/migrations/"));
  const snapChanged = changed.includes(SNAPSHOT);

  if (migChanged && !snapChanged) {
    console.error("\n❌ Offline Drift: migrations changed but schema snapshot not updated (supabase/schema.sql).\n");
    console.error("Fix: regenerate schema.sql or update your snapshot workflow.\n");
    process.exit(1);
  }
}

console.log("✅ Offline Schema Drift passed.");
