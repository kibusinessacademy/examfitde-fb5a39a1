#!/usr/bin/env node
/**
 * Customer-Reality Triage Loop (P0-C / erweitert für P0-D+).
 *
 * Produziert:
 *  - reality-results/triage.json            — strukturierte Fix-Queue + Trend
 *  - reality-results/triage-report.md       — Step-Summary
 *  - reality-results/github-issues/*.json   — pro P0 Issue-Stub (mit ETA + Klassifizierung)
 *  - reality-baselines/last.json            — Snapshot bei RELEASE
 *  - public/reality/latest.json + history.json — Dashboard-Feed
 *
 * NEU in diesem Cut:
 *  - Pro Finding `classification` ∈ {NEW, REGRESSION_7D, REGRESSION_30D, RECURRING}
 *  - Pro Finding `delta_reason` (Klartext, warum es als Delta/Regression gilt)
 *  - Pro Finding `first_seen_prior` / `last_seen_prior` / `gap_snapshots`
 *  - Pro Finding `priority` (= severity) + `eta_hours` (P0 24h · P1 168h · P2 720h)
 *  - Issue-Body enthält ETA, Klassifizierung, Vergleichsfenster und CTA/Route
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

const ETA_HOURS = { P0: 24, P1: 168, P2: 720 };

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
function fmtShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

const learner = readJsonSafe(LEARNER_FILE);
const pre     = readJsonSafe(PRE_FILE);
const rawFindings = readDirJson(FIND_DIR);

// ── Fingerprint = stabile Dedupe-ID je Finding ────────────────────────────────
function fingerprint(f) {
  const key = `${f.severity}|${f.kind}|${f.journey}|${f.route || ''}|${(f.detail || '').slice(0, 120)}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return `${f.severity}-${f.kind}-${Math.abs(h).toString(36)}`;
}

const enriched = rawFindings.map((f) => {
  const cls = classifyFinding(f);
  return { fingerprint: fingerprint(f), ...f, ...cls };
});

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

// ── Overall: schlechtester der beiden Runs ────────────────────────────────────
const statusRank = { RELEASE: 0, REVIEW: 1, BLOCK: 2 };
const candidates = [learner?.status, pre?.status].filter(Boolean);
const overall = candidates.length
  ? candidates.reduce((acc, s) => (statusRank[s] > statusRank[acc] ? s : acc), 'RELEASE')
  : 'REVIEW';

// ── History laden (für Klassifizierung + first/last_seen) ────────────────────
const PUBLIC_DIR = path.resolve(ROOT, 'public', 'reality');
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
const PUBLIC_HISTORY = path.join(PUBLIC_DIR, 'history.json');
const PUBLIC_LATEST  = path.join(PUBLIC_DIR, 'latest.json');
const prevHistory = readJsonSafe(PUBLIC_HISTORY, []) ?? [];

const currentTs = new Date().toISOString();

// Pro fp: alle vorherigen Snapshots, in denen er enthalten war (chronologisch)
function priorOccurrences(fp) {
  return prevHistory.filter((h) => (h.fingerprints || []).includes(fp));
}

function classifyDelta(fp) {
  const occ = priorOccurrences(fp);
  if (occ.length === 0) {
    return {
      classification: 'NEW',
      delta_reason: 'Neu in dieser Triage — kein vorheriger Snapshot enthielt diesen Fingerprint.',
      first_seen_prior: null,
      last_seen_prior: null,
      gap_snapshots: 0,
      comparison_window: 'baseline',
    };
  }
  const first = occ[0].ts;
  const last  = occ[occ.length - 1].ts;
  const lastIdx = prevHistory.findIndex((h) => h.ts === last);
  const gap = prevHistory.length - 1 - lastIdx; // Snapshots zwischen last_seen_prior und jetzt, in denen fp fehlte
  if (gap === 0) {
    return {
      classification: 'RECURRING',
      delta_reason: `Bereits im letzten Snapshot vorhanden (${fmtShort(last)}). Erstmals registriert: ${fmtShort(first)}.`,
      first_seen_prior: first,
      last_seen_prior: last,
      gap_snapshots: 0,
      comparison_window: 'last_snapshot',
    };
  }
  const ageMs = new Date(currentTs).getTime() - new Date(last).getTime();
  const ageHours = ageMs / 3_600_000;
  const ageDays = ageHours / 24;
  const win = ageDays <= 7 ? 'REGRESSION_7D' : 'REGRESSION_30D';
  const winLabel = ageDays <= 7 ? '7-Tage-Fenster' : '30-Tage-Fenster';
  return {
    classification: win,
    delta_reason: `Regression im ${winLabel}: zuletzt am ${fmtShort(last)} gesehen, dann ${gap} Snapshot(s) sauber, jetzt wieder aufgetaucht (Fenster ${ageDays.toFixed(1)} Tage).`,
    first_seen_prior: first,
    last_seen_prior: last,
    gap_snapshots: gap,
    comparison_window: win === 'REGRESSION_7D' ? 'last_7_days' : 'last_30_days',
  };
}

// Anreichern jeder Finding-Reihe
const triagedFull = triaged.map((f) => {
  const delta = classifyDelta(f.fingerprint);
  const first_seen = delta.first_seen_prior ?? currentTs;
  return {
    ...f,
    priority: f.severity,
    eta_hours: ETA_HOURS[f.severity] ?? 720,
    eta_due: new Date(Date.now() + (ETA_HOURS[f.severity] ?? 720) * 3_600_000).toISOString(),
    first_seen,
    last_seen: currentTs,
    ...delta,
  };
});

// ── Trend vs. letzter Baseline ────────────────────────────────────────────────
const baseline = readJsonSafe(BASELINE_FILE);
const baselineFps = new Set((baseline?.findings || []).map((f) => f.fingerprint));
const newFindings = triagedFull.filter((f) => !baselineFps.has(f.fingerprint));
const currentFps = new Set(triagedFull.map((f) => f.fingerprint));
const resolvedFindings = (baseline?.findings || []).filter((f) => !currentFps.has(f.fingerprint));

const trend = {
  baseline_ts: baseline?.ts ?? null,
  baseline_status: baseline?.overall ?? null,
  baseline_finding_count: baseline?.findings?.length ?? 0,
  current_finding_count: triagedFull.length,
  delta: triagedFull.length - (baseline?.findings?.length ?? 0),
  new_count: newFindings.length,
  resolved_count: resolvedFindings.length,
  new_p0: newFindings.filter((f) => f.severity === 'P0').length,
  regressions_7d: triagedFull.filter((f) => f.classification === 'REGRESSION_7D').length,
  regressions_30d: triagedFull.filter((f) => f.classification === 'REGRESSION_30D').length,
};

// ── Issue-Stubs (P0 immer, Regressions zusätzlich) ────────────────────────────
const issueCandidates = triagedFull.filter((f) =>
  f.severity === 'P0' || f.classification === 'REGRESSION_7D' || f.classification === 'REGRESSION_30D',
);
for (const f of issueCandidates) {
  const isReg = f.classification.startsWith('REGRESSION');
  const titlePrefix = isReg ? `[Reality ${f.severity} · Regression]` : `[Reality P0]`;
  const title = `${titlePrefix} ${f.kind} on ${f.route || f.journey || 'global'}`;
  const body = [
    `**Severity / Priority:** ${f.severity}  ·  **ETA:** ${f.eta_hours}h (due ${f.eta_due.slice(0, 16).replace('T', ' ')} UTC)`,
    `**Owner:** \`${f.owner}\`  ·  **Surface:** ${f.surface}`,
    `**Journey:** ${f.journey}  ·  **Route / CTA:** \`${f.route || '(n/a)'}\``,
    '',
    `**Classification:** \`${f.classification}\` (Vergleichsfenster: \`${f.comparison_window}\`)`,
    `**Delta-Begründung:** ${f.delta_reason}`,
    `**first_seen:** ${fmtShort(f.first_seen)}  ·  **last_seen (prior):** ${fmtShort(f.last_seen_prior)}  ·  **gap:** ${f.gap_snapshots} Snapshot(s)`,
    '',
    `**Detail:** ${f.detail}`,
    '',
    `**Fix-Hint:** ${f.fix_hint}`,
    '',
    `Fingerprint: \`${f.fingerprint}\`  ·  Occurrences this run: ${f.occurrences}`,
    `Auto-generated by customer-reality-triage. Closing rule: nächster Daily-Run ohne diesen Fingerprint.`,
  ].join('\n');
  const labels = ['reality', f.severity.toLowerCase(), `owner:${f.owner}`, `surface:${f.surface}`.toLowerCase().replace(/\s+/g, '-'), `eta:${f.eta_hours}h`];
  if (isReg) labels.push('regression', f.classification.toLowerCase());
  fs.writeFileSync(
    path.join(ISSUES_DIR, `${f.fingerprint}.json`),
    JSON.stringify({ title, body, labels, fingerprint: f.fingerprint, severity: f.severity, classification: f.classification }, null, 2),
  );
}

// ── Triage-JSON ───────────────────────────────────────────────────────────────
const triage = {
  ts: currentTs,
  overall,
  runs: {
    learner: learner ? { status: learner.status, score: learner.score, max_score: learner.max_score } : null,
    pre_customer: pre ? {
      status: pre.status, score: pre.score, max_score: pre.max_score,
      time_to_course_ms: pre.time_to_course_ms, time_to_course_ok: pre.time_to_course_ok,
    } : null,
  },
  counts: { p0: p0.length, p1: p1.length, p2: p2.length, total: triagedFull.length },
  trend,
  findings: triagedFull,
  new_findings: newFindings.map((f) => f.fingerprint),
  resolved_findings: resolvedFindings.map((f) => f.fingerprint),
};
fs.writeFileSync(path.join(RESULTS_DIR, 'triage.json'), JSON.stringify(triage, null, 2));

// ── Markdown-Report (Step-Summary) ────────────────────────────────────────────
const trendArrow = trend.delta === 0 ? '➖' : trend.delta < 0 ? '⬇️' : '⬆️';
const classBadge = (c) => ({ NEW: '🆕', RECURRING: '♻️', REGRESSION_7D: '⚠️7d', REGRESSION_30D: '⚠️30d' }[c] || c);
const fmtFinding = (f) => `- **${f.severity}** ${classBadge(f.classification)} · \`${f.owner}\` · ${f.kind} · \`${f.route || f.journey}\` · ETA ${f.eta_hours}h
  - ${f.detail}
  - _Δ-Reason:_ ${f.delta_reason}
  - _Fix:_ ${f.fix_hint}
  - \`fp=${f.fingerprint}\` ×${f.occurrences}`;

const md = `# Customer-Reality Triage — ${triage.ts.slice(0, 10)}

**Overall:** **${overall}**

| Run | Status | Score |
|---|---|---|
| learner-reality | ${learner?.status ?? 'missing'} | ${learner?.score ?? '–'} / ${learner?.max_score ?? '–'} |
| pre-customer-reality | ${pre?.status ?? 'missing'} | ${pre?.score ?? '–'} / ${pre?.max_score ?? '–'} ${pre?.time_to_course_ms != null ? `(TTC ${(pre.time_to_course_ms/1000).toFixed(1)}s)` : ''} |

## Trend vs. Baseline (${trend.baseline_ts?.slice(0, 10) ?? 'none'})
${trendArrow} Findings ${trend.baseline_finding_count} → ${trend.current_finding_count} (Δ ${trend.delta >= 0 ? '+' : ''}${trend.delta})
🆕 new: ${trend.new_count} (P0 new: ${trend.new_p0})  ·  ✅ resolved: ${trend.resolved_count}  ·  ⚠️ regressions 7d: ${trend.regressions_7d} · 30d: ${trend.regressions_30d}

## Fix-Queue
**Counts:** P0=${p0.length} · P1=${p1.length} · P2=${p2.length}

### P0 — sofort (Issues werden automatisch geöffnet, ETA 24h)
${p0.length ? p0.map(fmtFinding).join('\n') : '_keine_'}

### P1 — wöchentlich clustern (ETA 7d)
${p1.length ? p1.slice(0, 20).map(fmtFinding).join('\n') : '_keine_'}

### P2 — UX-Friction Backlog (ETA 30d)
${p2.length ? p2.slice(0, 10).map(fmtFinding).join('\n') : '_keine_'}

---
_Triage-Regel: BLOCK→P0 sofort · REVIEW→sammeln · RELEASE→Baseline-Snapshot · Regression→Issue auch unterhalb P0._
_Generated by scripts/customer-reality-triage.mjs._
`;
fs.writeFileSync(path.join(RESULTS_DIR, 'triage-report.md'), md);

// ── Baseline-Snapshot nur bei RELEASE ────────────────────────────────────────
if (overall === 'RELEASE') {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify({
    ts: triage.ts,
    overall,
    runs: triage.runs,
    findings: triagedFull.map((f) => ({ fingerprint: f.fingerprint, severity: f.severity, kind: f.kind, route: f.route })),
  }, null, 2));
  console.log(`✅ Baseline aktualisiert: ${BASELINE_FILE}`);
}

// ── public/reality (Dashboard-Feed) ──────────────────────────────────────────
const justResolved = (() => {
  const prevLast = prevHistory[prevHistory.length - 1];
  const prevFps = new Set(prevLast?.fingerprints || []);
  const cur = new Set(triagedFull.map((f) => f.fingerprint));
  return [...prevFps].filter((fp) => !cur.has(fp));
})();

// TTR (resolved seit letztem Snapshot)
const ttrSamples = [];
for (const fp of justResolved) {
  const occ = priorOccurrences(fp);
  if (occ[0]?.ts) {
    ttrSamples.push(new Date(triage.ts).getTime() - new Date(occ[0].ts).getTime());
  }
}
const avgTtrHours = ttrSamples.length
  ? ttrSamples.reduce((a, b) => a + b, 0) / ttrSamples.length / 3_600_000
  : null;

const historyEntry = {
  ts: triage.ts,
  overall,
  counts: triage.counts,
  fingerprints: triagedFull.map((f) => f.fingerprint),
  new_fps: newFindings.map((f) => f.fingerprint),
  resolved_fps: justResolved,
  runs: triage.runs,
};
const nextHistory = [...prevHistory, historyEntry].slice(-60);
fs.writeFileSync(PUBLIC_HISTORY, JSON.stringify(nextHistory, null, 2));

// Top 10 root causes
const causeMap = new Map();
for (const f of triagedFull) {
  const key = `${f.owner}::${f.kind}`;
  const c = causeMap.get(key) || { owner: f.owner, kind: f.kind, count: 0, severity: f.severity };
  c.count += 1;
  causeMap.set(key, c);
}
const topCauses = [...causeMap.values()].sort((a, b) => b.count - a.count).slice(0, 10);

const publicLatest = {
  ts: triage.ts,
  overall,
  runs: triage.runs,
  counts: triage.counts,
  trend,
  ttr_hours_avg: avgTtrHours,
  ttr_samples: ttrSamples.length,
  top_causes: topCauses,
  findings: triagedFull,
  resolved_since_last: justResolved,
  history_entries: nextHistory.length,
};
fs.writeFileSync(PUBLIC_LATEST, JSON.stringify(publicLatest, null, 2));
console.log(`📊 P0-D Dashboard data: ${PUBLIC_LATEST} (history ${nextHistory.length})`);

console.log(`\n=== Customer-Reality Triage — ${overall} ===`);
console.log(`P0=${p0.length} P1=${p1.length} P2=${p2.length}  Δ=${trend.delta}  new=${trend.new_count}  resolved=${trend.resolved_count}  reg7d=${trend.regressions_7d} reg30d=${trend.regressions_30d}`);
console.log(`Issues queued: ${issueCandidates.length} (P0 + Regressions)  ·  Report: reality-results/triage-report.md`);

process.exit(overall === 'RELEASE' ? 0 : overall === 'REVIEW' ? 1 : 2);
