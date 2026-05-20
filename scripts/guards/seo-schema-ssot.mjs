#!/usr/bin/env node
/**
 * Guard: NEW JSON-LD must be produced via `src/lib/seo/schema/**` SSOT.
 *
 * Scans `src/**` for hand-rolled `application/ld+json` scripts or
 * inline `"@type": "Course|FAQPage|QAPage|DefinedTerm|BreadcrumbList|EducationEvent|DefinedTermSet"`
 * literal strings outside the SSOT layer.
 *
 * Existing legacy files are waived in
 * `scripts/guards/seo-schema-ssot.baseline.json`. New violations fail CI.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src"];
const SSOT_PREFIX = "src/lib/seo/schema/";
const TEST_RE = /(\.test\.|\/__tests__\/|\/test\/)/;

const PATTERNS = [
  /application\/ld\+json/,
  /"@type"\s*:\s*"(Course|FAQPage|QAPage|DefinedTerm|DefinedTermSet|BreadcrumbList|EducationEvent)"/,
];

const BASELINE_PATH = join(ROOT, "scripts/guards/seo-schema-ssot.baseline.json");
const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : { waived: [] };
const waived = new Set(baseline.waived ?? []);

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const violations = [];
for (const d of SCAN_DIRS) {
  const abs = join(ROOT, d);
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (rel.startsWith(SSOT_PREFIX)) continue;
    if (TEST_RE.test(rel)) continue;
    if (waived.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    for (const pat of PATTERNS) {
      if (pat.test(src)) {
        violations.push({ file: rel, pattern: pat.source });
        break;
      }
    }
  }
}

if (violations.length > 0) {
  console.error("✗ seo-schema-ssot: hand-rolled JSON-LD detected outside SSOT layer");
  for (const v of violations) console.error(`  - ${v.file}  (matched: /${v.pattern}/)`);
  console.error("\nNew JSON-LD must be produced via `@/lib/seo/schema` builders.");
  console.error("Existing legacy files may be waived in scripts/guards/seo-schema-ssot.baseline.json.");
  process.exit(1);
}

console.log(`✓ seo-schema-ssot: scanned src — clean (waived ${waived.size})`);
