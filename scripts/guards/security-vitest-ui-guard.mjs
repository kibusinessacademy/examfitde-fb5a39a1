#!/usr/bin/env node
/**
 * SECURITY.DEPENDENCY.HARDENING.P0 guard
 *
 * Blocks regressions of the three mitigations baked into our P0
 * dependency-hardening cut:
 *
 *  1. Vitest UI server MUST NOT be referenced from any committed script,
 *     workflow or env file. The Vitest UI is the surface of the Critical
 *     "arbitrary file read/execution" advisory (GHSA-9crc-q9x8-hgqq).
 *  2. The `@vitest/ui` package MUST NOT appear in package.json
 *     (dependencies, devDependencies, optionalDependencies).
 *  3. Dev/preview servers MUST NOT be exposed on 0.0.0.0 from scripts
 *     (vite/vitest dev/preview/--host 0.0.0.0).
 *
 * Run via: node scripts/guards/security-vitest-ui-guard.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [".github/workflows", "scripts", "tests"];
const SCAN_FILES = ["package.json", "vite.config.ts", "vitest.config.ts"];

const FORBIDDEN_PATTERNS = [
  { re: /vitest\s+(?:[^\n]*\s)?--ui\b/, msg: "Vitest UI flag (--ui) detected" },
  { re: /@vitest\/ui/, msg: "@vitest/ui package reference detected" },
  {
    re: /(?:vite|vitest)[^\n]*--host[^\n]*0\.0\.0\.0/,
    msg: "Dev/preview server bound to 0.0.0.0",
  },
];

const violations = [];

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p);
    else if (s.isFile() && /\.(json|ya?ml|mjs|cjs|js|ts|tsx|sh)$/.test(e)) {
      scan(p);
    }
  }
}

function scan(path) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return; }
  for (const { re, msg } of FORBIDDEN_PATTERNS) {
    const m = text.match(re);
    if (m) {
      violations.push({ path, msg, snippet: m[0].slice(0, 120) });
    }
  }
}

for (const d of SCAN_DIRS) walk(join(ROOT, d));
for (const f of SCAN_FILES) scan(join(ROOT, f));

// Extra structural check: package.json must not list @vitest/ui anywhere
try {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    if (pkg[field]?.["@vitest/ui"]) {
      violations.push({
        path: "package.json",
        msg: `@vitest/ui declared in ${field}`,
        snippet: `${field}["@vitest/ui"] = ${pkg[field]["@vitest/ui"]}`,
      });
    }
  }
} catch (err) {
  console.error("::warning::Could not parse package.json:", err.message);
}

if (violations.length > 0) {
  console.error("\n::error::SECURITY.DEPENDENCY.HARDENING.P0 guard FAILED");
  console.error("The following forbidden patterns were detected:");
  for (const v of violations) {
    console.error(`  - [${v.msg}] in ${v.path}`);
    console.error(`      ${v.snippet}`);
  }
  console.error(
    "\nRationale: Vitest UI / open dev-server bindings are the attack surface " +
      "of GHSA-9crc-q9x8-hgqq (Critical). Remove the offending reference."
  );
  process.exit(1);
}

console.log(
  `✓ security-vitest-ui-guard OK — scanned ${SCAN_DIRS.join(", ")} + ${SCAN_FILES.length} root files, no forbidden patterns.`
);
