/**
 * KIMI.1.5 — Authenticated Learner Reality Audit.
 *
 * Sprint 1.5 scope per user directive:
 *  - Real learner login first
 *  - Audit POST-LOGIN routes that matter for Learning/Conversion:
 *      /dashboard, /app/tutor, /app/lernpfad, /app/minicheck, /app/exam-simulation
 *  - Filter cookie-/consent-/legal-banner noise BEFORE auditor sees the snapshot
 *  - Sharper QFAF questions (next step / start exam / why here / next action)
 *  - Success metric: ≥1 echter Post-Login Learning-Blocker
 *
 * Read-only. No mutations. No fixes.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.KIMI_AUDIT_BASE_URL || 'https://berufos.com';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.REALITY_LEARNER_EMAIL || process.env.E2E_TEST_USER_EMAIL;
const PASSWORD = process.env.REALITY_LEARNER_PASSWORD || process.env.E2E_TEST_USER_PASSWORD;

if (!SUPABASE_URL || !SRK) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required'); process.exit(2); }
if (!EMAIL || !PASSWORD) { console.error('Learner credentials missing (REALITY_LEARNER_* or E2E_TEST_USER_*)'); process.exit(2); }

const POST_LOGIN_ROUTES = [
  '/dashboard',
  '/app/tutor',
  '/app/lernpfad',
  '/app/minicheck',
  '/app/exam-simulation',
];
const MODES = ['reality', 'ux_text', 'next_action'];

const OUT_DIR = '/mnt/documents/kimi';
fs.mkdirSync(OUT_DIR, { recursive: true });

const EXISTING_GATES = {
  '/dashboard':           ['learner/05-learning', 'D-app-shell', 'learner/12-navigation-no-global-totp-blocker'],
  '/app/tutor':           ['learner/07-ai-tutor'],
  '/app/lernpfad':        ['learner/05-learning'],
  '/app/minicheck':       ['learner/05-learning'],
  '/app/exam-simulation': ['learner/08-written-exam'],
};

// --- Cookie / consent / legal noise filter --------------------------------
const NOISE_PATTERNS = [
  /cookie/i, /consent/i, /datenschutz/i, /privacy/i, /impressum/i, /agb/i,
  /akzeptieren/i, /alle erlauben/i, /ablehnen/i, /einstellungen verwalten/i,
  /usercentrics/i, /borlabs/i,
];
function stripNoise(text) {
  if (!text) return text;
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (t.length < 80 && NOISE_PATTERNS.some((p) => p.test(t))) return false;
      return true;
    })
    .join('\n');
}
function filterButtons(arr) {
  return arr.filter((t) => !NOISE_PATTERNS.some((p) => p.test(t)));
}
function filterLinks(arr) {
  return arr.filter((l) => {
    const t = `${l.text} ${l.href}`;
    return !NOISE_PATTERNS.some((p) => p.test(t));
  });
}

// --- Auth helpers ----------------------------------------------------------
async function dismissCookies(page) {
  for (const re of [/akzeptieren/i, /alle erlauben/i, /accept/i]) {
    const btn = page.getByRole('button', { name: re }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(400);
      return;
    }
  }
}

async function learnerLogin(ctx) {
  const page = await ctx.newPage();
  await page.goto(BASE_URL + '/auth', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(1200);
  await dismissCookies(page);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 25_000 });
  } catch (e) {
    return { ok: false, error: 'login_timeout', url: page.url() };
  } finally {
    await page.close();
  }
  return { ok: true };
}

// --- Snapshot --------------------------------------------------------------
async function snapshotRoute(ctx, route) {
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 300)));

  const target = BASE_URL + route;
  let finalUrl = target, title = '', visible_text = '', buttons = [], links = [];
  let nav_error = null;
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3000);
    await dismissCookies(page);
    await page.waitForTimeout(800);
    finalUrl = page.url();
    title = await page.title().catch(() => '');
    const raw = (await page.locator('body').innerText().catch(() => '')) || '';
    visible_text = stripNoise(raw).slice(0, 8000);
    const rawButtons = await page.$$eval('button, [role="button"]', (els) =>
      els.map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 60)
    ).catch(() => []);
    buttons = filterButtons(rawButtons).slice(0, 40);
    const rawLinks = await page.$$eval('a[href]', (els) =>
      els.map((e) => ({ text: (e.textContent || '').trim().slice(0, 80), href: e.getAttribute('href') || '' }))
         .filter((l) => l.text && l.href).slice(0, 60)
    ).catch(() => []);
    links = filterLinks(rawLinks).slice(0, 40);
  } catch (e) {
    nav_error = String(e).slice(0, 400);
  } finally {
    await page.close();
  }

  return {
    route,
    requested_url: target,
    final_url: finalUrl,
    redirected: finalUrl !== target,
    auth_lost: /\/auth(\b|\/|\?)/.test(finalUrl),
    nav_error,
    snapshot: { title, url: finalUrl, visible_text, buttons, links, console_errors: consoleErrors.slice(0, 20) },
  };
}

// --- Auditor call ----------------------------------------------------------
async function callAuditor(route, mode, snapshot) {
  const url = `${SUPABASE_URL}/functions/v1/kimi-reality-auditor`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SRK}` },
    body: JSON.stringify({
      audit_mode: mode,
      route,
      snapshot,
      context: {
        persona: 'azubi (authentifiziert, hat Kurs gekauft, will Prüfung bestehen)',
        goal: 'Nächsten Lernschritt machen oder Prüfung starten',
        sprint: '1.5_authenticated',
        qfaf_questions: [
          'Kann der Learner in den nächsten Lernschritt wechseln?',
          'Kann der Learner die Prüfung starten?',
          'Weiß der Learner, warum er auf dieser Seite ist?',
          'Ist die nächste empfohlene Aktion sichtbar?',
        ],
        filtered_noise: 'Cookie-, Consent-, Datenschutz-, AGB-, Impressum-Elemente wurden VOR dem Audit entfernt. Bitte solche Findings nicht erzeugen.',
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 500), findings: [] };
  try {
    const j = JSON.parse(text);
    return { ok: true, findings: j.findings || [], meta: j.meta };
  } catch {
    return { ok: false, status: res.status, error: 'parse_error', findings: [] };
  }
}

// --- Enrichment ------------------------------------------------------------
function enrich(finding, snap) {
  const orientationFail = ['unclear_orientation', 'unclear_ux_text'].includes(finding.kind);
  const actionFail = ['missing_next_action', 'dead_cta'].includes(finding.kind);
  const gates = EXISTING_GATES[snap.route] || [];
  return {
    route: snap.route,
    severity: finding.severity,
    kind: finding.kind,
    confidence: finding.confidence,
    user_impact: finding.user_impact,
    is_post_login_learning_blocker: snap.route.startsWith('/app/') || snap.route === '/dashboard',
    why_existing_reality_gate_missed_it:
      gates.length === 0
        ? 'Keine bestehende Reality-Gate-Abdeckung für diese Post-Login-Route.'
        : `Bestehende Gates (${gates.join(', ')}) prüfen Render/Routing, nicht semantische "next step"/"start exam"-Affordance.`,
    question_first_status: orientationFail ? 'FAIL' : 'PASS',
    action_first_status: actionFail ? 'FAIL' : 'PASS',
    audit_mode: finding.audit_mode,
    evidence: finding.evidence,
    reproduction_steps: finding.reproduction_steps,
    file_hint: finding.file_hint,
    fix_recommendation: finding.fix_recommendation,
    existing_gates_for_route: gates,
  };
}

// --- Main ------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: '/bin/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

console.log(`[kimi.1.5] base=${BASE_URL}  routes=${POST_LOGIN_ROUTES.length}  modes=${MODES.length}`);
console.log(`[kimi.1.5] login as ${EMAIL} ...`);
const login = await learnerLogin(ctx);
if (!login.ok) {
  console.error('[kimi.1.5] LOGIN FAILED', login);
  await browser.close();
  process.exit(3);
}
console.log('[kimi.1.5] login OK');

const snapshots = [];
for (const r of POST_LOGIN_ROUTES) {
  process.stdout.write(`  snap ${r} ... `);
  const snap = await snapshotRoute(ctx, r);
  console.log(`url=${snap.final_url} auth_lost=${snap.auth_lost} text=${snap.snapshot.visible_text.length}b buttons=${snap.snapshot.buttons.length} links=${snap.snapshot.links.length} errs=${snap.snapshot.console_errors.length}`);
  snapshots.push(snap);
}
await ctx.close();
await browser.close();

const allEnriched = [];
const perCall = [];
for (const snap of snapshots) {
  if (snap.auth_lost) {
    allEnriched.push(enrich({
      severity: 'P0', kind: 'auth_lost_post_login', confidence: 1.0, audit_mode: 'reality',
      user_impact: 'Authentifizierter Learner wird auf /auth zurückgeworfen — Lern-Surface unerreichbar.',
      evidence: `requested=${snap.requested_url} → final=${snap.final_url}`,
      reproduction_steps: ['Login als Learner', `Visit ${snap.requested_url}`, 'Redirect → /auth'],
      file_hint: [`src/pages${snap.route}`, 'AuthGuard / RequireAuth'],
      fix_recommendation: 'Auth-Gate-Logik dieser Route prüfen — Session sollte erkannt werden.',
    }, snap));
    continue;
  }
  if (snap.nav_error) {
    allEnriched.push(enrich({
      severity: 'P0', kind: 'broken_route', confidence: 1.0, audit_mode: 'reality',
      user_impact: 'Route konnte nicht geladen werden.',
      evidence: `nav_error: ${snap.nav_error}`,
      reproduction_steps: [`Visit ${snap.requested_url}`],
      file_hint: [`src/pages${snap.route}`],
      fix_recommendation: 'Route-Definition & SSR-Verhalten prüfen.',
    }, snap));
    continue;
  }
  for (const mode of MODES) {
    process.stdout.write(`  audit ${snap.route} [${mode}] ... `);
    const res = await callAuditor(snap.route, mode, snap.snapshot);
    perCall.push({ route: snap.route, mode, ok: res.ok, count: res.findings.length, meta: res.meta, error: res.error });
    console.log(res.ok ? `${res.findings.length} findings (${res.meta?.ms}ms)` : `ERR ${res.status} ${res.error?.slice(0,120)}`);
    for (const f of res.findings) {
      // Defensive 2nd-pass noise filter against any auditor that still emits cookie findings.
      const blob = `${f.kind} ${f.user_impact} ${f.evidence}`.toLowerCase();
      if (NOISE_PATTERNS.some((p) => p.test(blob)) && f.severity !== 'P0') continue;
      allEnriched.push(enrich(f, snap));
    }
  }
}

// Dedup: gleiche (route, kind, severity) → ein Finding (höchste confidence gewinnt).
// Verhindert dass z.B. /app/exam-simulation als 3 P0s gezählt wird (reality + ux_text + next_action).
const dedupMap = new Map();
for (const f of allEnriched) {
  const key = `${f.route}::${f.kind}::${f.severity}`;
  const prev = dedupMap.get(key);
  if (!prev || (f.confidence ?? 0) > (prev.confidence ?? 0)) dedupMap.set(key, f);
}
allEnriched = Array.from(dedupMap.values());

allEnriched.sort((a, b) => {
  const sa = a.severity === 'P0' ? 0 : a.severity === 'P1' ? 1 : 2;
  const sb = b.severity === 'P0' ? 0 : b.severity === 'P1' ? 1 : 2;
  return sa - sb || (b.confidence - a.confidence);
});

const postLoginBlockers = allEnriched.filter(
  (f) => f.is_post_login_learning_blocker && (f.severity === 'P0' || (f.severity === 'P1' && f.action_first_status === 'FAIL'))
);
const counts = {
  total: allEnriched.length,
  P0: allEnriched.filter((f) => f.severity === 'P0').length,
  P1: allEnriched.filter((f) => f.severity === 'P1').length,
  P2: allEnriched.filter((f) => f.severity === 'P2').length,
  post_login_blockers: postLoginBlockers.length,
};
const sprintSuccess = postLoginBlockers.length >= 1;

const jsonPath = path.join(OUT_DIR, 'reality-audit-1_5.json');
fs.writeFileSync(jsonPath, JSON.stringify({
  meta: { base_url: BASE_URL, ts: new Date().toISOString(), counts, sprint_success: sprintSuccess, sprint: '1.5_authenticated' },
  per_call: perCall,
  snapshots: snapshots.map((s) => ({ route: s.route, final_url: s.final_url, redirected: s.redirected, auth_lost: s.auth_lost, text_len: s.snapshot.visible_text.length, console_errors: s.snapshot.console_errors })),
  findings: allEnriched,
}, null, 2));

const md = [];
md.push(`# KIMI.1.5 Authenticated Learner Reality Audit`);
md.push(`_Generated: ${new Date().toISOString()} · Base: ${BASE_URL} · Learner: ${EMAIL}_`);
md.push('');
md.push(`## Sprint 1.5 Success Gate`);
md.push(`**Kriterium**: ≥ 1 echter Post-Login Learning-Blocker (Dashboard / Tutor / Lernpfad / MiniCheck / Exam).`);
md.push(`**Ergebnis**: ${sprintSuccess ? '✅ PASS' : '❌ NOT YET'} — ${postLoginBlockers.length} Post-Login-Blocker.`);
md.push('');
md.push(`## Zähler`);
md.push('```\n' + JSON.stringify(counts, null, 2) + '\n```');
md.push('');
md.push(`## Post-Login Learning Blocker (Sprint-1.5 Gold)`);
appendFindings(md, postLoginBlockers);
md.push(`## Alle Findings`);
appendFindings(md, allEnriched);
md.push(`## Snapshot-Status`);
md.push('| Route | Final URL | Auth-Lost | Text | Errors |');
md.push('|---|---|---|---|---|');
for (const s of snapshots) md.push(`| ${s.route} | ${s.final_url} | ${s.auth_lost ? '⚠️' : '—'} | ${s.snapshot.visible_text.length}b | ${s.snapshot.console_errors.length} |`);
md.push('');
md.push(`## Per-Call Stats`);
md.push('| Route | Mode | OK | Findings | ms |');
md.push('|---|---|---|---|---|');
for (const c of perCall) md.push(`| ${c.route} | ${c.mode} | ${c.ok ? '✅' : '❌ ' + (c.error||'').slice(0,60)} | ${c.count} | ${c.meta?.ms ?? '-'} |`);

function appendFindings(out, items) {
  if (!items.length) { out.push('_keine Findings_\n'); return; }
  for (const f of items) {
    out.push(`### [${f.severity}] ${f.route} — ${f.kind}  ·  conf ${f.confidence}`);
    out.push(`- **User-Impact**: ${f.user_impact || '—'}`);
    out.push(`- **Question-First**: ${f.question_first_status}   ·   **Action-First**: ${f.action_first_status}`);
    out.push(`- **Why existing reality gate missed it**: ${f.why_existing_reality_gate_missed_it}`);
    out.push(`- **Evidence**: ${f.evidence}`);
    if (f.reproduction_steps?.length) out.push(`- **Repro**: ${f.reproduction_steps.join(' → ')}`);
    if (f.file_hint?.length) out.push(`- **File-Hint**: ${f.file_hint.join(', ')}`);
    out.push(`- **Fix**: ${f.fix_recommendation}`);
    out.push(`- **Mode**: ${f.audit_mode}  ·  **Existing gates**: ${f.existing_gates_for_route.join(', ') || '—'}`);
    out.push('');
  }
}

const mdPath = path.join(OUT_DIR, 'reality-audit-1_5.md');
fs.writeFileSync(mdPath, md.join('\n'));

console.log(`\n[kimi.1.5] DONE → ${mdPath}`);
console.log(`[kimi.1.5] findings=${counts.total} P0=${counts.P0} post_login_blockers=${postLoginBlockers.length} sprint_success=${sprintSuccess}`);
