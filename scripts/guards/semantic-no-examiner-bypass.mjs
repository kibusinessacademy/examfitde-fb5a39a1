#!/usr/bin/env node
/**
 * Guard: semantic / pillar layers MUST NOT reimplement examiner logic.
 *
 * Scans `src/lib/semantic/**`, `src/lib/llm-grounding/**`, and
 * `src/components/pillar/**` for forbidden tokens that would indicate
 * locally-computed readiness, confidence, verdict, or risk severity.
 *
 * Exits non-zero on first violation. Baseline waivers go into
 * `scripts/guards/semantic-no-examiner-bypass.baseline.json` if needed.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  "src/lib/semantic",
  "src/lib/llm-grounding",
  "src/components/pillar",
];

const FORBIDDEN = [
  // local readiness computation
  /\breadiness_state\s*=/,
  /\bcompute(?:Readiness|Confidence|Verdict)\b/,
  /\bderiveReadiness\b/,
  // local verdict / threshold logic
  /\bif\s*\(\s*score\s*[<>]=?\s*\d+/,
  // local examiner mutation
  /\bExaminer\w*\.(set|update|mutate)\b/,
];

const BASELINE_PATH = join(ROOT, "scripts/guards/semantic-no-examiner-bypass.baseline.json");
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
    const rel = relative(ROOT, file);
    if (waived.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    for (const pat of FORBIDDEN) {
      if (pat.test(src)) {
        violations.push({ file: rel, pattern: pat.source });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("✗ semantic-no-examiner-bypass: forbidden tokens detected");
  for (const v of violations) console.error(`  - ${v.file}  (pattern: /${v.pattern}/)`);
  console.error("\nThe semantic / pillar / llm-grounding layers MUST read examiner facts from");
  console.error("`@/lib/examiner` (Handover Contract). They MUST NOT compute readiness,");
  console.error("confidence, verdicts, or alternative risks locally.");
  process.exit(1);
}

console.log(`✓ semantic-no-examiner-bypass: scanned ${SCAN_DIRS.join(", ")} — clean`);
