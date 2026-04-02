#!/usr/bin/env node

/**
 * CI Guard: No raw INSERT INTO package_steps outside ensure_package_step()
 * 
 * All step creation must go through ensure_package_step() (DB RPC)
 * or use ON CONFLICT DO NOTHING. Raw inserts risk DUPLICATE_STEP_KEY
 * transaction rollbacks.
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

// Files allowed to contain raw package_steps inserts
const ALLOWLIST = [
  "ensure_package_step",           // the helper itself
  "package_steps_sort_order_guard", // the trigger guard
  "ops-phantom-step-e2e-test",     // test harness
  "migrations",                     // migration files
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

// Check Edge Functions / shared code
const edgeFiles = walk(path.join(ROOT, "supabase", "functions"));
for (const file of edgeFiles) {
  if (ALLOWLIST.some(a => file.includes(a))) continue;
  const content = fs.readFileSync(file, "utf8");

  // Pattern 1: .from("package_steps").insert(
  const fromInserts = [...content.matchAll(/\.from\(\s*['"]package_steps['"]\s*\)[\s\S]{0,20}\.insert\(/g)];
  for (const m of fromInserts) {
    const line = content.substring(0, m.index).split("\n").length;
    console.error(`❌ Raw .from("package_steps").insert() in ${file}:${line}`);
    violations++;
  }

  // Pattern 2: INSERT INTO package_steps (SQL in template literals)
  const sqlInserts = [...content.matchAll(/INSERT\s+INTO\s+(?:public\.)?package_steps/gi)];
  for (const m of sqlInserts) {
    if (content.substring(m.index, m.index + 200).includes("ON CONFLICT")) continue;
    const line = content.substring(0, m.index).split("\n").length;
    console.error(`❌ Raw INSERT INTO package_steps (no ON CONFLICT) in ${file}:${line}`);
    violations++;
  }
}

if (violations > 0) {
  console.error(`\n🚫 ${violations} raw package_steps insert(s) found. Use sb.rpc("ensure_package_step", ...) instead.`);
  process.exit(1);
}

console.log("✅ No raw package_steps inserts — all step creation goes through ensure_package_step()");
