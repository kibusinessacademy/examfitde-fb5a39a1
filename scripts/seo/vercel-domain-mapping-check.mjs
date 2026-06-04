#!/usr/bin/env node
/**
 * Vercel Domain Mapping Check
 * -----------------------------------------------------------------
 * Verifiziert die Soll-Zuordnung aus docs/runbooks/vercel-domain-mapping-ssot.md
 * und gibt einen Abgleich-Report aus.
 *
 * Soll:
 *   berufos.com         → 200, serves prerendered HTML (per-route title, body > 30 KB)
 *   www.berufos.com     → 308 → https://berufos.com
 *   examfit.de          → 308 → https://berufos.com
 *   www.examfit.de      → 308 → https://berufos.com
 *
 * Wenn berufos.com identische ~20 KB SPA-Shell auf /, /preise, /berufe liefert
 * → Diagnose: Prerender-Pipeline kommt nicht beim Live-Deployment an.
 *
 * Usage: node scripts/seo/vercel-domain-mapping-check.mjs
 * Exit 0 = ok, 1 = drift.
 */

const AUTHORITY = 'berufos.com';
const REDIRECT_TARGET = `https://${AUTHORITY}`;

const PROBES = [
  { host: 'berufos.com',     role: 'authority',         paths: ['/', '/preise', '/berufe'] },
  { host: 'www.berufos.com', role: 'authority-alias',   paths: ['/'] },
  { host: 'examfit.de',      role: 'legacy-redirect',   paths: ['/', '/preise'] },
  { host: 'www.examfit.de',  role: 'legacy-redirect',   paths: ['/'] },
];

const SPA_TITLE = 'ExamFit – KI-Prüfungstraining für IHK & AEVO';
const SPA_SHELL_SIZE_BAND = [20000, 21500]; // observed shell size

async function probe(host, path) {
  const url = `https://${host}${path}`;
  try {
    const r = await fetch(url, { redirect: 'manual' });
    const body = r.status >= 200 && r.status < 300 ? await r.text() : '';
    const m = body.match(/<title>([^<]*)<\/title>/i);
    return {
      url,
      status: r.status,
      size: body.length,
      title: m ? m[1].trim() : null,
      location: r.headers.get('location') || null,
      xVercelId: r.headers.get('x-vercel-id') || null,
      cfRay: r.headers.get('cf-ray') || null,
      server: r.headers.get('server') || null,
    };
  } catch (e) {
    return { url, error: e.message };
  }
}

function verdictAuthority(results) {
  // Authority must serve 200 with distinct per-route titles or distinct sizes.
  const ok200 = results.every((r) => r.status === 200);
  const titles = new Set(results.map((r) => r.title));
  const sizes = results.map((r) => r.size);
  const allShellSize = sizes.every((s) => s >= SPA_SHELL_SIZE_BAND[0] && s <= SPA_SHELL_SIZE_BAND[1]);
  const allSpaTitle = results.every((r) => r.title === SPA_TITLE);
  if (!ok200) return { ok: false, reason: 'non-200 on authority paths' };
  if (allShellSize && allSpaTitle && results.length > 1) {
    return { ok: false, reason: 'identical SPA shell on all paths — Prerender output NOT served' };
  }
  if (titles.size < results.length && results.length > 1) {
    return { ok: false, reason: `only ${titles.size} unique title(s) across ${results.length} routes` };
  }
  return { ok: true, reason: 'distinct per-route HTML served' };
}

function verdictRedirect(results, isAlias = false) {
  // www.berufos.com may also serve 200 if Vercel aliases it instead of redirecting.
  const r = results[0];
  const isRedirect = r.status === 301 || r.status === 308;
  const loc = (r.location || '').replace(/\/$/, '');
  const wantsTarget = loc.startsWith(REDIRECT_TARGET);
  if (isRedirect && wantsTarget) return { ok: true, reason: `→ ${r.location}` };
  if (isAlias && r.status === 200) return { ok: true, reason: 'served as alias (acceptable)' };
  return { ok: false, reason: `expected 308 → ${REDIRECT_TARGET}, got ${r.status}${r.location ? ` → ${r.location}` : ''}` };
}

console.log(`\n== Vercel Domain Mapping Check (${new Date().toISOString()}) ==\n`);

let drift = false;
for (const { host, role, paths } of PROBES) {
  console.log(`▶ ${host}  [${role}]`);
  const results = [];
  for (const p of paths) {
    const r = await probe(host, p);
    results.push(r);
    if (r.error) {
      console.log(`    ❌ ${p}  ERROR: ${r.error}`);
      continue;
    }
    const hdr = [
      r.xVercelId ? 'vercel' : null,
      r.cfRay ? 'cloudflare' : null,
      r.server ? `server=${r.server}` : null,
    ].filter(Boolean).join(' ');
    console.log(`    ${p}  ${r.status}  ${r.size}b  ${r.location ? `→ ${r.location}  ` : ''}[${hdr}]`);
    if (r.title) console.log(`         title: "${r.title}"`);
  }

  let v;
  if (role === 'authority') v = verdictAuthority(results);
  else if (role === 'authority-alias') v = verdictRedirect(results, true);
  else v = verdictRedirect(results, false);

  console.log(`    ${v.ok ? '✅' : '❌'} ${v.reason}\n`);
  if (!v.ok) drift = true;
}

if (drift) {
  console.log(`🔴 DRIFT — Vercel Dashboard Reconciliation Required:\n`);
  console.log(`  1. Vercel → Project → Settings → Domains`);
  console.log(`     - berufos.com MUST be assigned to the project that builds with seoPrerenderPlugin`);
  console.log(`     - berufos.com MUST point to the latest Production deployment (not an old alias)`);
  console.log(`  2. examfit.de + www.examfit.de → configure as "Redirect to https://berufos.com" (308)`);
  console.log(`  3. www.berufos.com → either 308 → apex OR Vercel alias of same project`);
  console.log(`  4. Cloudflare (if in front): DNS-only OR Page Rule /sitemaps/* → Supabase Edge Function`);
  console.log(`  5. Re-deploy Production → check build log for "Prerendered N routes"\n`);
  console.log(`  Full SSOT: docs/runbooks/vercel-domain-mapping-ssot.md\n`);
  process.exit(1);
}

console.log(`🟢 ALL GREEN — domain mapping matches SSOT\n`);
process.exit(0);
