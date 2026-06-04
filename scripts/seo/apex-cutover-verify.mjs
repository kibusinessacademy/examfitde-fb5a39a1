#!/usr/bin/env node
/**
 * Apex Cutover Verify — berufos.com
 *
 * Prüft nach DNS-Change am Apex (Cloudflare A/CNAME → Vercel), ob:
 *   1. Apex auflöst (DoH via 1.1.1.1)
 *   2. Apex NICHT mehr auf 185.158.133.1 (Lovable-Host alt) zeigt
 *   3. HTTPS Apex 200 OK liefert (kein 403)
 *   4. berufos.com 308/301 → https://berufos.com/
 *   5. Response-Header x-vercel-id präsent (Origin=Vercel)
 *   6. Cloudflare-Proxy aktiv (cf-ray header)
 *
 * Exit-Code 0 = grün, 1 = fail.
 *
 * SSOT: mem://constraints/hosting-and-seo-authority-topology-v1
 */
const APEX = 'berufos.com';
const WWW = 'berufos.com';
const LOVABLE_OLD_IP = '185.158.133.1';

async function doh(name, type = 'A') {
  const r = await fetch(`https://1.1.1.1/dns-query?name=${name}&type=${type}`, {
    headers: { accept: 'application/dns-json' },
  });
  const j = await r.json();
  return (j.Answer ?? []).map((a) => a.data);
}

async function head(url) {
  const r = await fetch(url, { method: 'GET', redirect: 'manual' });
  return { status: r.status, headers: Object.fromEntries(r.headers.entries()) };
}

function check(label, ok, detail) {
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

const results = [];
console.log(`\n== Apex Cutover Verify (${new Date().toISOString()}) ==\n`);

// 1. DNS Apex
const apexA = await doh(APEX, 'A');
results.push(check('Apex A-Record auflöst', apexA.length > 0, apexA.join(', ')));
results.push(
  check(
    'Apex zeigt NICHT mehr auf Lovable-Host (185.158.133.1)',
    !apexA.includes(LOVABLE_OLD_IP),
    apexA.includes(LOVABLE_OLD_IP) ? 'STILL ON LOVABLE — DNS not yet propagated' : 'OK'
  )
);

// 2. www DNS
const wwwCname = await doh(WWW, 'CNAME');
results.push(
  check(
    'www → Vercel CNAME',
    wwwCname.some((c) => c.includes('vercel-dns')),
    wwwCname.join(', ') || '(none)'
  )
);

// 3. Apex HTTPS
const apex = await head(`https://${APEX}/`);
results.push(check(`Apex HTTPS 200 OK (kein 403)`, apex.status === 200, `HTTP ${apex.status}`));
results.push(check('Apex: cf-ray header (Cloudflare-Proxy aktiv)', !!apex.headers['cf-ray'], apex.headers['cf-ray'] ?? '(missing)'));
results.push(check('Apex: x-vercel-id header (Origin=Vercel)', !!apex.headers['x-vercel-id'], apex.headers['x-vercel-id'] ?? '(missing)'));

// 4. www redirect
const www = await head(`https://${WWW}/`);
const isRedirect = www.status === 301 || www.status === 308;
const locOk = (www.headers['location'] || '').includes('://berufos.com');
results.push(check(`www → Apex redirect`, isRedirect && locOk, `HTTP ${www.status} → ${www.headers['location'] ?? '(no location)'}`));

// 5. Deep route smoke
const deep = await head(`https://${APEX}/aevo-pruefung`);
results.push(check('Deep route /aevo-pruefung 200 OK', deep.status === 200, `HTTP ${deep.status}`));

const failed = results.filter((r) => !r).length;
console.log(`\n${failed === 0 ? '🟢 ALL GREEN' : `🔴 ${failed} CHECK(S) FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
