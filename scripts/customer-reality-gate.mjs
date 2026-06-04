#!/usr/bin/env node
/**
 * Customer Reality Gate — 12-Journey Release Gate.
 *
 * Brücke (NICHT Fork) über die existierenden Aggregatoren:
 *   - scripts/pre-customer-reality-aggregate.mjs   (P01..P12)
 *   - scripts/learner-reality-aggregate.mjs        (J01..J10)
 *
 * Mapped die 12 kanonischen Customer Journeys aus der Funnel-Doktrin
 * (Homepage → Beruf finden → Beruf öffnen → Preise → CTA → Registrierung →
 * Login → Onboarding → MiniCheck → AI Tutor → Prüfungssimulation → Rückkehr)
 * auf die jeweils bestehenden Pass-Files in reality-results/.
 *
 * Release-Regel:
 *   - PASS >= 10 / 12 → RELEASE (exit 0)
 *   - PASS  = 8..9    → REVIEW  (exit 1)
 *   - PASS <  8       → BLOCK   (exit 2)
 *
 * Out:
 *   reality-results/customer-reality-gate.json
 *   reality-results/customer-reality-gate.md
 */
import fs from 'node:fs';
import path from 'node:path';

const RESULTS_DIR = path.resolve(process.cwd(), 'reality-results');
const PASS_DIR = path.join(RESULTS_DIR, 'journey-pass');
const LOGIN_FLAG = path.join(RESULTS_DIR, 'learner-login-success.flag');

// 12 kanonische Journeys → existierende Pass-File-IDs.
// Quelle pro Eintrag macht klar, welcher Aggregator das Signal produziert.
const JOURNEYS = [
  { key: 'homepage',          label: 'Homepage',           source: 'pre',     id: 'P01_homepage' },
  { key: 'find_beruf',        label: 'Beruf finden',       source: 'pre',     id: 'P02_find_beruf' },
  { key: 'open_course',       label: 'Beruf öffnen',       source: 'pre',     id: 'P03_open_course' },
  { key: 'pricing',           label: 'Preise',             source: 'pre',     id: 'P04_pricing' },
  { key: 'cta_click',         label: 'CTA',                source: 'pre',     id: 'P05_cta_click' },
  { key: 'registration',      label: 'Registrierung',      source: 'learner', id: 'J02_account' },
  { key: 'login',             label: 'Login',              source: 'flag',    id: LOGIN_FLAG },
  { key: 'onboarding',        label: 'Onboarding',         source: 'learner', id: 'J04_onboarding' },
  { key: 'minicheck',         label: 'MiniCheck',          source: 'learner', id: 'J06_minicheck' },
  { key: 'ai_tutor',          label: 'AI Tutor',           source: 'learner', id: 'J07_ai_tutor' },
  { key: 'written_exam',      label: 'Prüfungssimulation', source: 'learner', id: 'J08_written_exam' },
  { key: 'return',            label: 'Rückkehr',           source: 'learner', id: 'J10_return' },
];

function readPass(id) {
  const f = path.join(PASS_DIR, `${id}.json`);
  if (!fs.existsSync(f)) return { status: 'missing', detail: 'no result file' };
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { status: j.status || 'missing', detail: j.detail || '' };
  } catch {
    return { status: 'missing', detail: 'unreadable' };
  }
}

function readFlag(p) {
  return fs.existsSync(p)
    ? { status: 'pass', detail: 'login flag present' }
    : { status: 'fail', detail: 'login flag missing' };
}

const rows = JOURNEYS.map((j) => {
  const r = j.source === 'flag' ? readFlag(j.id) : readPass(j.id);
  return { ...j, status: r.status, detail: r.detail };
});

const passCount = rows.filter((r) => r.status === 'pass').length;
const total = rows.length;

let verdict, exitCode;
if (passCount >= 10) { verdict = 'RELEASE'; exitCode = 0; }
else if (passCount >= 8) { verdict = 'REVIEW';  exitCode = 1; }
else { verdict = 'BLOCK'; exitCode = 2; }

const out = {
  generated_at: new Date().toISOString(),
  verdict,
  pass: passCount,
  total,
  rule: 'PASS>=10/12 → RELEASE · 8..9 → REVIEW · <8 → BLOCK',
  journeys: rows,
};

fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.writeFileSync(path.join(RESULTS_DIR, 'customer-reality-gate.json'), JSON.stringify(out, null, 2));

const md = [
  `# Customer Reality Gate — ${verdict}`,
  ``,
  `**Score:** ${passCount} / ${total}  ·  **Rule:** ${out.rule}`,
  ``,
  `| # | Journey | Source | Status | Detail |`,
  `|---|---------|--------|--------|--------|`,
  ...rows.map((r, i) => `| ${i + 1} | ${r.label} | ${r.source} | ${r.status === 'pass' ? '✅ pass' : r.status === 'fail' ? '❌ fail' : '⚠️ missing'} | ${r.detail || ''} |`),
  ``,
  `_Bridge over learner-reality + pre-customer-reality aggregators. No fork._`,
  ``,
].join('\n');
fs.writeFileSync(path.join(RESULTS_DIR, 'customer-reality-gate.md'), md);

console.log(md);
console.log(`\nVerdict: ${verdict}  (exit ${exitCode})`);
process.exit(exitCode);
