#!/usr/bin/env node
/**
 * Phase 8.4 — Examiner Legacy Logic Scanner.
 *
 * Verbietet lokale Readiness-/Verdict-/Risk-Heuristiken außerhalb der
 * zentralen Examiner-SSOT (src/lib/examiner/**, src/lib/system/**).
 *
 * Failt CI, wenn Surfaces eigene prüferische Wahrheit erzeugen.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  "src/pages/app",
  "src/pages/quiz",
  "src/pages/dashboard",
  "src/components/dashboard",
  "src/components/system",
  "src/components/tutor",
  "src/features/mastery/components",
];
const SSOT_ALLOWLIST = [
  /^src\/lib\/examiner\//,
  /^src\/lib\/system\//,
  /^src\/__tests__\//,
  /\.test\.tsx?$/,
];

const LEGACY_PATTERNS = [
  { id: "local_readiness_calc", re: /readiness\s*=\s*\(?\s*\d+\s*[\*\+\-\/]/i, desc: "Lokale Readiness-Arithmetik" },
  { id: "local_verdict_text", re: /\bverdict\s*[:=]\s*['"`](stable|risk|critical)['"`]/i, desc: "Lokales Verdict-Literal" },
  { id: "local_risk_derive", re: /failRisk\s*=\s*Math\.(?:max|min|round)/i, desc: "Lokale Risiko-Ableitung" },
  { id: "local_confidence", re: /confidence\s*=\s*\d+\s*\/\s*\d+/i, desc: "Lokale Confidence-Berechnung" },
  { id: "motivational_copy", re: /\b(super|großartig|fantastisch|geschafft!|stark!|toll gemacht|Wahnsinn|krass)\b/i, desc: "Motivationale Sprache" },
  { id: "percent_threshold", re: />=?\s*(?:75|80|85|90)\s*%?\s*\?\s*['"`](ready|bereit|stable)['"`]/i, desc: "Hardcoded Prozent-Schwelle" },
];

const BASELINE = new Set([
  // Known legacy surfaces — must be migrated in follow-up sweep (Phase 8.4 burn-down).
  "src/components/dashboard/RiskCostWidget.tsx:14:local_risk_derive",
]);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const violations = [];
for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file);
    if (SSOT_ALLOWLIST.some((re) => re.test(rel))) continue;
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      // Skip comments
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const pat of LEGACY_PATTERNS) {
        if (pat.re.test(line)) {
          const key = `${rel}:${i + 1}:${pat.id}`;
          if (BASELINE.has(key)) continue;
          violations.push({ file: rel, line: i + 1, id: pat.id, desc: pat.desc, snippet: line.trim().slice(0, 120) });
        }
      }
    });
  }
}

if (violations.length === 0) {
  console.log("✅ examiner-legacy-logic: clean (0 violations)");
  process.exit(0);
}

console.error(`❌ examiner-legacy-logic: ${violations.length} violations`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line} [${v.id}] ${v.desc}\n    ${v.snippet}`);
}
console.error("\nFix: move logic into src/lib/examiner/** and read from useExaminerConsciousness().");
process.exit(1);
