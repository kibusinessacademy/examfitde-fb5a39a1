/**
 * KIMI.3.3 — Conversion Journey Auditor v1.0
 *
 * Doktrin: mem://strategie/kimi-comprehension-auditor-doctrine-v1
 * Scope:   read-only. Bewertet die Übergänge im Conversion-Funnel:
 *
 *   J1 conversion_public_funnel : / → /berufe → /berufe/<slug> → /preise → /auth
 *                                  (public fresh — misst: kommt der Besucher überhaupt bis zum Auth-Gate?)
 *   J2 conversion_activation    : /dashboard → /app/lernpfad
 *                                  (Learner-Auth — misst: führt Login direkt in den ersten Lernschritt?)
 *
 * Reused: kimi-reality-auditor, audit_mode='journey' (KIMI.3.2 contract).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spaSnapshot, dismissCookies } from './_spa-snapshot.mjs';

const BASE_URL = process.env.KIMI_AUDIT_BASE_URL || 'https://berufos.com';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.REALITY_LEARNER_EMAIL || process.env.E2E_TEST_USER_EMAIL;
const PASSWORD = process.env.REALITY_LEARNER_PASSWORD || process.env.E2E_TEST_USER_PASSWORD;

if (!SUPABASE_URL || !SRK) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required'); process.exit(2); }
if (!EMAIL || !PASSWORD) { console.error('Learner credentials missing'); process.exit(2); }

const DEMO_SLUG = process.env.KIMI_CONVERSION_SLUG || 'einzelhandelskaufmann-frau';

const JOURNEYS = {
  conversion_public_funnel: {
    label: 'Conversion Public Funnel (Landing → Auth-Gate)',
    requiresAuth: false,
    steps: ['/', '/berufe', `/berufe/${DEMO_SLUG}`, '/preise', '/auth'],
    freshFor: new Set(['/', '/berufe', `/berufe/${DEMO_SLUG}`, '/preise', '/auth']),
  },
  conversion_activation: {
    label: 'Post-Auth Activation (Dashboard → erster Lernschritt)',
    requiresAuth: true,
    steps: ['/dashboard', '/app/lernpfad'],
    freshFor: new Set(),
  },
};

const journeysArg = process.argv.find(a => a.startsWith('--journeys='));
const selected = journeysArg
  ? journeysArg.slice('--journeys='.length).split(',').map(s => s.trim()).filter(Boolean)
  : Object.keys(JOURNEYS);

const OUT_DIR = '/mnt/documents/kimi';
fs.mkdirSync(OUT_DIR, { recursive: true });

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

const snapshot = (ctx, route, opts = {}) =>
  spaSnapshot(ctx, route, { baseUrl: BASE_URL, fresh: !!opts.fresh });

async function callJourney(name, steps) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/kimi-reality-auditor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SRK}` },
    body: JSON.stringify({
      audit_mode: 'journey',
      route: `journey:${name}`,
      snapshot: { steps },
      context: {
        persona: 'Erstbesucher / B2C-Lernender — sucht den passenden IHK-Beruf und will so schnell wie möglich mit Lernen beginnen',
        goal: 'Lückenloser Conversion-Pfad: Landing → Berufsliste → Berufsdetail → Pricing → Registrierung → erster Lernschritt. Jede Seite muss in die nächste münden, der Nutzer darf nie raten müssen, was als Nächstes kommt.',
        journey_name: name,
        sprint: 'conversion_3_3',
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
      all, meta: j.meta,
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

console.log(`[kimi.3.3 conversion] base=${BASE_URL}  journeys=${selected.length}  demo_slug=${DEMO_SLUG}`);
const needsAuth = selected.some(n => JOURNEYS[n]?.requiresAuth);
if (needsAuth) {
  const login = await learnerLogin(ctx);
  if (!login.ok) { console.error('[kimi.3.3] LOGIN FAIL', login); await browser.close(); process.exit(3); }
  console.log('[kimi.3.3] login OK');
}

const journeyResults = [];
for (const jname of selected) {
  const J = JOURNEYS[jname];
  if (!J) { console.warn(`  unknown journey: ${jname}`); continue; }
  console.log(`\n[journey ${jname}] ${J.label}  steps=${J.steps.length}`);
  const stepSnaps = [];
  for (const r of J.steps) {
    process.stdout.write(`  snap ${r} ... `);
    const fresh = J.freshFor.has(r);
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

const jsonPath = path.join(OUT_DIR, 'journey-conversion-3_3.json');
fs.writeFileSync(jsonPath, JSON.stringify({
  meta: { base_url: BASE_URL, ts: new Date().toISOString(), sprint: 'conversion_3_3', demo_slug: DEMO_SLUG, totals },
  journeys: journeyResults.map(j => ({
    name: j.name, label: j.label,
    steps: j.steps.map(s => ({ route: s.route, final_url: s.final_url, title: s.title, cta_count: s.cta_count, cta_labels: s.cta_labels, headings: s.headings, orientation_markers: s.orientation_markers })),
    findings: j.findings, inconsistencies: j.inconsistencies, passes: j.passes, meta: j.meta,
  })),
}, null, 2));

const md = [];
md.push(`# KIMI.3.3 — Conversion Journey Auditor v1.0`);
md.push(`_Generated ${new Date().toISOString()} · Base ${BASE_URL} · Demo-Slug \`${DEMO_SLUG}\`_`);
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
  md.push('| # | Route | Final | Title | CTAs | Orient |');
  md.push('|---|---|---|---|---|---|');
  j.steps.forEach((s, i) => md.push(`| ${i+1} | \`${s.route}\` | ${s.final_url} | ${(s.title||'').slice(0,40) || '—'} | ${s.cta_count} | ${s.orientation_markers?.length || 0} |`));
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

const mdPath = path.join(OUT_DIR, 'journey-conversion-3_3.md');
fs.writeFileSync(mdPath, md.join('\n'));

console.log(`\n[kimi.3.3] DONE → ${mdPath}`);
console.log(`[kimi.3.3] journeys=${totals.journeys}  PASS=${totals.PASS} FAIL=${totals.FAIL} INCONS=${totals.INCONS}  P0=${totals.P0}  Trust=${totals.trust_score_pct}%  Journey=${totals.journey_score_pct}%`);
