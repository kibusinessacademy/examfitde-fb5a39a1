#!/usr/bin/env node
/**
 * SPA Fallback Smoke Test
 * ------------------------------------------------------------------
 * Verifies that:
 *   1. Known prerendered intent routes return 200 + intent-specific HTML
 *   2. SPA-only routes (e.g. /dashboard, /auth) return SPA shell (not pure 404 page)
 *   3. Truly unknown routes still serve SPA shell (React Router renders NotFound)
 *   4. www → apex redirects with 301/308
 *
 * Usage: HOST=https://examfit.pages.dev node scripts/seo/spa-fallback-smoke.mjs
 *        HOST=https://berufos.com         node scripts/seo/spa-fallback-smoke.mjs
 */

const HOST = process.env.HOST || 'https://examfit.pages.dev';
const SPA_MARKER = '<div id="root">'; // present in SPA shell
const FALLBACK_404_TITLE = '404 — Seite nicht gefunden'; // public/404.html title

const SPA_ROUTES = [
  '/dashboard',
  '/auth',
  '/account',
  '/this-route-definitely-does-not-exist-xyz789',
];

const PRERENDERED_PROBES = [
  // First intent route from build log; safe sample
  '/kurse/rahmenlehrplan-bauzeichner/intent_typische_fehler/lf01-k03-kommunikation-im-team-gestalten/',
];

let failures = 0;

async function probe(path, expect) {
  const url = `${HOST}${path}`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const body = await res.text();
    const hasSpaShell = body.includes(SPA_MARKER);
    const isStatic404Page = body.includes(FALLBACK_404_TITLE) && !hasSpaShell;

    let ok = true;
    const reasons = [];

    if (expect === 'prerendered') {
      if (res.status !== 200) { ok = false; reasons.push(`status=${res.status}≠200`); }
      if (isStatic404Page) { ok = false; reasons.push('served static 404.html'); }
      if (body.length < 5000) { ok = false; reasons.push(`body=${body.length}b too small`); }
    } else if (expect === 'spa') {
      // SPA fallback must serve the React shell — never the static 404 page.
      if (isStatic404Page) { ok = false; reasons.push('served static 404.html (SPA fallback broken)'); }
      if (!hasSpaShell) { ok = false; reasons.push('no <div id="root"> (no SPA shell)'); }
      // status may be 200 or 404 (CF serves 404.html with 404 status; that's fine
      // as long as the body is the SPA shell — React Router will render NotFound).
    }

    console.log(`  ${ok ? '✅' : '❌'} ${path} [${expect}] status=${res.status} ${reasons.join(', ')}`);
    if (!ok) failures++;
  } catch (e) {
    console.log(`  ❌ ${path} ERROR: ${e.message}`);
    failures++;
  }
}

async function checkWwwRedirect() {
  if (!/examfit\.de/.test(HOST)) return;
  const r = await fetch('https://berufos.com/', { redirect: 'manual' });
  const loc = r.headers.get('location') || '';
  const ok = (r.status === 301 || r.status === 308) && /^https:\/\/examfit\.de/.test(loc);
  console.log(`  ${ok ? '✅' : '❌'} www → apex status=${r.status} location=${loc}`);
  if (!ok) failures++;
}

console.log(`\n▶ SPA fallback smoke against ${HOST}\n`);
console.log('— Prerendered routes (must be 200 + per-route HTML):');
for (const p of PRERENDERED_PROBES) await probe(p, 'prerendered');
console.log('\n— SPA-only routes (must serve SPA shell, never static 404.html):');
for (const p of SPA_ROUTES) await probe(p, 'spa');
console.log('\n— www → apex redirect:');
await checkWwwRedirect();

console.log(`\n${failures === 0 ? '✅ SPA fallback green' : `❌ ${failures} failure(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
