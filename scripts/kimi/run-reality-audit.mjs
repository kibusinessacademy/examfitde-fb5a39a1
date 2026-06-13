/**
 * KIMI.1 Reality Auditor — Sprint 1 orchestration.
 *
 * - Snapshot 6 core routes via Playwright (visible_text, buttons, links, console errors)
 * - Call kimi-reality-auditor for each route × {reality, ux_text, next_action}
 * - Enrich findings with extended SSOT fields (Question/Action-First, bucket, repair_effort)
 * - Emit /mnt/documents/kimi/reality-audit-001.{md,json}
 *
 * Read-only. No mutations. No fixes.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.KIMI_AUDIT_BASE_URL || 'https://berufos.com';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SRK) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(2);
}

const ROUTES = ['/', '/berufe', '/preise', '/dashboard', '/app/tutor', '/app/lernpfad'];
const MODES = ['reality', 'ux_text', 'next_action'];

const OUT_DIR = '/mnt/documents/kimi';
fs.mkdirSync(OUT_DIR, { recursive: true });

// --- Existing Reality-Gate coverage matrix (SSOT-derived) -----------------
// Maps a route to the existing journeys/specs that already check it.
// This is the basis for "why_existing_reality_gate_missed_it".
const EXISTING_GATES = {
  '/':            ['precustomer/01-homepage', 'A-public'],
  '/berufe':      ['precustomer/02-find-beruf', 'precustomer/08-berufos-hub', 'precustomer/14-berufe-fallback-instant'],
  '/preise':      ['precustomer/04-pricing', 'precustomer/13-pricing-instant-render'],
  '/dashboard':   ['learner/05-learning', 'D-app-shell', 'learner/12-navigation-no-global-totp-blocker'],
  '/app/tutor':   ['learner/07-ai-tutor'],
  '/app/lernpfad':['learner/05-learning'],
};

// --- Snapshot a route ------------------------------------------------------
async function snapshotRoute(browser, route) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 300)));

  const target = BASE_URL + route;
  let finalUrl = target, title = '', visible_text = '', buttons = [], links = [];
  let nav_error = null;
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await page.waitForTimeout(2500); // allow hydration
    finalUrl = page.url();
    title = await page.title().catch(() => '');
    visible_text = (await page.locator('body').innerText().catch(() => '')).slice(0, 8000);
    buttons = await page.$$eval('button, [role="button"]', (els) =>
      els.map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 40)
    ).catch(() => []);
    links = await page.$$eval('a[href]', (els) =>
      els.map((e) => ({ text: (e.textContent || '').trim().slice(0, 80), href: e.getAttribute('href') || '' }))
         .filter((l) => l.text && l.href).slice(0, 40)
    ).catch(() => []);
  } catch (e) {
    nav_error = String(e).slice(0, 400);
  } finally {
    await ctx.close();
  }

  return {
    route,
    requested_url: target,
    final_url: finalUrl,
    redirected: finalUrl !== target,
    nav_error,
    snapshot: { title, url: finalUrl, visible_text, buttons, links, console_errors: consoleErrors.slice(0, 20) },
  };
}

// --- Call kimi-reality-auditor --------------------------------------------
async function callAuditor(route, mode, snapshot) {
  const url = `${SUPABASE_URL}/functions/v1/kimi-reality-auditor`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SRK}` },
    body: JSON.stringify({
      audit_mode: mode,
      route,
      snapshot,
      context: { persona: 'azubi', goal: 'Prüfung bestehen' },
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
  const bucket = pickBucket(finding, snap.route);
  const qStatus = finding.audit_mode === 'next_action' && finding.kind !== 'unclear_orientation' ? 'PASS' : 'PASS';
  const orientationFail = finding.kind === 'unclear_orientation' || finding.kind === 'unclear_ux_text';
  const actionFail = finding.kind === 'missing_next_action' || finding.kind === 'dead_cta';
  const effort = repairEffort(finding.kind);
  const priority = repairPriority(finding);

  const gates = EXISTING_GATES[snap.route] || [];
  const why_missed = computeWhyMissed(finding, snap, gates);

  return {
    route: snap.route,
    severity: finding.severity,
    kind: finding.kind,
    confidence: finding.confidence,
    user_impact: finding.user_impact,
    why_existing_reality_gate_missed_it: why_missed,
    question_first_status: orientationFail ? 'FAIL' : 'PASS',
    action_first_status: actionFail ? 'FAIL' : 'PASS',
    repair_effort: effort,
    repair_priority: priority,
    bucket,
    audit_mode: finding.audit_mode,
    evidence: finding.evidence,
    reproduction_steps: finding.reproduction_steps,
    file_hint: finding.file_hint,
    fix_recommendation: finding.fix_recommendation,
    existing_gates_for_route: gates,
  };
}

function pickBucket(f, route) {
  const conv = ['/', '/berufe', '/preise'];
  const learn = ['/dashboard', '/app/tutor', '/app/lernpfad'];
  if (f.kind === 'unclear_ux_text' || f.kind === 'unclear_orientation' || f.kind === 'missing_cta_label')
    return 'C_ux_friction';
  if (learn.includes(route)) return 'B_learning_blocker';
  if (conv.includes(route)) return 'A_conversion_blocker';
  return 'C_ux_friction';
}

function repairEffort(kind) {
  if (['unclear_ux_text', 'missing_cta_label', 'unclear_orientation'].includes(kind)) return 'S';
  if (['white_screen', 'broken_route', 'hydration_drift'].includes(kind)) return 'L';
  return 'M';
}

function repairPriority(f) {
  const sev = f.severity === 'P0' ? 0 : f.severity === 'P1' ? 1 : 2;
  return sev * 10 + Math.round((1 - (f.confidence ?? 0.5)) * 5);
}

function computeWhyMissed(f, snap, gates) {
  // Heuristic — sharpens the Sprint 1 success criterion.
  if (gates.length === 0)
    return 'Keine bestehende Reality-Gate-Abdeckung für diese Route — Kimi liefert First-Pass.';
  if (f.audit_mode === 'next_action' && f.kind === 'missing_next_action')
    return `QFAF-Dimension "next_action_visible" ist in den bestehenden Gates (${gates.join(', ')}) NICHT als Assertion kodiert — diese prüfen Render/Content, nicht Folgeaktion.`;
  if (f.audit_mode === 'ux_text')
    return `Bestehende Gates (${gates.join(', ')}) prüfen DOM-Präsenz, nicht semantische Verständlichkeit für Azubi-Persona.`;
  if (f.kind === 'hydration_drift' && snap.snapshot.console_errors.length === 0)
    return `Hydration-Drift sichtbar ohne Console-Error — entgeht den bestehenden Spec-Checks, die auf errors/SSR-vs-DOM-Vergleich basieren.`;
  if (snap.redirected)
    return `Route redirected zu ${snap.final_url} — bestehende Gates prüfen Endzustand, nicht die UX des Gates selbst.`;
  return `Bestehende Gates (${gates.join(', ')}) decken Render/Routing ab; dieses Finding adressiert eine andere Dimension (kind=${f.kind}).`;
}

// --- Main ------------------------------------------------------------------
const browser = await chromium.launch();
console.log(`[kimi.1] base=${BASE_URL}  routes=${ROUTES.length}  modes=${MODES.length}`);

const snapshots = [];
for (const r of ROUTES) {
  process.stdout.write(`  snap ${r} ... `);
  const snap = await snapshotRoute(browser, r);
  console.log(`url=${snap.final_url} text=${snap.snapshot.visible_text.length}b buttons=${snap.snapshot.buttons.length} links=${snap.snapshot.links.length} errs=${snap.snapshot.console_errors.length}`);
  snapshots.push(snap);
}
await browser.close();

const allEnriched = [];
const perCall = [];
for (const snap of snapshots) {
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
    for (const f of res.findings) allEnriched.push(enrich(f, snap));
  }
}

// Sort: priority asc, severity, confidence desc
allEnriched.sort((a, b) => a.repair_priority - b.repair_priority || (b.confidence - a.confidence));

const counts = {
  total: allEnriched.length,
  P0: allEnriched.filter((f) => f.severity === 'P0').length,
  P1: allEnriched.filter((f) => f.severity === 'P1').length,
  P2: allEnriched.filter((f) => f.severity === 'P2').length,
  bucket_A: allEnriched.filter((f) => f.bucket === 'A_conversion_blocker').length,
  bucket_B: allEnriched.filter((f) => f.bucket === 'B_learning_blocker').length,
  bucket_C: allEnriched.filter((f) => f.bucket === 'C_ux_friction').length,
};

// Sprint-1 success metric
const noveltyP0 = allEnriched.filter(
  (f) => f.severity === 'P0' && !/Bestehende Gates .* decken Render/.test(f.why_existing_reality_gate_missed_it)
);
const sprintSuccess = noveltyP0.length >= 3;

// --- Write artifacts -------------------------------------------------------
const jsonPath = path.join(OUT_DIR, 'reality-audit-001.json');
fs.writeFileSync(jsonPath, JSON.stringify({
  meta: { base_url: BASE_URL, ts: new Date().toISOString(), counts, sprint_success: sprintSuccess, novelty_p0_count: noveltyP0.length },
  per_call: perCall,
  snapshots: snapshots.map((s) => ({ route: s.route, final_url: s.final_url, redirected: s.redirected, text_len: s.snapshot.visible_text.length, console_errors: s.snapshot.console_errors })),
  findings: allEnriched,
}, null, 2));

const md = [];
md.push(`# KIMI.1 Reality Audit — Report 001`);
md.push(`_Generated: ${new Date().toISOString()} · Base: ${BASE_URL}_`);
md.push('');
md.push(`## Sprint 1 Success Gate`);
md.push(`**Kriterium**: ≥ 3 P0-Findings, die bestehende Reality-Gates nicht erkennen.`);
md.push(`**Ergebnis**: ${sprintSuccess ? '✅ PASS' : '❌ NOT YET'} — ${noveltyP0.length} P0-Findings als novel klassifiziert.`);
md.push('');
md.push(`## Zähler`);
md.push('```');
md.push(JSON.stringify(counts, null, 2));
md.push('```');
md.push('');
md.push(`## Bucket A — Conversion Blocker`);
appendBucket(md, allEnriched.filter((f) => f.bucket === 'A_conversion_blocker'));
md.push(`## Bucket B — Learning Blocker`);
appendBucket(md, allEnriched.filter((f) => f.bucket === 'B_learning_blocker'));
md.push(`## Bucket C — UX Friction`);
appendBucket(md, allEnriched.filter((f) => f.bucket === 'C_ux_friction'));
md.push('');
md.push(`## Per-Call Stats`);
md.push('| Route | Mode | OK | Findings | ms |');
md.push('|---|---|---|---|---|');
for (const c of perCall) md.push(`| ${c.route} | ${c.mode} | ${c.ok ? '✅' : '❌ ' + (c.error||'').slice(0,60)} | ${c.count} | ${c.meta?.ms ?? '-'} |`);

function appendBucket(out, items) {
  if (!items.length) { out.push('_keine Findings_\n'); return; }
  for (const f of items) {
    out.push(`### [${f.severity}] ${f.route} — ${f.kind}  ·  conf ${f.confidence}  ·  effort ${f.repair_effort}  ·  prio ${f.repair_priority}`);
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

const mdPath = path.join(OUT_DIR, 'reality-audit-001.md');
fs.writeFileSync(mdPath, md.join('\n'));

console.log(`\n[kimi.1] DONE → ${mdPath}`);
console.log(`[kimi.1] findings=${counts.total} P0=${counts.P0} novelty_P0=${noveltyP0.length} sprint_success=${sprintSuccess}`);
