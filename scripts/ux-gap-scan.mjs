#!/usr/bin/env node
/**
 * UX-Gap Scanner — Combined SSOT
 * ───────────────────────────────
 * Three-source UX-gap sweep, normalized to the `UxGapFinding` shape that
 * feeds the P18 → GIL bridge (`src/lib/governance/ux-gap-to-p18-bridge.ts`).
 *
 * Sources:
 *   1. Reality findings        — qa-state/pre-customer/*.json + reality-results/findings/*.json
 *   2. Static surface scan     — src/pages/*.tsx empty-state / recovery patterns
 *   3. DB entry-fallback signal — tracking_events.event_name='entry_fallback_view'
 *                                 in the last 24h (skipped if no PG creds)
 *
 * Outputs:
 *   /mnt/documents/ux-gap-report.json   — full report (artifact)
 *   reality-results/findings/ux-gap-*.json — one P0 file per ux_gap P0
 *
 * Exit codes:
 *   0 → no P0 ux_gaps   (P1/P2 may exist)
 *   1 → P0 ux_gaps found
 *   2 → scanner crashed
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const REPORT_DIR = process.env.UX_GAP_REPORT_DIR
  || (fs.existsSync('/mnt/documents') ? '/mnt/documents' : path.join(process.cwd(), 'reality-results'));
const FINDINGS_DIR = path.join(ROOT, 'reality-results', 'findings');
const NOW = new Date().toISOString();

const findings = [];

function pushFinding(f) {
  const id = f.id ?? crypto.createHash('sha1').update(`${f.source}:${f.surface}:${f.message}`).digest('hex').slice(0, 12);
  findings.push({ detected_at: NOW, ...f, id });
}

// Hydration-Drift heuristic: pre-customer signals where cold-load HTML
// rendered the surface correctly but post-hydration React mounted empty.
// Mapped from qa-state/pre-customer/*.json detail strings written by the
// 01..05 spec helpers.
const HYDRATION_DRIFT_HINTS = [
  { id: 'P01_homepage',    re: /problems=/,        route: '/',         element: 'hero CTA "Prüfung starten" / Demo-CTA' },
  { id: 'P02_find_beruf',  re: /links=0/,          route: '/berufe',   element: 'Beruf-Karten-Liste' },
  { id: 'P03_open_course', re: /url=NONE/,         route: '/berufe',   element: 'Kurs-Discovery-Link' },
  { id: 'P04_pricing',     re: /hasPrice=false/,   route: '/preise',   element: '€-Preis + Kauf-CTA' },
];
function hydrationDriftHint(id, detail) {
  const hit = HYDRATION_DRIFT_HINTS.find((h) => h.id === id && h.re.test(String(detail ?? '')));
  if (!hit) return null;
  return `HYDRATION-DRIFT auf ${hit.route}: Cold-Load liefert ${hit.element}, post-hydration React rendert leer. Default-Render der Komponente sichtbar machen (nicht hinter Loading-State).`;
}

// ─── 1. Reality findings ────────────────────────────────────────────
function scanReality() {
  const dirs = [
    path.join(ROOT, 'qa-state', 'pre-customer'),
    path.join(ROOT, 'reality-results', 'findings'),
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.json')) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
        const status = j.status ?? j.severity ?? 'unknown';
        const surface = j.surface ?? j.id ?? f.replace(/\.json$/, '');
        if (status === 'fail' || j.severity === 'P0') {
          const drift = hydrationDriftHint(j.id ?? surface, j.detail);
          pushFinding({
            surface,
            message: j.detail ?? j.message ?? `${surface} failed reality check`,
            severity: j.severity === 'P0' || status === 'fail' ? 'P0' : 'P1',
            source: d.includes('pre-customer') ? 'pre-customer-reality' : 'learner-reality',
            matched_systems: [surface],
            recommended_action:
              j.recommended_action
              ?? drift
              ?? `Re-run gate and fix the failing surface "${surface}".`,
          });
        }
      } catch { /* skip unreadable */ }
    }
  }
}

