#!/usr/bin/env node
/**
 * Customer-Reality Triage Loop (P0-C).
 *
 * Konsumiert Outputs der beiden Daily-QA Aggregatoren
 * (learner-reality-results.json, pre-customer-reality-results.json + findings/)
 * und produziert:
 *
 *  - reality-results/triage.json            — strukturierte Fix-Queue + Trend
 *  - reality-results/triage-report.md       — Render im GitHub Step-Summary
 *  - reality-results/github-issues/*.json   — pro P0 ein Issue-Stub (Workflow opent)
 *  - reality-baselines/last.json (neu)      — Snapshot nur wenn beide RELEASE
 *
 * Reihenfolge täglich:
 *   1) learner-reality-daily             → results.json + findings/
 *   2) pre-customer-reality-daily        → results.json + findings/
 *   3) customer-reality-triage (dieses)  → triage.json + issues + baseline
 *
 * Kein neues Feature, keine neue Architektur — nur Reality→Finding→Fix-Queue→Regression.
 *
 * Exit-Codes: 0 RELEASE · 1 REVIEW · 2 BLOCK
 */
import fs from 'node:fs';
import path from 'node:path';
import { classifyFinding } from './_lib/reality-owner-map.mjs';

const ROOT = process.cwd();
const RESULTS_DIR = path.resolve(ROOT, 'reality-results');
const FIND_DIR    = path.join(RESULTS_DIR, 'findings');
const ISSUES_DIR  = path.join(RESULTS_DIR, 'github-issues');
const BASELINE_DIR = path.resolve(ROOT, 'reality-baselines');
const BASELINE_FILE = path.join(BASELINE_DIR, 'last.json');

const LEARNER_FILE = path.join(RESULTS_DIR, 'learner-reality-results.json');
const PRE_FILE     = path.join(RESULTS_DIR, 'pre-customer-reality-results.json');

fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.mkdirSync(ISSUES_DIR, { recursive: true });
fs.mkdirSync(BASELINE_DIR, { recursive: true });

function readJsonSafe(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function readDirJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJsonSafe(path.join(dir, f)))
    .filter(Boolean);
}

const learner = readJsonSafe(LEARNER_FILE);
const pre     = readJsonSafe(PRE_FILE);
const rawFindings = readDirJson(FIND_DIR);

// ── Fingerprint = stabile Dedupe-ID je Finding ────────────────────────────────
function fingerprint(f) {
  const key = `${f.severity}|${f.kind}|${f.journey}|${f.route || ''}|${(f.detail || '').slice(0, 120)}`;
  // simple hash
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return `${f.severity}-${f.kind}-${Math.abs(h).toString(36)}`;
}

// ── Anreichern: owner, surface, fix-hint, fingerprint ─────────────────────────
const enriched = rawFindings.map((f) => {
  const cls = classifyFinding(f);
  return { fingerprint: fingerprint(f), ...f, ...cls };
});

// Dedupe (gleicher Fingerprint mehrfach → 1 Eintrag + occurrences)
const byFp = new Map();
for (const f of enriched) {
  const prev = byFp.get(f.fingerprint);
  if (!prev) byFp.set(f.fingerprint, { ...f, occurrences: 1 });
  else prev.occurrences += 1;
}
const triaged = [...byFp.values()].sort((a, b) => {
  const order = { P0: 0, P1: 1, P2: 2 };
  return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
});

const p0 = triaged.filter((f) => f.severity === 'P0');
const p1 = triaged.filter((f) => f.severity === 'P1');
const p2 = triaged.filter((f) => f.severity === 'P2');

// ── Gesamt-Status: schlechtester der beiden Runs ──────────────────────────────
const statusRank = { RELEASE: 0, REVIEW: 1, BLOCK: 2 };
const candidates = [learner?.status, pre?.status].filter(Boolean);
const overall = candidates.length
  ? candidates.reduce((acc, s) => (statusRank[s] > statusRank[acc] ? s : acc), 'RELEASE')
  : 'REVIEW';

// ── Trend vs. letzter Baseline ────────────────────────────────────────────────
const baseline = readJsonSafe(BASELINE_FILE);
const baselineFps = new Set((baseline?.findings || []).map((f) => f.fingerprint));
const newFindings = triaged.filter((f) => !baselineFps.has(f.fingerprint));
const currentFps = new Set(triaged.map((f) => f.fingerprint));
const resolvedFindings = (baseline?.findings || []).filter((f) => !currentFps.has(f.fingerprint));

const trend = {
  baseline_ts: baseline?.ts ?? null,
  baseline_status: baseline?.overall ?? null,
  baseline_finding_count: baseline?.findings?.length ?? 0,
  current_finding_count: triaged.length,
  delta: triaged.length - (baseline?.findings?.length ?? 0),
  new_count: newFindings.length,
  resolved_count: resolvedFindings.length,
  new_p0: newFindings.filter((f) => f.severity === 'P0').length,
};

