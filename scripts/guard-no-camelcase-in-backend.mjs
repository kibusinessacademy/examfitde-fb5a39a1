#!/usr/bin/env node

/**
 * CI Guard: No camelCase contract tokens in backend/system code.
 *
 * Enforces SSOT Naming Contract: all system-boundary code must use snake_case.
 * camelCase is only allowed in explicit UI mappers or the canonicalizer.
 *
 * Modes:
 *   --mode=report   (default) Report violations, exit 0
 *   --mode=warn     Report violations, exit 0 (same as report)
 *   --mode=strict   Report violations, exit 1 if any found
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const modeArg = args.find(a => a.startsWith("--mode="));
const MODE = modeArg ? modeArg.split("=")[1] : "report";

const TARGET_DIRS = [
  "supabase/functions",
  "src/lib/jobs",
  "src/lib/contracts",
  "src/lib/workers",
  "src/lib/pipeline",
];

/** Files where camelCase aliases are explicitly allowed */
const ALLOWED_FILES = new Set([
  "src/lib/contracts/canonicalize.ts",
  "src/lib/ui/mappers/package-mappers.ts",
]);

/** Directories to always skip */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

const FORBIDDEN_PATTERNS = [
  /\bpackageId\b/g,
  /\bcurriculumId\b/g,
  /\bcourseId\b/g,
  /\bblueprintId\b/g,
  /\bcompetencyId\b/g,
  /\blessonId\b/g,
  /\bstepKey\b/g,
  /\bjobType\b/g,
  /\bprogramType\b/g,
  /\brunAfter\b/g,
  /\bpayloadVersion\b/g,
  /\blearningFieldFilter\b/g,
];

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];

for (const relDir of TARGET_DIRS) {
  const absDir = path.join(ROOT, relDir);
  const files = walk(absDir);

  for (const absFile of files) {
    const relFile = path.relative(ROOT, absFile).replaceAll("\\", "/");
    if (ALLOWED_FILES.has(relFile)) continue;

    const content = fs.readFileSync(absFile, "utf8");

    for (const pattern of FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = [...content.matchAll(pattern)];
      for (const match of matches) {
        violations.push({ file: relFile, token: match[0] });
      }
    }
  }
}

if (violations.length > 0) {
  const label = MODE === "strict" ? "❌" : "⚠️";
  console.error(`\n${label} CamelCase contract violations found in backend/system code:\n`);
  const byFile = {};
  for (const v of violations) {
    if (!byFile[v.file]) byFile[v.file] = new Set();
    byFile[v.file].add(v.token);
  }
  for (const [file, tokens] of Object.entries(byFile)) {
    console.error(`  ${file}: ${[...tokens].join(", ")}`);
  }
  console.error(`\n  Total: ${violations.length} violations in ${Object.keys(byFile).length} files`);
  console.error("  Allowed only in explicit UI mappers or canonicalizers.");
  console.error(`  Mode: ${MODE}\n`);

  if (MODE === "strict") {
    process.exit(1);
  }
} else {
  console.log("✅ No forbidden camelCase contract tokens found in backend/system code.");
}