// ─── 2. Static surface scan ─────────────────────────────────────────
// Heuristics tuned to flag REAL problems only:
//  - "coming soon" / "in Kürze verfügbar" / "Bald verfügbar" → always a P2 (vague promise).
//  - "Noch keine X" empty-state copy → ONLY a P2 when the file offers no
//    actionable element (Button / Link to= / onClick / navigate(). A
//    domain-specific empty state with a CTA is a valid pattern (rule:
//    "Wenn Feature unfertig: echter Empty State mit Nutzen, nächstem Schritt, CTA").
//  - `reportEntryFallbackView(..., 'recovery'` recovery surface declaration →
//    ONLY a P2 when the same file has no Link/Button fallback (i.e. truly
//    leaves the user stranded).
const COMING_SOON_RE = /\b(coming\s+soon|in\s+Kürze\s+verfügbar|bald\s+verfügbar)\b/gi;
const EMPTY_STATE_RE = /Noch keine [A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\s-]*/g;
const RECOVERY_RE = /reportEntryFallbackView\([^)]*['"]recovery['"]/g;
const HAS_ACTION_RE = /<Button\b|<Link\s+to=|asChild[\s\S]{0,80}<Link|onClick\s*=|navigate\s*\(/;

function hasActionableElement(txt) {
  return HAS_ACTION_RE.test(txt);
}

function scanStatic() {
  const pagesDir = path.join(ROOT, 'src', 'pages');
  if (!fs.existsSync(pagesDir)) return;
  const stack = [pagesDir];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of fs.readdirSync(cur)) {
      const p = path.join(cur, e);
      const st = fs.statSync(p);
      if (st.isDirectory()) { stack.push(p); continue; }
      if (!/\.(tsx?|jsx?)$/.test(p)) continue;
      const txt = fs.readFileSync(p, 'utf8');
      const rel = path.relative(ROOT, p);
      const actionable = hasActionableElement(txt);

      COMING_SOON_RE.lastIndex = 0;
      const csHits = txt.match(COMING_SOON_RE);
      if (csHits && csHits.length > 0) {
        pushFinding({
          surface: rel, severity: 'P2', source: 'static-surface-scan',
          message: `User-visible "coming soon" copy (${csHits.length}× match)`,
          matched_systems: [rel],
        });
      }

      EMPTY_STATE_RE.lastIndex = 0;
      const esHits = txt.match(EMPTY_STATE_RE);
      if (esHits && esHits.length > 0 && !actionable) {
        pushFinding({
          surface: rel, severity: 'P2', source: 'static-surface-scan',
          message: `Empty-state copy without actionable CTA (${esHits.length}× match)`,
          matched_systems: [rel],
        });
      }

      RECOVERY_RE.lastIndex = 0;
      const recHits = txt.match(RECOVERY_RE);
      if (recHits && recHits.length > 0 && !actionable) {
        pushFinding({
          surface: rel, severity: 'P2', source: 'static-surface-scan',
          message: 'Recovery surface declared but no business content fallback',
          matched_systems: [rel],
        });
      }
    }
  }
}


// ─── 3. DB entry-fallback signal (24h) ──────────────────────────────
function scanDb() {
  if (!process.env.PGHOST) {
    return { skipped: true, reason: 'PGHOST not set' };
  }
  try {
    const out = execSync(
      `psql -At -F '|' -c "SELECT metadata->>'surface', metadata->>'state', count(*) FROM tracking_events WHERE event_name='entry_fallback_view' AND created_at > now() - interval '24 hours' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let total = 0;
    for (const line of out.trim().split('\n').filter(Boolean)) {
      const [surface, state, countStr] = line.split('|');
      const count = parseInt(countStr, 10) || 0;
      total += count;
      if (state === 'recovery' && count > 0) {
        pushFinding({
          surface: `${surface}:${state}`,
          message: `Recovery surface fired ${count}× in last 24h (production)`,
          severity: count >= 50 ? 'P0' : count >= 10 ? 'P1' : 'P2',
          source: 'entry-fallback-signal',
          matched_systems: [surface],
          recommended_action: `Investigate why "${surface}" lands in recovery for ${count} sessions/day.`,
        });
      }
    }
    return { skipped: false, total_events: total };
  } catch (e) {
    return { skipped: true, reason: e.message?.slice(0, 200) ?? 'psql error' };
  }
}

// ─── Run ────────────────────────────────────────────────────────────
let dbInfo;
try {
  scanReality();
  scanStatic();
  dbInfo = scanDb();
} catch (e) {
  console.error('ux-gap-scan crashed:', e);
  process.exit(2);
}

const byKey = new Map();
for (const f of findings) {
  const k = `${f.source}:${f.surface}:${f.severity}`;
  if (!byKey.has(k)) byKey.set(k, f);
}
const deduped = [...byKey.values()];

const summary = {
  generated_at: NOW,
  total: deduped.length,
  by_severity: { P0: 0, P1: 0, P2: 0 },
  by_source: {},
  db_signal: dbInfo,
};
for (const f of deduped) {
  summary.by_severity[f.severity] = (summary.by_severity[f.severity] ?? 0) + 1;
  summary.by_source[f.source] = (summary.by_source[f.source] ?? 0) + 1;
}

fs.mkdirSync(REPORT_DIR, { recursive: true });
const reportPath = path.join(REPORT_DIR, 'ux-gap-report.json');
fs.writeFileSync(reportPath, JSON.stringify({ summary, findings: deduped }, null, 2));

// Emit P0 ux_gap files so customer-reality-gate.mjs picks them up.
fs.mkdirSync(FINDINGS_DIR, { recursive: true });
for (const f of deduped.filter((x) => x.severity === 'P0')) {
  const fp = path.join(FINDINGS_DIR, `ux-gap-${f.id}.json`);
  fs.writeFileSync(fp, JSON.stringify({
    severity: 'P0',
    source: 'ux-gap-scan',
    surface: f.surface,
    detail: f.message,
    finding: f,
  }, null, 2));
}

console.log(`ux-gap-scan: ${deduped.length} findings (P0=${summary.by_severity.P0}, P1=${summary.by_severity.P1}, P2=${summary.by_severity.P2})`);
console.log(`  report:   ${reportPath}`);
console.log(`  db:       ${dbInfo.skipped ? `skipped (${dbInfo.reason})` : `${dbInfo.total_events} events scanned`}`);

process.exit(summary.by_severity.P0 > 0 ? 1 : 0);
