/**
 * KIMI.2 — Question-First + Action-First (QFAF) Pilot.
 *
 * Doktrin: mem://strategie/kimi-comprehension-auditor-doctrine-v1
 * Scope: NUR 5 Learner-Routen, NUR audit_mode='qfaf', read-only.
 * Bewusst kein neuer Edge-Stack — bestehende kimi-reality-auditor Function
 * wurde um den 'qfaf'-Modus erweitert.
 *
 * Pro Route bewertet Kimi 4 Pflichtfragen:
 *   Q1 ORIENTATION — Wo bin ich?
 *   Q2 STAKES      — Was bedeutet das für meine Prüfung?
 *   Q3 ACTION      — Was ist der nächste sinnvolle Schritt?
 *   Q4 OUTCOME     — Was passiert nach dem Klick?
 *
 * Ein Finding entsteht nur, wenn eine Frage mit "nein" beantwortet wird.
 *   kind = qfaf_q1_orientation | qfaf_q2_stakes | qfaf_q3_action | qfaf_q4_outcome
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

const ROUTES = [
  '/dashboard',
  '/app/lernpfad',
  '/app/minicheck',
  '/app/tutor',
  '/app/exam-simulation',
];

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

async function snapshot(ctx, route) {
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  const target = BASE_URL + route;
  let finalUrl = target, title = '', text = '';
  let buttons = [], links = [], ctas = [], testids = [], headings = [];
  let nav_error = null;
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3000);
    await dismissCookies(page);
    await page.waitForTimeout(800);
    finalUrl = page.url();
    title = await page.title().catch(() => '');
    const raw = (await page.locator('body').innerText().catch(() => '')) || '';
    text = stripNoise(raw).slice(0, 8000);
    headings = await page.$$eval('h1, h2', els => els.map(e => (e.textContent || '').trim()).filter(Boolean).slice(0, 12)).catch(() => []);
    const rb = await page.$$eval('button, [role="button"]', els => els.map(e => (e.textContent || '').trim()).filter(Boolean).slice(0, 60)).catch(() => []);
    buttons = filterNoise(rb, x => x).slice(0, 40);
    const rl = await page.$$eval('a[href]', els => els.map(e => ({ text: (e.textContent || '').trim().slice(0, 80), href: e.getAttribute('href') || '' })).filter(l => l.text && l.href).slice(0, 60)).catch(() => []);
    links = filterNoise(rl, l => `${l.text} ${l.href}`).slice(0, 40);
    const rc = await page.$$eval('button, [role="button"], a[href]', els => els.map(e => {
      const tag = e.tagName.toLowerCase();
      const label = (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 80);
      const href = e.getAttribute('href') || '';
      const role = e.getAttribute('role') || '';
      const testid = e.getAttribute('data-testid') || '';
      const type = tag === 'a' ? (href.startsWith('#') ? 'anchor' : 'link') : (role === 'button' ? 'role-button' : 'button');
      return { tag, type, label, href, testid };
    }).filter(c => c.label && c.type !== 'anchor').slice(0, 80)).catch(() => []);
    ctas = filterNoise(rc, c => `${c.label} ${c.href}`).slice(0, 40);
    testids = await page.$$eval('[data-testid]', els => Array.from(new Set(els.map(e => e.getAttribute('data-testid')).filter(Boolean))).slice(0, 80)).catch(() => []);
  } catch (e) { nav_error = String(e).slice(0, 400); }
  finally { await page.close(); }
  return {
    route, requested_url: target, final_url: finalUrl,
    auth_lost: /\/auth(\b|\/|\?)/.test(finalUrl), nav_error,
    snapshot: {
      title, url: finalUrl, visible_text: text,
      headings, buttons, links, ctas,
      cta_count: ctas.length, cta_labels: ctas.map(c => c.label),
      buttons_count: buttons.length, links_count: links.length,
      testids, console_errors: consoleErrors.slice(0, 20),
    },
  };
}

async function callQfaf(route, snap) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/kimi-reality-auditor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SRK}` },
    body: JSON.stringify({
      audit_mode: 'qfaf', route, snapshot: snap,
      context: {
        persona: 'azubi (authentifiziert, hat Kurs gekauft, erste Sekunden auf der Seite)',
        goal: 'Prüfung bestehen — diese Seite muss helfen, den nächsten konkreten Schritt zu erkennen',
        sprint: '2.0_qfaf_pilot',
      },
    }),
  });
  const txt = await res.text();
  if (!res.ok) return { ok: false, status: res.status, error: txt.slice(0, 400), findings: [] };
  try { const j = JSON.parse(txt); return { ok: true, findings: j.findings || [], meta: j.meta }; }
  catch { return { ok: false, error: 'parse', findings: [] }; }
}

const Q_LABEL = {
  qfaf_q1_orientation: 'Q1 ORIENTATION — Wo bin ich?',
  qfaf_q2_stakes:      'Q2 STAKES      — Was bedeutet das für meine Prüfung?',
  qfaf_q3_action:      'Q3 ACTION      — Was ist der nächste sinnvolle Schritt?',
  qfaf_q4_outcome:     'Q4 OUTCOME     — Was passiert nach dem Klick?',
};

function scorecard(route, findings) {
  const failed = new Set(findings.map(f => f.kind));
  return {
    route,
    q1: failed.has('qfaf_q1_orientation') ? 'NEIN' : 'ja',
    q2: failed.has('qfaf_q2_stakes') ? 'NEIN' : 'ja',
    q3: failed.has('qfaf_q3_action') ? 'NEIN' : 'ja',
    q4: failed.has('qfaf_q4_outcome') ? 'NEIN' : 'ja',
    passed: 4 - failed.size,
  };
}

// --- Main ----------------------------------------------------------------
const browser = await chromium.launch({ executablePath: '/bin/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

console.log(`[kimi.2 qfaf] base=${BASE_URL}  routes=${ROUTES.length}`);
const login = await learnerLogin(ctx);
if (!login.ok) { console.error('[kimi.2] LOGIN FAIL', login); await browser.close(); process.exit(3); }
console.log('[kimi.2] login OK');

const results = [];
for (const r of ROUTES) {
  process.stdout.write(`  snap ${r} ... `);
  const s = await snapshot(ctx, r);
  console.log(`url=${s.final_url} auth_lost=${s.auth_lost} text=${s.snapshot.visible_text.length}b ctas=${s.snapshot.cta_count} testids=${s.snapshot.testids.length}`);
  if (s.auth_lost) { results.push({ snap: s, findings: [{ severity: 'P0', kind: 'auth_lost_post_login', user_impact: 'Learner wird auf /auth zurückgeworfen', evidence: `→ ${s.final_url}`, fix_recommendation: 'Auth-Gate prüfen', confidence: 1 }], audit_meta: null }); continue; }
  if (s.nav_error) { results.push({ snap: s, findings: [{ severity: 'P0', kind: 'broken_route', user_impact: 'Route lädt nicht', evidence: s.nav_error, fix_recommendation: 'Route prüfen', confidence: 1 }], audit_meta: null }); continue; }
  process.stdout.write(`  qfaf ${r} ... `);
  const res = await callQfaf(r, s.snapshot);
  console.log(res.ok ? `${res.findings.length} fails (${res.meta?.ms}ms)` : `ERR ${res.status} ${res.error?.slice(0,80)}`);
  results.push({ snap: s, findings: res.findings, audit_meta: res.meta });
}

await ctx.close();
await browser.close();

// --- Reporting ----------------------------------------------------------
const cards = results.map(r => scorecard(r.snap.route, r.findings));
const totals = {
  routes: results.length,
  pass4of4: cards.filter(c => c.passed === 4).length,
  pass3of4: cards.filter(c => c.passed === 3).length,
  pass_le2: cards.filter(c => c.passed <= 2).length,
  P0: results.flatMap(r => r.findings).filter(f => f.severity === 'P0').length,
  P1: results.flatMap(r => r.findings).filter(f => f.severity === 'P1').length,
  P2: results.flatMap(r => r.findings).filter(f => f.severity === 'P2').length,
};

const jsonPath = path.join(OUT_DIR, 'qfaf-pilot-2_0.json');
fs.writeFileSync(jsonPath, JSON.stringify({
  meta: { base_url: BASE_URL, ts: new Date().toISOString(), sprint: '2.0_qfaf_pilot', totals },
  scorecards: cards,
  results: results.map(r => ({
    route: r.snap.route,
    final_url: r.snap.final_url,
    headings: r.snap.snapshot.headings,
    cta_count: r.snap.snapshot.cta_count,
    findings: r.findings,
    audit_meta: r.audit_meta,
  })),
}, null, 2));

const md = [];
md.push(`# KIMI.2 — QFAF Comprehension Pilot`);
md.push(`_Generated ${new Date().toISOString()} · Base ${BASE_URL} · Learner ${EMAIL}_`);
md.push('');
md.push(`## Scorecard (Question-First + Action-First, 4 Fragen pro Seite)`);
md.push('| Route | Q1 Orientation | Q2 Stakes | Q3 Action | Q4 Outcome | Passed |');
md.push('|---|---|---|---|---|---|');
for (const c of cards) md.push(`| \`${c.route}\` | ${c.q1} | ${c.q2} | ${c.q3} | ${c.q4} | **${c.passed}/4** |`);
md.push('');
md.push(`## Totals`);
md.push('```\n' + JSON.stringify(totals, null, 2) + '\n```');
md.push('');
md.push(`## Findings je Route`);
for (const r of results) {
  md.push(`### \`${r.snap.route}\``);
  md.push(`- final: ${r.snap.final_url}  ·  ctas=${r.snap.snapshot.cta_count}  ·  testids=${r.snap.snapshot.testids.length}`);
  md.push(`- headings: ${JSON.stringify(r.snap.snapshot.headings).slice(0, 300)}`);
  if (!r.findings.length) { md.push(`- ✅ alle 4 QFAF-Fragen mit "ja" beantwortet`); md.push(''); continue; }
  for (const f of r.findings) {
    const q = Q_LABEL[f.kind] || f.kind;
    md.push(`- **[${f.severity}] ${q}**  (conf ${f.confidence})`);
    md.push(`  - User-Impact: ${f.user_impact || '—'}`);
    md.push(`  - Evidence:    ${f.evidence || '—'}`);
    md.push(`  - Fix:         ${f.fix_recommendation || '—'}`);
  }
  md.push('');
}

const mdPath = path.join(OUT_DIR, 'qfaf-pilot-2_0.md');
fs.writeFileSync(mdPath, md.join('\n'));

console.log(`\n[kimi.2 qfaf] DONE → ${mdPath}`);
console.log(`[kimi.2 qfaf] routes=${totals.routes}  4/4=${totals.pass4of4}  3/4=${totals.pass3of4}  ≤2/4=${totals.pass_le2}  P0=${totals.P0} P1=${totals.P1} P2=${totals.P2}`);
