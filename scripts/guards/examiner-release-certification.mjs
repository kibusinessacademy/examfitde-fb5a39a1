#!/usr/bin/env node
/**
 * Phase 8.9 — Examiner Release Certification Report.
 *
 * Sammelt Governance-, Golden- und Replay-Status zu einem
 * Production-Certification-Report. Failt CI, wenn ein Pflichtblock
 * nicht grün ist. Schreibt einen Markdown-Report nach
 * docs/runbooks/examiner-release-certification.md.
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const STEPS = [
  { id: "copy_governance", label: "Copy Governance", cmd: "node scripts/guards/examiner-copy-governance.mjs" },
  { id: "legacy_logic", label: "Legacy Logic Scanner", cmd: "node scripts/guards/examiner-legacy-logic.mjs" },
  { id: "golden_tests", label: "Examiner Golden Suite", cmd: "bunx vitest run src/__tests__/examiner-*.golden.test.ts --reporter=basic" },
];

const results = [];
let failed = 0;
for (const step of STEPS) {
  process.stdout.write(`▶ ${step.label}\n`);
  try {
    const out = execSync(step.cmd, { stdio: "pipe", encoding: "utf8" });
    results.push({ ...step, ok: true, output: out.slice(-500) });
    process.stdout.write(`✅ ${step.label}\n`);
  } catch (err) {
    const out = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
    results.push({ ...step, ok: false, output: out.slice(-800) });
    process.stderr.write(`❌ ${step.label}\n`);
    failed += 1;
  }
}

const reportPath = "docs/runbooks/examiner-release-certification.md";
mkdirSync(dirname(reportPath), { recursive: true });
const ts = new Date().toISOString();
const lines = [
  "# Examiner Release Certification",
  "",
  `_Generiert: ${ts}_`,
  "",
  "## Pflichtblöcke",
  "",
  "| Status | Block |",
  "| --- | --- |",
  ...results.map((r) => `| ${r.ok ? "✅" : "❌"} | ${r.label} |`),
  "",
  `## Gesamtergebnis: **${failed === 0 ? "PASS — Release-bereit" : `FAIL — ${failed} Block(e) rot`}**`,
  "",
  "## Eingefrorene Verträge",
  "",
  "- `src/lib/examiner/ExaminerContracts.ts` (Version 1.0.0)",
  "- Verdict-Schema, Confidence-Schema, Evidence-Severity, Timeline-Events",
  "",
  "## Logs",
  "",
  ...results.map((r) => ["", `### ${r.label}`, "```", r.output.trim() || "(no output)", "```"].join("\n")),
];
writeFileSync(reportPath, lines.join("\n"));
process.stdout.write(`\n📄 Report: ${reportPath}\n`);
process.exit(failed === 0 ? 0 : 1);
