#!/usr/bin/env node
/**
 * Pre-deploy Robots.txt + Sitemap robustness check.
 *
 * Verifies per-environment that:
 *   1. robots.txt is reachable and contains a `Sitemap:` directive
 *   2. The advertised sitemap URL resolves and is valid XML
 *   3. The sitemap-index references the expected sub-sitemaps
 *   4. No `Disallow: /` (full-site block) is present in production envs
 *
 * Usage:
 *   node scripts/verify-sitemap-robots.mjs [origin]
 *
 * Default origin: https://berufos.com
 * Exits non-zero on any failure so CI/pre-deploy gates fail fast.
 */

const ORIGIN = process.argv[2] || process.env.VERIFY_ORIGIN || 'https://berufos.com';
const SUPABASE_FN = 'https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/generate-sitemap';
const EXPECTED_SITEMAPS = ['static', 'berufe', 'blog', 'landing', 'products', 'content'];

const errors = [];
const warnings = [];

async function fetchText(url, label) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} for ${url}`);
  return res.text();
}

async function main() {
  console.log(`[verify-sitemap-robots] origin=${ORIGIN}`);

  // 1. robots.txt — prefer site-served, fall back to function
  let robots;
  try {
    robots = await fetchText(`${ORIGIN}/robots.txt`, 'robots.txt');
    console.log(`  ✓ robots.txt fetched (${robots.length} bytes)`);
  } catch (e) {
    warnings.push(`robots.txt not served at ${ORIGIN}/robots.txt — falling back to edge function`);
    robots = await fetchText(`${SUPABASE_FN}?type=robots`, 'robots (edge)');
  }

  const sitemapLine = robots.split('\n').find((l) => /^sitemap:/i.test(l.trim()));
  if (!sitemapLine) errors.push('robots.txt has no Sitemap: directive');
  else console.log(`  ✓ Sitemap directive: ${sitemapLine.trim()}`);

  if (/^\s*disallow:\s*\/\s*$/im.test(robots) && !/staging|preview|lovable\.app/i.test(ORIGIN)) {
    errors.push(`robots.txt blocks the entire site (Disallow: /) on production-like origin ${ORIGIN}`);
  }

  // 2. Sitemap index
  const indexUrl = sitemapLine ? sitemapLine.replace(/^sitemap:\s*/i, '').trim() : `${SUPABASE_FN}?type=index`;
  const indexXml = await fetchText(indexUrl, 'sitemap index');
  if (!/<sitemapindex/i.test(indexXml)) errors.push(`Sitemap index is not a valid <sitemapindex>: ${indexUrl}`);
  else console.log(`  ✓ Sitemap index OK (${indexXml.length} bytes)`);

  for (const expected of EXPECTED_SITEMAPS) {
    if (!indexXml.includes(`type=${expected}`)) {
      errors.push(`Sitemap index missing expected sub-sitemap: type=${expected}`);
    }
  }

  // 3. Sub-sitemaps reachable & valid
  for (const t of EXPECTED_SITEMAPS) {
    try {
      const xml = await fetchText(`${SUPABASE_FN}?type=${t}`, `sitemap:${t}`);
      if (!/<urlset/i.test(xml)) errors.push(`Sub-sitemap ${t} is not a valid <urlset>`);
      const urlCount = (xml.match(/<url>/g) || []).length;
      if (urlCount === 0) warnings.push(`Sub-sitemap ${t} has 0 <url> entries`);
      console.log(`  ✓ ${t}: ${urlCount} URLs`);
    } catch (e) {
      errors.push(`Sub-sitemap ${t} fetch failed: ${e.message}`);
    }
  }

  // Report
  if (warnings.length) {
    console.warn('\nWARNINGS:');
    warnings.forEach((w) => console.warn(`  ! ${w}`));
  }
  if (errors.length) {
    console.error('\nFAILURES:');
    errors.forEach((e) => console.error(`  ✗ ${e}`));
    process.exit(1);
  }
  console.log('\n✓ Robots + Sitemap robustness check passed.');
}

main().catch((e) => {
  console.error(`[verify-sitemap-robots] fatal: ${e.message}`);
  process.exit(2);
});
