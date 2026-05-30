#!/usr/bin/env node
/**
 * Customer Reality Aggregator.
 *
 * Liest:
 *   reality-results/findings/*.json
 *   reality-results/route-matrix.json
 *   reality-results/button-audit.json
 *   reality-results/login-success.flag (optional)
 *
 * Schreibt:
 *   reality-results/reality-results.json
 *   reality-results/reality-report.md
 *   reality-results/customer-journey-report.md
 *
 * Berechnet CORS-Score (Understanding 20 / Navigation 20 / Workflow 25 / Conversion 25 / Trust 10)
 * und Decision RELEASE / REVIEW / BLOCK.
 *
 * Hard-BLOCK:
 *   - Login unmöglich (kein login-success.flag UND PM-Creds vorhanden)
 *   - Tote Haupt-CTA (P0 dead_cta)
 *   - Route 4xx/5xx auf Pflicht-Route, white_screen, spinner_loop, kritischer console_error
 *   - Pflicht-Trust-Seite fehlt
 *
 * Regel: Wenn keine Login-Erfolgs-Flag UND PM-Creds gesetzt → BLOCK + "reines Public-Smoke darf nie RELEASE sein".
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.cwd(), 'reality-results');
const FIND_DIR = path.join(DIR, 'findings');

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

const findings = [];
if (fs.existsSync(FIND_DIR)) {
  for (const f of fs.readdirSync(FIND_DIR)) {
    const j = readJsonSafe(path.join(FIND_DIR, f));
    if (j) findings.push(j);
  }
}
const routeMatrix = readJsonSafe(path.join(DIR, 'route-matrix.json')) || { rows: [] };
const buttonAudit = readJsonSafe(path.join(DIR, 'button-audit.json')) || { rows: [] };
const loginFlag = readJsonSafe(path.join(DIR, 'login-success.flag'));

const hasPmCreds = !!(process.env.REALITY_PM_EMAIL && process.env.REALITY_PM_PASSWORD);

const p0 = findings.filter((f) => f.severity === 'P0');
const p1 = findings.filter((f) => f.severity === 'P1');
const p2 = findings.filter((f) => f.severity === 'P2');

const byJourney = {};
for (const f of findings) (byJourney[f.journey] ||= []).push(f);

// ----- Score-Komponenten (0..100) -----
function score(component, deductions) {
  let s = 100;
  for (const d of deductions) s -= d;
  return Math.max(0, Math.min(100, s));
}

const understanding = score('U', [
  (byJourney.A || []).filter((f) => f.kind === 'placeholder_end_state').length * 30,
  (byJourney.A || []).filter((f) => f.kind === 'white_screen').length * 60,
]);

const brokenRoutes = routeMatrix.rows.filter((r) => !r.ok).length;
const totalRoutes = Math.max(1, routeMatrix.rows.length);
const navigation = Math.round(100 * (1 - brokenRoutes / totalRoutes));

const deadButtons = buttonAudit.rows.filter((r) => r.visible && r.effect === 'none').length;
const totalButtons = Math.max(1, buttonAudit.rows.filter((r) => r.visible).length);
const workflow = Math.round(100 * (1 - deadButtons / totalButtons))
  - ((byJourney.E || []).filter((f) => f.severity === 'P0').length * 20);

const conversion = score('C', [
  (byJourney.A || []).filter((f) => f.kind === 'dead_cta').length * 40,
  (byJourney.B || []).filter((f) => f.severity === 'P0' || f.severity === 'P1').length * 20,
]);

const trustMissing = (byJourney.F || []).filter((f) => f.kind === 'missing_trust_page').length;
const trust = score('T', [trustMissing * 30]);

const components = { understanding, navigation, workflow: Math.max(0, workflow), conversion, trust };
const cors = Math.round(
  components.understanding * 0.20 +
  components.navigation    * 0.20 +
  components.workflow      * 0.25 +
  components.conversion    * 0.25 +
  components.trust         * 0.10,
);

// ----- Hard-BLOCK-Regeln -----
const hardBlockReasons = [];
if (hasPmCreds && !loginFlag) hardBlockReasons.push('LOGIN_UNSUCCESSFUL — Reality-Garantie fehlt, Public-Smoke darf nie RELEASE sein.');
if (!hasPmCreds) hardBlockReasons.push('NO_PM_CREDENTIALS — REALITY_PM_EMAIL/_PASSWORD nicht gesetzt; nur Public-Smoke gelaufen.');
for (const f of p0) hardBlockReasons.push(`P0:${f.kind}@${f.route ?? '-'} — ${f.detail}`);

let decision = 'RELEASE';
if (hardBlockReasons.length > 0 || cors < 75) decision = 'BLOCK';
else if (cors < 90) decision = 'REVIEW';

const results = {
  generated_at: new Date().toISOString(),
  base_url: process.env.REALITY_BASE_URL || 'unset',
  cors,
  components,
  decision,
  counts: { p0: p0.length, p1: p1.length, p2: p2.length, findings: findings.length },
  hard_block_reasons: hardBlockReasons,
  login_ok: !!loginFlag,
  has_pm_credentials: hasPmCreds,
  route_matrix_summary: { total: routeMatrix.rows.length, broken: brokenRoutes },
  button_audit_summary: { total: totalButtons, dead: deadButtons },
};

fs.writeFileSync(path.join(DIR, 'reality-results.json'), JSON.stringify(results, null, 2));

// ----- Markdown-Reports -----
function md() {
  const top = [...p0, ...p1].slice(0, 10);
  const lines = [];
  lines.push(`# Customer Reality Report — ${decision}`);
  lines.push(``);
  lines.push(`**CORS:** ${cors}/100 · **Decision:** ${decision}`);
  lines.push(`**Login ok:** ${results.login_ok} · **PM-Creds:** ${hasPmCreds}`);
  lines.push(``);
  lines.push(`| Komponente | Score |`);
  lines.push(`|---|---|`);
  for (const [k, v] of Object.entries(components)) lines.push(`| ${k} | ${v} |`);
  lines.push(``);
  if (hardBlockReasons.length) {
    lines.push(`## Hard-BLOCK Gründe`);
    for (const r of hardBlockReasons) lines.push(`- ${r}`);
    lines.push(``);
  }
  lines.push(`## Findings (P0=${p0.length} · P1=${p1.length} · P2=${p2.length})`);
  lines.push(``);
  if (top.length === 0) lines.push(`_Keine kritischen Findings._`);
  for (const f of top) {
    lines.push(`- **${f.severity} · ${f.kind}** @ ${f.route ?? '-'} (Journey ${f.journey})`);
    lines.push(`  - ${f.detail}`);
    if (f.fix) lines.push(`  - Fix: ${f.fix}`);
  }
  lines.push(``);
  lines.push(`## Defekte Routen`);
  for (const r of routeMatrix.rows.filter((r) => !r.ok)) {
    lines.push(`- \`${r.route}\` (${r.role}) → http=${r.http_status} white=${r.white_screen} spinner=${r.spinner_loop} console=${r.console_errors}`);
  }
  lines.push(``);
  lines.push(`## Tote Buttons (Top 10)`);
  for (const b of buttonAudit.rows.filter((r) => r.visible && r.effect === 'none').slice(0, 10)) {
    lines.push(`- \`${b.route}\` → "${b.text}"`);
  }
  return lines.join('\n');
}

const report = md();
fs.writeFileSync(path.join(DIR, 'reality-report.md'), report);

// Journey-Übersicht
const journeyMd = ['# Customer Journey Report', ''];
for (const j of ['A','B','C','D','E','F','AUDIT']) {
  const fs_ = byJourney[j] || [];
  const status = fs_.some((f) => f.severity === 'P0') ? 'FAIL' : fs_.length ? 'WARN' : 'PASS';
  journeyMd.push(`## Journey ${j} — ${status} (${fs_.length} Findings)`);
  for (const f of fs_.slice(0, 5)) journeyMd.push(`- ${f.severity} ${f.kind} @ ${f.route ?? '-'} — ${f.detail}`);
  journeyMd.push('');
}
fs.writeFileSync(path.join(DIR, 'customer-journey-report.md'), journeyMd.join('\n'));

// GitHub Step Summary
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  const sum = [
    `## Customer Reality — ${decision}`,
    ``,
    `- **CORS:** ${cors}/100`,
    `- **Findings:** P0=${p0.length} · P1=${p1.length} · P2=${p2.length}`,
    `- **Login ok:** ${results.login_ok} · **PM-Creds set:** ${hasPmCreds}`,
    `- **Broken routes:** ${brokenRoutes}/${routeMatrix.rows.length}`,
    `- **Dead buttons:** ${deadButtons}/${totalButtons}`,
    ``,
    decision === 'BLOCK' ? `### 🔴 BLOCK Gründe` : '',
    ...(decision === 'BLOCK' ? hardBlockReasons.map((r) => `- ${r}`) : []),
  ].join('\n');
  fs.appendFileSync(summaryPath, sum + '\n');
}

console.log(`[reality] CORS=${cors} decision=${decision} P0=${p0.length} P1=${p1.length} P2=${p2.length}`);
if (decision === 'BLOCK') process.exit(2);
if (decision === 'REVIEW') process.exit(0); // warn via summary; nicht hart fail (kann via Workflow auf Wunsch geändert werden)
process.exit(0);
