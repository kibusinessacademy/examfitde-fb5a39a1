#!/usr/bin/env node
/**
 * Architecture Invariants Guard — Phase A (lint-hint, non-blocking)
 *
 * Implements DUPLICATION.GUARD signal for new:
 *   - Routes              (src/pages/**, src/App.tsx route additions)
 *   - DB tables           (CREATE TABLE in supabase/migrations/**)
 *   - Edge functions      (new dir under supabase/functions/)
 *   - Registries          (files named *registry*.ts in src/)
 *
 * Phase A behavior:
 *   - Detect additions in PR diff (against origin/main).
 *   - Require justification: PR body OR latest commit message must contain
 *     either FEATURE_JUSTIFICATION:<one of 5 criteria> or INVARIANT_OVERRIDE:<rule>.
 *   - Exit 0 always (lint-hint). Writes findings to GITHUB_STEP_SUMMARY.
 *   - Set GUARD_STRICT=1 to fail on missing justification (Phase B).
 *
 * 5 criteria (FEATURE_JUSTIFICATION_REQUIRED):
 *   EXTENDS_CAPABILITY | CLOSES_GAP | CONNECTS_MODULES | INCREASES_AUTOMATION | IMPROVES_FLOW
 */

import { execSync } from "node:child_process";
import { existsSync, appendFileSync } from "node:fs";

const STRICT = process.env.GUARD_STRICT === "1";
const BASE = process.env.GITHUB_BASE_REF || "main";
const PR_BODY = process.env.PR_BODY || "";

const VALID_CRITERIA = [
  "EXTENDS_CAPABILITY",
  "CLOSES_GAP",
  "CONNECTS_MODULES",
  "INCREASES_AUTOMATION",
  "IMPROVES_FLOW",
];

function sh(cmd) {
  try { return execSync(cmd, { encoding: "utf8" }); } catch { return ""; }
}

// Best-effort diff against base branch
sh(`git fetch origin ${BASE} --depth=50 2>/dev/null || true`);
const diffRange = sh(`git rev-parse origin/${BASE} 2>/dev/null`).trim()
  ? `origin/${BASE}...HEAD`
  : "HEAD~1..HEAD";

const addedFiles = sh(`git diff --name-only --diff-filter=A ${diffRange}`)
  .split("\n").map(s => s.trim()).filter(Boolean);
const changedFiles = sh(`git diff --name-only ${diffRange}`)
  .split("\n").map(s => s.trim()).filter(Boolean);

const findings = [];

// 1. New routes — page additions
const newPages = addedFiles.filter(f => /^src\/pages\/.*\.(tsx|jsx)$/.test(f));
newPages.forEach(f => findings.push({ rule: "DUPLICATION.GUARD", kind: "new_route", file: f }));

// 2. New tables — CREATE TABLE in any changed migration
for (const f of changedFiles.filter(f => /^supabase\/migrations\/.*\.sql$/.test(f))) {
  if (!existsSync(f)) continue;
  const sql = sh(`git show ${diffRange.split("...").pop() || "HEAD"}:${f} 2>/dev/null`)
    || sh(`cat ${f}`);
  const matches = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/gi)];
  matches.forEach(m => findings.push({
    rule: "DUPLICATION.GUARD", kind: "new_table", file: f, detail: m[1],
  }));
}

// 3. New edge functions — new index.ts under supabase/functions/<name>/
const newEdge = addedFiles.filter(f => /^supabase\/functions\/[^_/][^/]+\/index\.ts$/.test(f));
newEdge.forEach(f => findings.push({
  rule: "DUPLICATION.GUARD", kind: "new_edge_function",
  file: f, detail: f.split("/")[2],
}));

// 4. New registries
const newRegistry = addedFiles.filter(f => /registry.*\.(ts|tsx)$/i.test(f) && f.startsWith("src/"));
newRegistry.forEach(f => findings.push({ rule: "DUPLICATION.GUARD", kind: "new_registry", file: f }));

// Justification check
const haystack = `${PR_BODY}\n${sh("git log -1 --pretty=%B")}`;
const justRe = /FEATURE_JUSTIFICATION:\s*([A-Z_]+)/g;
const overrideRe = /INVARIANT_OVERRIDE:\s*([A-Z._]+)/g;
const justified = [...haystack.matchAll(justRe)]
  .map(m => m[1]).filter(c => VALID_CRITERIA.includes(c));
const overridden = [...haystack.matchAll(overrideRe)].map(m => m[1]);
const hasJustification = justified.length > 0 || overridden.length > 0;

// Output
const summary = process.env.GITHUB_STEP_SUMMARY;
const lines = [];
lines.push("## 🏛️ Architecture Invariants Guard — Phase A\n");

if (findings.length === 0) {
  lines.push("✅ No new routes / tables / edge functions / registries detected. No action required.\n");
} else {
  lines.push(`Detected **${findings.length}** new architectural surface(s):\n`);
  lines.push("| Rule | Kind | Detail | File |");
  lines.push("| --- | --- | --- | --- |");
  for (const f of findings) {
    lines.push(`| ${f.rule} | ${f.kind} | ${f.detail || "—"} | \`${f.file}\` |`);
  }
  lines.push("");
  lines.push("### Required");
  lines.push("Each new surface MUST satisfy at least one criterion from `FEATURE_JUSTIFICATION_REQUIRED`:");
  lines.push("- `EXTENDS_CAPABILITY` · `CLOSES_GAP` · `CONNECTS_MODULES` · `INCREASES_AUTOMATION` · `IMPROVES_FLOW`");
  lines.push("");
  lines.push("Add to PR body or commit message:");
  lines.push("```\nFEATURE_JUSTIFICATION: CLOSES_GAP\nreason: <one sentence>\n```");
  lines.push("Or, if knowingly violating an invariant:");
  lines.push("```\nINVARIANT_OVERRIDE: DUPLICATION.GUARD\nreason: <why an exception is required>\n```");
  lines.push("");
  if (hasJustification) {
    lines.push(`✅ Justification found: ${[...justified, ...overridden].join(", ")}`);
  } else {
    lines.push("⚠️ **No `FEATURE_JUSTIFICATION:` or `INVARIANT_OVERRIDE:` found in PR body / last commit.**");
    lines.push("Phase A = warning. Phase B (`GUARD_STRICT=1`) will block.");
  }
}

const out = lines.join("\n") + "\n";
console.log(out);
if (summary) appendFileSync(summary, out);

if (STRICT && findings.length > 0 && !hasJustification) {
  console.error("::error::Architecture Invariants Guard (strict): missing FEATURE_JUSTIFICATION or INVARIANT_OVERRIDE.");
  process.exit(1);
}
process.exit(0);
