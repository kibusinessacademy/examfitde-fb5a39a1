#!/usr/bin/env node
/**
 * P7 — BerufOS.com GSC Onboarding (post-publish runner)
 *
 * Reihenfolge:
 *  1. Verify META-Tag (Token bereits in index.html eingebaut)
 *  2. Site zu Search Console hinzufügen
 *  3. Sitemap submitten
 *
 * Voraussetzung: index.html mit dem aktuellen Token ist LIVE auf
 * https://berufos.com/ (DNS auf Lovable/Vercel, Publish gemacht).
 *
 * Env: LOVABLE_API_KEY, GOOGLE_SEARCH_CONSOLE_API_KEY
 */
const BASE = 'https://connector-gateway.lovable.dev/google_search_console';
const SITE = 'https://berufos.com/';
const SITEMAP = 'https://berufos.com/sitemap.xml';

const headers = {
  Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
  'X-Connection-Api-Key': process.env.GOOGLE_SEARCH_CONSOLE_API_KEY,
  'Content-Type': 'application/json',
};

async function step(name, fn) {
  process.stdout.write(`▶ ${name} … `);
  try {
    const res = await fn();
    console.log('OK', res ? JSON.stringify(res) : '');
  } catch (e) {
    console.log('FAIL', e.message);
    process.exitCode = 1;
  }
}

await step('verify META', async () => {
  const r = await fetch(
    `${BASE}/siteVerification/v1/webResource?verificationMethod=META`,
    { method: 'POST', headers, body: JSON.stringify({ site: { identifier: SITE, type: 'SITE' } }) },
  );
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j;
});

await step('add GSC site', async () => {
  const r = await fetch(`${BASE}/webmasters/v3/sites/${encodeURIComponent(SITE)}`, {
    method: 'PUT', headers,
  });
  if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
  return { added: SITE };
});

await step('submit sitemap', async () => {
  const r = await fetch(
    `${BASE}/webmasters/v3/sites/${encodeURIComponent(SITE)}/sitemaps/${encodeURIComponent(SITEMAP)}`,
    { method: 'PUT', headers },
  );
  if (!r.ok && r.status !== 204) throw new Error(`HTTP ${r.status}`);
  return { submitted: SITEMAP };
});

console.log('\n✓ done.');
