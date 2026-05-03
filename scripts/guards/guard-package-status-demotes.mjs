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
  const src = lines.join("\n");
  // line offsets
  const lineStart = [0];
  for (let k = 0; k < src.length; k++) if (src[k] === "\n") lineStart.push(k + 1);

  const re = /\.from\(\s*["'`]course_packages["'`]\s*\)\s*\.update\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    // find balanced paren end after re.lastIndex - 1 (the '(' position)
    const openIdx = m.index + m[0].length - 1;
    let depth = 1, j = openIdx + 1;
    while (j < src.length && depth > 0) {
      const ch = src[j];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      j++;
    }
    const objText = src.slice(openIdx, j);
    if (!STATUS_QUEUED_RE.test(objText)) continue;

    // line number of the .update( call
    const callPos = m.index;
    let lineNo = 1;
    for (let k = 1; k < lineStart.length; k++) {
      if (lineStart[k] > callPos) { lineNo = k; break; }
      lineNo = k + 1;
    }
    const ctxStart = Math.max(0, lineNo - 1 - WINDOW_BEFORE);
    const ctxEnd = Math.min(lines.length, lineNo + 5);
    const ctx = lines.slice(ctxStart, ctxEnd).join("\n");
    const hasMarker = MARKERS.some((mk) => ctx.includes(mk));
    if (!hasMarker) {
      violations.push({ file, line: lineNo, snippet: lines[lineNo - 1].trim() });
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
