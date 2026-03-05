#!/usr/bin/env node
/**
 * Curriculum Freeze Guard: Protect frozen curriculum assets.
 * Blocks modification of existing migrations and SSOT docs.
 * Adding NEW migrations is allowed.
 */
import { execSync } from "node:child_process";

const base = process.env.CI_DIFF_BASE || "origin/main";

let diff;
try {
  diff = execSync(`git diff --name-only ${base}...HEAD`, { stdio: ["ignore", "pipe", "pipe"] })
    .toString("utf8")
    .split("\n").map(s => s.trim()).filter(Boolean);
} catch {
  console.log("✅ Curriculum Freeze Guard passed (no git diff available).");
  process.exit(0);
}

const PROTECTED = [
  "supabase/migrations/",
  "docs/SSOT_RULES.md",
  "scripts/curriculum/",
];

function isProtected(f) {
  return PROTECTED.some(p => f.startsWith(p));
}

const protectedFiles = diff.filter(isProtected);

if (!protectedFiles.length) {
  console.log("✅ Curriculum Freeze Guard passed (no protected files changed).");
  process.exit(0);
}

let edited;
try {
  edited = execSync(`git diff --name-status ${base}...HEAD`, { stdio: ["ignore", "pipe", "pipe"] })
    .toString("utf8")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const [status, ...rest] = l.split(/\s+/);
      return { status, file: rest.join(" ") };
    });
} catch {
  edited = [];
}

const bad = [];
for (const e of edited) {
  if (!e.file) continue;
  if (!isProtected(e.file)) continue;

  if (e.file.startsWith("supabase/migrations/")) {
    // Only block MODIFICATION of existing migrations; new ones (A) are fine
    if (e.status === "M") bad.push({ file: e.file, reason: "Existing migration modified" });
    continue;
  }
  if (e.status === "M") bad.push({ file: e.file, reason: "Protected SSOT asset modified" });
}

if (bad.length) {
  console.error("\n❌ Curriculum Freeze Guard: protected/frozen assets modified.\n");
  for (const b of bad.slice(0, 40)) console.error(`  - ${b.file} (${b.reason})`);
  console.error("\nFix: Add new migration instead of editing old ones; keep SSOT frozen assets stable.\n");
  process.exit(1);
}

console.log("✅ Curriculum Freeze Guard passed (protected changes acceptable).");