// ── Issue-Stubs für P0 (workflow opent sie) ───────────────────────────────────
for (const f of p0) {
  const title = `[Reality P0] ${f.kind} on ${f.route || f.journey || 'global'}`;
  const body = [
    `**Severity:** P0  ·  **Owner:** \`${f.owner}\`  ·  **Surface:** ${f.surface}`,
    `**Journey:** ${f.journey}  ·  **Route:** \`${f.route || '(n/a)'}\``,
    '',
    `**Detail:** ${f.detail}`,
    '',
    `**Fix-Hint:** ${f.fix_hint}`,
    '',
    `Fingerprint: \`${f.fingerprint}\`  ·  Occurrences this run: ${f.occurrences}`,
    `Auto-generated by customer-reality-triage. Closing rule: nächster Daily-Run ohne diesen Fingerprint.`,
  ].join('\n');
  fs.writeFileSync(
    path.join(ISSUES_DIR, `${f.fingerprint}.json`),
    JSON.stringify({
      title,
      body,
      labels: ['reality', 'p0', `owner:${f.owner}`, `surface:${f.surface}`.toLowerCase().replace(/\s+/g, '-')],
      fingerprint: f.fingerprint,
    }, null, 2),
  );
}

// ── Triage-JSON ───────────────────────────────────────────────────────────────
const triage = {
  ts: new Date().toISOString(),
  overall,
  runs: {
    learner: learner ? {
      status: learner.status,
      score: learner.score,
      max_score: learner.max_score,
    } : null,
    pre_customer: pre ? {
      status: pre.status,
      score: pre.score,
      max_score: pre.max_score,
      time_to_course_ms: pre.time_to_course_ms,
      time_to_course_ok: pre.time_to_course_ok,
    } : null,
  },
  counts: { p0: p0.length, p1: p1.length, p2: p2.length, total: triaged.length },
  trend,
  findings: triaged,
  new_findings: newFindings.map((f) => f.fingerprint),
  resolved_findings: resolvedFindings.map((f) => f.fingerprint),
};
fs.writeFileSync(path.join(RESULTS_DIR, 'triage.json'), JSON.stringify(triage, null, 2));

// ── Markdown-Report (Step-Summary) ────────────────────────────────────────────
const trendArrow = trend.delta === 0 ? '➖' : trend.delta < 0 ? '⬇️' : '⬆️';
const fmtFinding = (f) => `- **${f.severity}** · \`${f.owner}\` · ${f.kind} · \`${f.route || f.journey}\`\n  - ${f.detail}\n  - _Fix:_ ${f.fix_hint}\n  - \`fp=${f.fingerprint}\` ×${f.occurrences}`;

const md = `# Customer-Reality Triage — ${triage.ts.slice(0, 10)}

**Overall:** **${overall}**

| Run | Status | Score |
|---|---|---|
| learner-reality | ${learner?.status ?? 'missing'} | ${learner?.score ?? '–'} / ${learner?.max_score ?? '–'} |
| pre-customer-reality | ${pre?.status ?? 'missing'} | ${pre?.score ?? '–'} / ${pre?.max_score ?? '–'} ${pre?.time_to_course_ms != null ? `(TTC ${(pre.time_to_course_ms/1000).toFixed(1)}s)` : ''} |

## Trend vs. Baseline (${trend.baseline_ts?.slice(0, 10) ?? 'none'})
${trendArrow} Findings ${trend.baseline_finding_count} → ${trend.current_finding_count} (Δ ${trend.delta >= 0 ? '+' : ''}${trend.delta})
🆕 new: ${trend.new_count} (P0 new: ${trend.new_p0})  ·  ✅ resolved: ${trend.resolved_count}

## Fix-Queue
**Counts:** P0=${p0.length} · P1=${p1.length} · P2=${p2.length}

### P0 — sofort (Issues werden automatisch geöffnet)
${p0.length ? p0.map(fmtFinding).join('\n') : '_keine_'}

### P1 — wöchentlich clustern
${p1.length ? p1.slice(0, 20).map(fmtFinding).join('\n') : '_keine_'}

### P2 — UX-Friction Backlog
${p2.length ? p2.slice(0, 10).map(fmtFinding).join('\n') : '_keine_'}

---
_Triage-Regel: BLOCK→P0 sofort · REVIEW→sammeln · RELEASE→Baseline-Snapshot._
_Generated by scripts/customer-reality-triage.mjs._
`;
fs.writeFileSync(path.join(RESULTS_DIR, 'triage-report.md'), md);

// ── Baseline-Snapshot nur bei RELEASE (beider Runs) ──────────────────────────
if (overall === 'RELEASE') {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify({
    ts: triage.ts,
    overall,
    runs: triage.runs,
    findings: triaged.map((f) => ({ fingerprint: f.fingerprint, severity: f.severity, kind: f.kind, route: f.route })),
  }, null, 2));
  console.log(`✅ Baseline aktualisiert: ${BASELINE_FILE}`);
}

console.log(`\n=== Customer-Reality Triage — ${overall} ===`);
console.log(`P0=${p0.length} P1=${p1.length} P2=${p2.length}  Δ=${trend.delta}  new=${trend.new_count}  resolved=${trend.resolved_count}`);
console.log(`Issues queued: ${p0.length}  ·  Report: reality-results/triage-report.md`);

process.exit(overall === 'RELEASE' ? 0 : overall === 'REVIEW' ? 1 : 2);
