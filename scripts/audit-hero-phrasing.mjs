#!/usr/bin/env node
/**
 * audit-hero-phrasing.mjs
 *
 * CI-/Dev-Gate: Scannt das gesamte Repository nach verbotenen
 * Live-Content-Formulierungen wie
 *
 *   "als AEVO"
 *   "als BWL"
 *   "Prüfung als {VAR}"            (Templates ohne SSOT)
 *   "Abschlussprüfung als {VAR}"
 *
 * außerhalb der zentralen Hero-Phrasing-SSOT.
 *
 * Exit-Codes:
 *   0 — clean
 *   1 — forbidden phrasing found
 *
 * Usage:
 *   node scripts/audit-hero-phrasing.mjs
 *   node scripts/audit-hero-phrasing.mjs --json
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC_DIRS = ["src", "supabase/functions"];

const ALLOWLIST = new Set([
  "src/lib/hero/heroPhrasing.ts",
  "src/lib/hero/unclassifiableLogger.ts",
  "scripts/audit-hero-phrasing.mjs",
]);

const ALLOWLIST_DIR_PREFIXES = [
  "src/lib/hero/__tests__/",
  ".lovable/",
  "node_modules/",
  "dist/",
];

// "näher an der Prüfung als du denkst" -> idiomatic comparison, allowed.
const ALLOWED_IDIOMS = [
  /n(ä|ae)her an der Pr(ü|ue)fung als du denkst/i,
  /Pr(ü|ue)fung als Komplettpaket/i,
];

const PATTERNS = [
  { id: "ALS_AEVO", re: /\bals\s+AEVO\b/i, severity: "critical" },
  { id: "ALS_BWL", re: /\bals\s+BWL\b/i, severity: "critical" },
  { id: "PRUEFUNG_ALS_VAR", re: /Pr(ü|ue)fung\s+als\s+\{/g, severity: "critical" },
  { id: "ABSCHLUSSPRUEFUNG_ALS_VAR", re: /Abschlusspr(ü|ue)fung\s+als\s+\{/g, severity: "critical" },
  { id: "PRUEFUNG_ALS_DOLLAR_VAR", re: /Pr(ü|ue)fung\s+als\s+\$\{/g, severity: "critical" },
  { id: "ABSCHLUSSPRUEFUNG_ALS_DOLLAR_VAR", re: /Abschlusspr(ü|ue)fung\s+als\s+\$\{/g, severity: "critical" },
];

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".md", ".sql"]);

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function isAllowed(rel) {
  if (ALLOWLIST.has(rel)) return true;
  return ALLOWLIST_DIR_PREFIXES.some((p) => rel.startsWith(p));
}

function lineHasAllowedIdiom(line) {
  return ALLOWED_IDIOMS.some((re) => re.test(line));
}

const findings = [];

for (const dir of SRC_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file);
    if (isAllowed(rel)) continue;
    const ext = "." + (rel.split(".").pop() || "");
    if (!EXTENSIONS.has(ext)) continue;
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");
    lines.forEach((line, idx) => {
      if (lineHasAllowedIdiom(line)) return;
      for (const p of PATTERNS) {
        if (p.re.test(line)) {
          findings.push({
            file: rel,
            line: idx + 1,
            pattern: p.id,
            severity: p.severity,
            snippet: line.trim().slice(0, 200),
          });
        }
      }
    });
  }
}

const asJson = process.argv.includes("--json");
if (asJson) {
  process.stdout.write(JSON.stringify({ findings, count: findings.length }, null, 2));
} else if (findings.length === 0) {
  console.log("✅ hero-phrasing audit: 0 forbidden phrases found.");
} else {
  console.log(`❌ hero-phrasing audit: ${findings.length} forbidden phrases found:`);
  for (const f of findings) {
    console.log(`  [${f.severity}] ${f.file}:${f.line}  (${f.pattern})`);
    console.log(`     ${f.snippet}`);
  }
}

process.exit(findings.length === 0 ? 0 : 1);
