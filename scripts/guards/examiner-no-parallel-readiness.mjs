#!/usr/bin/env node
/**
 * Phase 8.9b — Final Governance Lock.
 *
 * Verbietet, dass NEUE Dateien außerhalb von `src/lib/examiner/**`
 * (und unterstützend `src/lib/system/**`) eigene Readiness-,
 * Confidence-, Verdict- oder Evidence-Produzenten einführen.
 *
 * Erlaubt: Konsum von `useExaminerConsciousness()` und Lesen
 * vorhandener Felder (`authority.state`, `deliberation.*`,
 * `verdictEvidence`, ...).
 *
 * Verboten: neue Funktions-/Variablen-Deklarationen, die
 * Readiness/Verdict/Confidence/Evidence ERZEUGEN.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_ROOT = "src";
const SSOT_ALLOWLIST = [
  /^src\/lib\/examiner\//,
  /^src\/lib\/system\//,
  /^src\/__tests__\//,
  /\.test\.tsx?$/,
];

// Producer-Patterns: NUR Deklarationen, nicht Reads.
const PRODUCER_PATTERNS = [
  { id: "decl_readiness_state",      re: /\b(?:function|const|let|var|export\s+(?:function|const))\s+(?:derive|compute|build|make|get)Readiness(?:State)?\b/i, desc: "Eigener Readiness-State Producer" },
  { id: "decl_confidence",           re: /\b(?:function|const|let|var|export\s+(?:function|const))\s+(?:derive|compute|build|calc)Confidence\b/i,             desc: "Eigener Confidence Producer" },
  { id: "decl_verdict",              re: /\b(?:function|const|let|var|export\s+(?:function|const))\s+(?:derive|compute|build|make)Verdict\b/i,                desc: "Eigener Verdict Producer" },
  { id: "decl_evidence",             re: /\b(?:function|const|let|var|export\s+(?:function|const))\s+(?:derive|compute|build|make)Evidence\b/i,               desc: "Eigener Evidence Producer" },
  { id: "interface_examiner_output", re: /\b(?:interface|type)\s+(?:Readiness|Verdict|Evidence)(?:State|Chain|Output)?\b\s*[=\{]/,                            desc: "Eigene Examiner-Output-Typdefinition" },
];

const BASELINE = new Set([
  // Pre-existing, NICHT examiner-readiness-bezogen — dokumentiert in
  // docs/exceptions/examiner-legacy-exceptions.md.
  "src/components/admin/publish-blockers/L2EnforceReadinessCard.tsx:17:interface_examiner_output",
  "src/components/b2b/RiskBadge.tsx:4:interface_examiner_output",
  "src/features/mastery/api/masteryApi.ts:46:decl_readiness_state",
  "src/lib/admin/runPhantomStepE2ETest.ts:3:interface_examiner_output",
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
for (const file of walk(join(ROOT, SCAN_ROOT))) {
  const rel = relative(ROOT, file);
  if (SSOT_ALLOWLIST.some((re) => re.test(rel))) continue;
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const pat of PRODUCER_PATTERNS) {
      if (pat.re.test(line)) {
        const key = `${rel}:${i + 1}:${pat.id}`;
        if (BASELINE.has(key)) continue;
        violations.push({ file: rel, line: i + 1, id: pat.id, desc: pat.desc, snippet: line.trim().slice(0, 140) });
      }
    }
  });
}

if (violations.length === 0) {
  console.log("✅ examiner-no-parallel-readiness: clean (0 violations)");
  process.exit(0);
}

console.error(`❌ examiner-no-parallel-readiness: ${violations.length} violations`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line} [${v.id}] ${v.desc}\n    ${v.snippet}`);
}
console.error("\nFix: Producer gehören in src/lib/examiner/**. Surfaces konsumieren via useExaminerConsciousness().");
console.error("Dokumentierte Ausnahmen: docs/exceptions/examiner-legacy-exceptions.md");
process.exit(1);
