/**
 * KIMI.3 — Learner Journey Auditor.
 *
 * Doktrin: mem://strategie/kimi-comprehension-auditor-doctrine-v1
 * Scope: read-only. Bewertet nicht Einzelseiten (das macht KIMI.2/QFAF),
 *        sondern die ÜBERGÄNGE zwischen Schritten und die Geschlossenheit
 *        der Lerner-Journey. Reuses kimi-reality-auditor, audit_mode='journey'.
 *
 * Drei Journeys:
 *   J1 main         : Beruf → Lernpfad → Tutor → MiniCheck → Simulation → Ergebnis
 *   J2 onboarding   : Landing → Beruf → Auth → Dashboard → erster Lernschritt
 *   J3 preparation  : Dashboard → Tutor → MiniCheck → Simulation → Wiederholung
 *
 * Pro Journey:
 *   - Snapshot je Schritt (DOM, CTAs, testids, headings)
 *   - Ein Aufruf an die Edge-Function mit allen Schritten
 *   - Auditor liefert Findings je verletzter Transition-Dimension:
 *       journey_handoff_mismatch | journey_dead_end |
 *       journey_orientation_loss | journey_no_recommendation
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
if (!EMAIL || !PASSWORD) { console.error('Learner credentials missing'); process.exit(2); }

const JOURNEYS = {
  main: {
    label: 'Main Learner Loop',
    requiresAuth: true,
    steps: ['/berufe', '/app/lernpfad', '/app/tutor', '/app/minicheck', '/app/exam-simulation', '/dashboard'],
  },
  onboarding: {
    label: 'Onboarding',
    requiresAuth: true, // we still log in to reach the post-auth steps
    steps: ['/', '/berufe', '/auth', '/dashboard', '/app/lernpfad'],
  },
  preparation: {
    label: 'Exam Preparation Loop',
    requiresAuth: true,
    steps: ['/dashboard', '/app/tutor', '/app/minicheck', '/app/exam-simulation', '/dashboard'],
  },
};

const journeysArg = process.argv.find(a => a.startsWith('--journeys='));
const selected = journeysArg
  ? journeysArg.slice('--journeys='.length).split(',').map(s => s.trim()).filter(Boolean)
  : Object.keys(JOURNEYS);

const OUT_DIR = '/mnt/documents/kimi';
fs.mkdirSync(OUT_DIR, { recursive: true });

const NOISE = [/cookie/i, /consent/i, /datenschutz/i, /privacy/i, /impressum/i, /agb/i, /akzeptieren/i, /alle erlauben/i, /ablehnen/i, /usercentrics/i, /borlabs/i];
const stripNoise = (t) => !t ? t : t.split('\n').filter(l => { const s = l.trim(); if (!s) return false; if (s.length < 80 && NOISE.some(p => p.test(s))) return false; return true; }).join('\n');
const filterNoise = (arr, keyer) => arr.filter(x => !NOISE.some(p => p.test(keyer(x))));

async function dismissCookies(page) {
  for (const re of [/akzeptieren/i, /alle erlauben/i, /accept/i]) {
    const btn = page.getByRole('button', { name: re }).first();
    if (await btn.isVisible().catch(() => false)) { await btn.click().catch(() => {}); await page.waitForTimeout(400); return; }
  }
}

async function learnerLogin(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto(BASE_URL + '/auth', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1200);
    await dismissCookies(page);
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 25_000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200), url: page.url() };
  } finally { await page.close(); }
}

async function snapshot(ctx, route, opts = {}) {
  // opts.fresh = open in a brand-new (logged-out) context for this snap only
  let useCtx = ctx, ownCtx = null;
  if (opts.fresh) {
    ownCtx = await ctx.browser().newContext({ viewport: { width: 1280, height: 900 } });
    useCtx = ownCtx;
  }
  const page = await useCtx.newPage();
  const target = BASE_URL + route;
  let finalUrl = target, title = '', text = '';
  let ctas = [], testids = [], headings = [];
  let orientation_markers = [];
  let nav_error = null;
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2500);
    await dismissCookies(page);
    await page.waitForTimeout(500);
    finalUrl = page.url();
    title = await page.title().catch(() => '');
    const raw = (await page.locator('body').innerText().catch(() => '')) || '';
    text = stripNoise(raw).slice(0, 4000);
    headings = await page.$$eval('h1, h2', els => els.map(e => (e.textContent || '').trim()).filter(Boolean).slice(0, 10)).catch(() => []);
    const rc = await page.$$eval('button, [role="button"], a[href]', els => els.map(e => {
      const tag = e.tagName.toLowerCase();
      const label = (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 80);
      const href = e.getAttribute('href') || '';
      const role = e.getAttribute('role') || '';
      const testid = e.getAttribute('data-testid') || '';
      const type = tag === 'a' ? (href.startsWith('#') ? 'anchor' : 'link') : (role === 'button' ? 'role-button' : 'button');
      return { tag, type, label, href, testid };
    }).filter(c => c.label && c.type !== 'anchor').slice(0, 60)).catch(() => []);
    ctas = filterNoise(rc, c => `${c.label} ${c.href}`).slice(0, 30);
    testids = await page.$$eval('[data-testid]', els => Array.from(new Set(els.map(e => e.getAttribute('data-testid')).filter(Boolean))).slice(0, 60)).catch(() => []);
    // Orientation markers (KIMI.3.1 harness extension): explicit, machine-readable
    // signals that this page tells the user where they are in the journey.
    orientation_markers = await page.evaluate(() => {
      const out = [];
      // 1. JourneyStepper component (data-testid="journey-stepper")
      document.querySelectorAll('[data-testid="journey-stepper"]').forEach(el => {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
        if (t) out.push(`stepper:${t}`);
      });
      // 2. aria-current="step" → which step is active
      document.querySelectorAll('[aria-current="step"]').forEach(el => {
        const t = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 80);
        if (t) out.push(`active-step:${t}`);
      });
      // 3. Breadcrumb nav
      document.querySelectorAll('nav[aria-label*="readcrumb" i], [data-testid*="breadcrumb" i]').forEach(el => {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (t) out.push(`breadcrumb:${t}`);
      });
      return out.slice(0, 8);
    }).catch(() => []);
  } catch (e) { nav_error = String(e).slice(0, 400); }
  finally {
    await page.close();
    if (ownCtx) await ownCtx.close().catch(() => {});
  }
  // Surface orientation markers explicitly to the auditor by prefixing
  // visible_text — the structural gate already reads ctas/testids, but
  // the LLM only sees visible_text/title/headings.
  const orientPrefix = orientation_markers.length
    ? `[ORIENTATION_MARKERS] ${orientation_markers.join(' | ')}\n\n`
    : '';
  return {
    route, requested_url: target, final_url: finalUrl,
    auth_lost: /\/auth(\b|\/|\?)/.test(finalUrl) && route !== '/auth',
    nav_error,
    title,
    visible_text: (orientPrefix + text).slice(0, 4200),
    headings,
    ctas, cta_labels: ctas.map(c => c.label),
    cta_count: ctas.length, testids,
    orientation_markers,
  };
}

async function callJourney(name, steps) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/kimi-reality-auditor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SRK}` },
    body: JSON.stringify({
      audit_mode: 'journey',
      route: `journey:${name}`,
      snapshot: { steps },
      context: {
        persona: 'azubi (authentifiziert, will Prüfung bestehen)',
        goal: 'Lückenlose Lerner-Journey ohne Sackgassen — jede Seite muss in die nächste münden',
        journey_name: name,
        sprint: '3.0_learner_journey',
      },
    }),
  });
  const txt = await res.text();
  if (!res.ok) return { ok: false, status: res.status, error: txt.slice(0, 400), findings: [], inconsistencies: [], passes: [] };
  try {
    const j = JSON.parse(txt);
    const all = j.findings || [];
    return {
      ok: true,
      findings: j.real_findings || all.filter(f => f.verdict === 'fail'),
      inconsistencies: j.inconsistencies || all.filter(f => f.verdict === 'inconsistent'),
      passes: j.passes || all.filter(f => f.verdict === 'pass'),
      all,
      meta: j.meta,
    };
  } catch { return { ok: false, error: 'parse', findings: [], inconsistencies: [], passes: [] }; }
}

const KIND_LABEL = {
  journey_dead_end:          'DEAD_END         — Sackgasse, kein Weg nach vorne',
  journey_handoff_mismatch:  'HANDOFF_MISMATCH — CTA führt nicht zum nächsten Schritt',
  journey_orientation_loss:  'ORIENTATION_LOSS — Folgeseite ohne Kontextbezug',
  journey_no_recommendation: 'NO_RECOMMENDATION — Loop endet im Nichts',
};

// --- Main ---------------------------------------------------------------
const browser = await chromium.launch({ executablePath: '/bin/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

console.log(`[kimi.3 journey] base=${BASE_URL}  journeys=${selected.length}`);
const login = await learnerLogin(ctx);
if (!login.ok) { console.error('[kimi.3] LOGIN FAIL', login); await browser.close(); process.exit(3); }
console.log('[kimi.3] login OK');

const journeyResults = [];
for (const jname of selected) {
  const J = JOURNEYS[jname];
  if (!J) { console.warn(`  unknown journey: ${jname}`); continue; }
  console.log(`\n[journey ${jname}] ${J.label}  steps=${J.steps.length}`);
  const stepSnaps = [];
  for (const r of J.steps) {
    process.stdout.write(`  snap ${r} ... `);
    // For the onboarding journey, the /auth step must be snapped in a
    // logged-out context — otherwise it just redirects to / and we never
    // see the real auth screen.
    const fresh = jname === 'onboarding' && r === '/auth';
    const s = await snapshot(ctx, r, { fresh });
    console.log(`url=${s.final_url} auth_lost=${s.auth_lost} text=${s.visible_text.length}b ctas=${s.cta_count} orient=${s.orientation_markers.length}${fresh ? ' [fresh]' : ''}`);
    stepSnaps.push(s);
  }
  process.stdout.write(`  audit journey:${jname} ... `);
  const res = await callJourney(jname, stepSnaps);
  console.log(res.ok
    ? `${res.findings.length} fails / ${res.inconsistencies.length} inconsistent / ${res.passes.length} pass-override (${res.meta?.ms}ms)`
    : `ERR ${res.status} ${res.error?.slice(0,80)}`);
  journeyResults.push({ name: jname, label: J.label, steps: stepSnaps, ...res });
}

await ctx.close();
await browser.close();

// --- Reporting ----------------------------------------------------------
const totals = {
  journeys: journeyResults.length,
  steps:    journeyResults.reduce((a, j) => a + j.steps.length, 0),
  transitions: journeyResults.reduce((a, j) => a + Math.max(0, j.steps.length - 1), 0),
  PASS:    journeyResults.reduce((a, j) => a + (j.passes?.length || 0), 0),
  FAIL:    journeyResults.reduce((a, j) => a + (j.findings?.length || 0), 0),
  INCONS:  journeyResults.reduce((a, j) => a + (j.inconsistencies?.length || 0), 0),
  P0:      journeyResults.flatMap(j => j.findings || []).filter(f => f.severity === 'P0').length,
  P1:      journeyResults.flatMap(j => j.findings || []).filter(f => f.severity === 'P1').length,
  P2:      journeyResults.flatMap(j => j.findings || []).filter(f => f.severity === 'P2').length,
};
const decided = totals.PASS + totals.FAIL;
const total_q = decided + totals.INCONS;
totals.trust_score_pct = total_q ? Math.round((decided / total_q) * 100) : 100;
totals.journey_score_pct = total_q ? Math.round((totals.PASS / total_q) * 100) : 100;

const jsonPath = path.join(OUT_DIR, 'journey-pilot-3_0.json');
fs.writeFileSync(jsonPath, JSON.stringify({
  meta: { base_url: BASE_URL, ts: new Date().toISOString(), sprint: '3.0_learner_journey', totals },
  journeys: journeyResults.map(j => ({
    name: j.name, label: j.label,
    steps: j.steps.map(s => ({ route: s.route, final_url: s.final_url, title: s.title, cta_count: s.cta_count, cta_labels: s.cta_labels, headings: s.headings })),
    findings: j.findings, inconsistencies: j.inconsistencies, passes: j.passes, meta: j.meta,
  })),
}, null, 2));

const md = [];
md.push(`# KIMI.3 — Learner Journey Auditor (Pilot)`);
md.push(`_Generated ${new Date().toISOString()} · Base ${BASE_URL} · Learner ${EMAIL}_`);
md.push('');
md.push(`## KPI-Bar`);
md.push('```');
md.push(`Journeys     = ${totals.journeys}`);
md.push(`Steps        = ${totals.steps}`);
md.push(`Transitions  = ${totals.transitions}`);
md.push(`PASS         = ${totals.PASS}`);
md.push(`FAIL         = ${totals.FAIL}        (echte Journey-Defekte)`);
md.push(`INCONS       = ${totals.INCONS}       (Auditor-Diskrepanz)`);
md.push(`P0           = ${totals.P0}           (Sackgassen)`);
md.push(`P1           = ${totals.P1}`);
md.push(`P2           = ${totals.P2}`);
md.push(`Trust Score  = ${totals.trust_score_pct}%`);
md.push(`Journey Score= ${totals.journey_score_pct}%`);
md.push('```');
md.push('');

for (const j of journeyResults) {
  md.push(`## Journey \`${j.name}\` — ${j.label}`);
  md.push(`Steps: ${j.steps.map(s => `\`${s.route}\``).join(' → ')}`);
  md.push('');
  md.push('| # | Route | Final | Title | CTAs |');
  md.push('|---|---|---|---|---|');
  j.steps.forEach((s, i) => md.push(`| ${i+1} | \`${s.route}\` | ${s.final_url} | ${s.title?.slice(0,40) || '—'} | ${s.cta_count} |`));
  md.push('');
  if (!j.findings?.length && !j.inconsistencies?.length) {
    md.push('✅ alle Transitions bestehen den strukturellen Journey-Gate.');
    md.push('');
    continue;
  }
  for (const f of (j.findings || [])) {
    md.push(`- **[FAIL ${f.severity}] ${KIND_LABEL[f.kind] || f.kind}**  (conf ${f.confidence})`);
    md.push(`  - User-Impact: ${f.user_impact || '—'}`);
    md.push(`  - Evidence:    ${f.evidence || '—'}`);
    md.push(`  - Fix:         ${f.fix_recommendation || '—'}`);
  }
  for (const f of (j.inconsistencies || [])) {
    md.push(`- **[INCONS ${f.severity}] ${KIND_LABEL[f.kind] || f.kind}**  ⚠️ Auditor-Diskrepanz`);
    md.push(`  - Reason:   ${f.inconsistency_reason || '—'}`);
    md.push(`  - Evidence: ${f.evidence || '—'}`);
  }
  for (const f of (j.passes || [])) {
    md.push(`- **[PASS-OVERRIDE ${f.severity}] ${KIND_LABEL[f.kind] || f.kind}**`);
    md.push(`  - Reason: ${f.override_reason || '—'}`);
  }
  md.push('');
}

const mdPath = path.join(OUT_DIR, 'journey-pilot-3_0.md');
fs.writeFileSync(mdPath, md.join('\n'));

console.log(`\n[kimi.3] DONE → ${mdPath}`);
console.log(`[kimi.3] journeys=${totals.journeys}  PASS=${totals.PASS} FAIL=${totals.FAIL} INCONS=${totals.INCONS}  P0=${totals.P0}  Trust=${totals.trust_score_pct}%  Journey=${totals.journey_score_pct}%`);
