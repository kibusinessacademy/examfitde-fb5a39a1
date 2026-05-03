#!/usr/bin/env node
/**
 * guard-package-status-demotes.mjs
 *
 * Verhindert neue building→queued-Loops auf course_packages.
 *
 * Regel:
 *   Jeder `from("course_packages").update({ ... status: "queued" ... })`
 *   muss innerhalb desselben Code-Blocks (±25 Zeilen oberhalb) eines der
 *   folgenden Marker enthalten:
 *
 *     - fn_package_demote_protected   (Protection-Gate-RPC)
 *     - admin_force_publish           (Admin-Bypass)
 *     - SAFE_PACKAGE_STATUS_DEMOTE    (expliziter Allowlist-Kommentar mit Begründung)
 *
 * Exit 0 = clean, Exit 1 = violations.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOTS = ["supabase/functions", "scripts", "src"];
const MARKERS = ["fn_package_demote_protected", "admin_force_publish", "SAFE_PACKAGE_STATUS_DEMOTE"];
const WINDOW_BEFORE = 25; // lines above the .update({ block start

// 1) Collect candidate files via rg
let files;
try {
  const out = execSync(
    `rg -l -g '*.ts' -g '*.tsx' -g '*.js' -g '*.mjs' 'course_packages' ${ROOTS.join(" ")}`,
    { encoding: "utf8" },
  );
  files = out.split("\n").filter(Boolean);
} catch {
  files = [];
}

const violations = [];

const UPDATE_RE = /\.from\(\s*["'`]course_packages["'`]\s*\)\s*\.update\(/;
const STATUS_QUEUED_RE = /status\s*:\s*["'`]queued["'`]/;

for (const file of files) {
  // skip the guard itself + tests + migrations
  if (file.includes("guard-package-status-demotes")) continue;
  if (/\.test\.(ts|tsx|js|mjs)$/.test(file)) continue;
  if (file.includes("supabase/migrations")) continue;

  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!UPDATE_RE.test(lines[i])) continue;
    // Look ahead up to 30 lines for the closing ); to capture the object
    const blockEnd = Math.min(lines.length, i + 30);
    const block = lines.slice(i, blockEnd).join("\n");
    const cutAtClose = block.indexOf("});");
    const objText = cutAtClose >= 0 ? block.slice(0, cutAtClose + 3) : block;
    if (!STATUS_QUEUED_RE.test(objText)) continue;

    // Look back WINDOW_BEFORE lines for any marker (and forward a few for SAFE comment on prior line)
    const ctxStart = Math.max(0, i - WINDOW_BEFORE);
    const ctx = lines.slice(ctxStart, i + 5).join("\n");
    const hasMarker = MARKERS.some((m) => ctx.includes(m));
    if (!hasMarker) {
      violations.push({ file, line: i + 1, snippet: lines[i].trim() });
    }
  }
}

if (violations.length === 0) {
  console.log("✅ guard-package-status-demotes: 0 violations");
  process.exit(0);
}

console.error(`❌ guard-package-status-demotes: ${violations.length} unsafe demote(s) found.`);
console.error("   Each unsafe site must call fn_package_demote_protected first,");
console.error("   route through admin_force_publish, or carry a SAFE_PACKAGE_STATUS_DEMOTE comment.\n");
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.snippet}`);
}
process.exit(1);
