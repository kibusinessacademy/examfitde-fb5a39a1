#!/usr/bin/env node
/**
 * verify-cloudflare-dns.mjs
 *
 * Verifies the Cloudflare DNS state for berufos.com after the cutover edits:
 *   - berufos.com A record points ONLY to Vercel (216.198.79.1)
 *   - Old Lovable A record (185.158.133.1) is gone
 *   - www.berufos.com CNAME resolves to vercel-dns
 *   - Apex + www respond over HTTPS (origin = Vercel, x-vercel-id present)
 *   - www → apex redirect (308/301)
 *
 * Polls multiple DoH resolvers (Cloudflare + Google) until propagation OR timeout.
 *
 * Usage:
 *   node scripts/seo/verify-cloudflare-dns.mjs
 *   node scripts/seo/verify-cloudflare-dns.mjs --interval=20 --max-minutes=30
 *
 * Exit codes:
 *   0 = all green
 *   1 = DNS propagated but HTTP/origin checks failed
 *   2 = DNS did not propagate within max-minutes
 */

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  }),
);

const APEX = 'berufos.com';
const WWW = 'www.berufos.com';
const VERCEL_IP = '216.198.79.1';
const LOVABLE_OLD_IP = '185.158.133.1';
const INTERVAL_S = Number(args.interval || 20);
const MAX_MIN = Number(args['max-minutes'] || 20);

const RESOLVERS = [
  { name: 'cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
  { name: 'google', url: 'https://dns.google/resolve' },
];

async function resolve(host, type) {
  const out = new Set();
  for (const r of RESOLVERS) {
    try {
      const res = await fetch(`${r.url}?name=${host}&type=${type}`, {
        headers: { accept: 'application/dns-json' },
      });
      if (!res.ok) continue;
      const j = await res.json();
      for (const a of j.Answer || []) out.add(a.data.replace(/\.$/, ''));
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

function line(ok, label, detail = '') {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function dnsPhase() {
  const deadline = Date.now() + MAX_MIN * 60_000;
  let attempt = 0;
  console.log(`\n▶ Phase 1 — DNS propagation (max ${MAX_MIN}min, every ${INTERVAL_S}s)\n`);

  while (Date.now() < deadline) {
    attempt++;
    const apexA = await resolve(APEX, 'A');
    const wwwCname = await resolve(WWW, 'CNAME');
    const wwwA = await resolve(WWW, 'A');

    const stamp = new Date().toISOString().slice(11, 19);
    const hasVercel = apexA.includes(VERCEL_IP);
    const hasOldLovable = apexA.includes(LOVABLE_OLD_IP);
    const onlyVercel = hasVercel && !hasOldLovable && apexA.length === 1;
    const wwwOnVercel =
      wwwCname.some((c) => c.includes('vercel-dns')) || wwwA.length > 0;

    console.log(
      `[${stamp}] try=${attempt}  apex=[${apexA.join(',') || '—'}]  www=[${
        wwwCname.join(',') || wwwA.join(',') || '—'
      }]`,
    );

    if (onlyVercel && wwwOnVercel) {
      console.log('\n✓ DNS state matches target\n');
      return { ok: true, apexA, wwwCname, wwwA };
    }
    if (hasOldLovable) {
      console.log(`  ⚠ Old Lovable A-record (${LOVABLE_OLD_IP}) still present — delete it in Cloudflare`);
    }
    if (!hasVercel) {
      console.log(`  ⚠ Vercel A-record (${VERCEL_IP}) not yet visible`);
    }

    await new Promise((res) => setTimeout(res, INTERVAL_S * 1000));
  }
  return { ok: false };
}

async function head(url) {
  const r = await fetch(url, { method: 'GET', redirect: 'manual' });
  return { status: r.status, headers: Object.fromEntries(r.headers.entries()) };
}

async function httpPhase() {
  console.log('▶ Phase 2 — HTTPS + Origin checks\n');
  const results = [];

  try {
    const apex = await head(`https://${APEX}/`);
    results.push(line(apex.status === 200, `Apex HTTPS 200`, `HTTP ${apex.status}`));
    results.push(
      line(
        !!apex.headers['x-vercel-id'],
        `Apex origin = Vercel (x-vercel-id)`,
        apex.headers['x-vercel-id'] || '(missing)',
      ),
    );
    // Proxy may be off (Nur DNS) — cf-ray is informational only.
    console.log(
      `  ℹ Cloudflare proxy: ${apex.headers['cf-ray'] ? 'on (cf-ray=' + apex.headers['cf-ray'] + ')' : 'off (Nur DNS)'}`,
    );
  } catch (e) {
    results.push(line(false, 'Apex HTTPS reachable', e.message));
  }

  try {
    const www = await head(`https://${WWW}/`);
    const isRedirect = www.status === 301 || www.status === 308;
    const locOk = (www.headers['location'] || '').includes('://berufos.com');
    results.push(
      line(
        isRedirect && locOk,
        `www → apex redirect`,
        `HTTP ${www.status} → ${www.headers['location'] || '(no location)'}`,
      ),
    );
  } catch (e) {
    results.push(line(false, 'www HTTPS reachable', e.message));
  }

  try {
    const deep = await head(`https://${APEX}/preise`);
    results.push(line(deep.status === 200, `Deep route /preise 200`, `HTTP ${deep.status}`));
  } catch (e) {
    results.push(line(false, 'Deep route reachable', e.message));
  }

  return results.every(Boolean);
}

console.log(`══ Cloudflare DNS Cutover Verify — ${new Date().toISOString()} ══`);

const dns = await dnsPhase();
if (!dns.ok) {
  console.error(`\n❌ TIMEOUT — DNS did not reach target state within ${MAX_MIN}min`);
  console.error(`   Required: apex A = [${VERCEL_IP}] (only), www CNAME = vercel-dns`);
  console.error(`   Fix in Cloudflare DNS panel, then re-run.`);
  process.exit(2);
}

const http = await httpPhase();
console.log('');
if (!http) {
  console.error('❌ DNS OK but HTTP/origin checks failed');
  console.error('   Check Vercel project: domain assigned to Production deployment?');
  process.exit(1);
}

console.log('🟢 ALL GREEN — Cloudflare cutover verified end-to-end.');
process.exit(0);
