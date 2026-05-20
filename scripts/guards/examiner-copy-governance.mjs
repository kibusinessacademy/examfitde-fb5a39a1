#!/usr/bin/env node
/**
 * Phase 7.1 — Examiner Copy & Token Governance (static guard).
 *
 * Scannt Examiner-Surfaces auf verbotene Gamification-/LMS-/Quiz-Sprache.
 * Wird in CI vor jedem Merge ausgeführt. Skip-Markierung über
 * `// examiner-copy-allow: <token>` direkt über der Zeile.
 *
 * SSOT für Tokens: src/lib/system/ExaminerLexicon.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = [
  "src/pages/app",
  "src/components/system",
  "src/lib/system",
];
const EXTRA_FILES = [
  "src/pages/quiz/QuizResultPage.tsx",
];

// Mirror der SSOT in ExaminerLexicon.ts (CI darf nicht TS importieren).
const FORBIDDEN = [
  "Quiz",
  "Kursfortschritt",
  "Kapitel",
  "Punktejagd",
  "XP",
  "Levelup",
  "Level up",
  "Gamification",
  "Aufgabenliste",
  "To-do",
  "Todo",
  "Streak",
  "High Score",
  "Highscore",
];

// Wortgrenzen, damit "Quiz" nicht in Identifiern wie "quizBundleMap" oder
// in importierten Routes wie "/pruefungsfragen-quiz" anschlägt.
const PATTERNS = FORBIDDEN.map((t) => ({
  token: t,
  re: new RegExp(`(^|[^A-Za-z0-9_-])${escape(t)}(?=[^A-Za-z0-9_-]|$)`, "g"),
}));

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(p);
  }
  return out;
}

const files = [];
for (const d of TARGET_DIRS) {
  try { files.push(...walk(join(ROOT, d))); } catch {}
}
for (const f of EXTRA_FILES) {
  try { statSync(join(ROOT, f)); files.push(join(ROOT, f)); } catch {}
}

const violations = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  // SSOT-Datei selbst & Governance-Guard selbst dürfen die Tokens listen.
  if (rel.endsWith("ExaminerLexicon.ts")) continue;
  if (rel.endsWith("examiner-copy-governance.mjs")) continue;

  const src = readFileSync(file, "utf8");
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // skip comments
    const above = lines[i - 1] ?? "";
    for (const { token, re } of PATTERNS) {
      re.lastIndex = 0;
      if (re.test(line)) {
        if (above.includes(`examiner-copy-allow: ${token}`)) continue;
        violations.push({ file: rel, line: i + 1, token, snippet: line.trim().slice(0, 140) });
      }
    }
  }
}

if (violations.length) {
  console.error(`\n✗ Examiner Copy Governance — ${violations.length} Verstoß/Verstöße:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  →  forbidden token "${v.token}"\n    ${v.snippet}`);
  }
  console.error(`\nSSOT: src/lib/system/ExaminerLexicon.ts`);
  console.error(`Bypass (begründet): "// examiner-copy-allow: <token>" über der Zeile.`);
  process.exit(1);
}

console.log(`✓ Examiner Copy Governance — ${files.length} Dateien geprüft, 0 Verstöße.`);
