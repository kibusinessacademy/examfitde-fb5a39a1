#!/usr/bin/env node
/**
 * Active Shadow Verification — synthetic technical smoke against examfit.pages.dev
 *
 * Runs 7 hard-check categories:
 *   1. JS-disabled raw HTML (H1, FAQ, content)
 *   2. curl/meta integrity (title/desc/canonical/JSON-LD/H1)
 *   3. Social preview tags (og:title, og:description, og:image, twitter:card)
 *   4. Rich Results signals (Article + FAQ + Breadcrumb JSON-LD presence)
 *   5. True-404 behaviour on /random-nonexistent-page-<rand>
 *   6. Mobile viewport meta + no inline hydration error markers
 *   7. RPC smoke — supabase/rest reachable from each route
 *
 * Usage: HOST=https://examfit.pages.dev node scripts/seo/active-shadow-verify.mjs
 *        SAMPLE=5 to override sample size
 */
const HOST = (process.env.HOST || 'https://examfit.pages.dev').replace(/\/$/, '');
const SAMPLE = Number(process.env.SAMPLE || 5);

// Discover prerendered routes from the local dist/ if available, else fallback set.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function discoverRoutes() {
  const dist = 'dist/kurse';
  if (!existsSync(dist)) {
    return [
      '/kurse/bilanzbuchhalter',
      '/kurse/fachinformatiker-systemintegration',
      '/kurse/fachinformatiker-anwendungsentwicklung',
      '/kurse/industriekaufmann',
      '/kurse/aevo',
    ];
  }
  const out = [];
  function walk(dir, prefix) {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const s = statSync(p);
      if (s.isDirectory()) walk(p, `${prefix}/${e}`);
      else if (e === 'index.html') out.push(prefix);
    }
  }
  walk(dist, '/kurse');
  return out;
}

const ALL = discoverRoutes();
const ROUTES = ALL.sort(() => Math.random() - 0.5).slice(0, SAMPLE);

const fmt = (ok) => (ok ? '✅' : '❌');
const results = [];

async function fetchText(url, init = {}) {
  const r = await fetch(url, { redirect: 'follow', ...init });
  const text = await r.text().catch(() => '');
  return { status: r.status, headers: Object.fromEntries(r.headers), text, finalUrl: r.url };
}

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${fmt(ok)} ${name}${detail ? ' — ' + detail : ''}`);
  return ok;
}

async function verifyRoute(path) {
  console.log(`\n▶ ${path}`);
  const { status, headers, text } = await fetchText(HOST + path);

  // 1. JS-disabled / raw HTML — H1 + FAQ + meaningful content
  check('1.1 HTTP 200', status === 200, `status=${status}`);
  check('1.2 H1 present in raw HTML', /<h1[^>]*>[^<]{3,}/i.test(text));
  check('1.3 Body content > 5kb (not empty SPA shell)', text.length > 5000, `${text.length}b`);
  const hasFaq = /faq|frage|frequently/i.test(text);
  check('1.4 FAQ-ish content present', hasFaq);

  // 2. Meta integrity
  const title = (text.match(/<title>([^<]+)<\/title>/i) || [])[1] || '';
  const desc = (text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) || [])[1] || '';
  const canonical = (text.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i) || [])[1] || '';
  check('2.1 <title> present & route-specific', title.length > 10 && !/^Examfit$/i.test(title), title.slice(0, 60));
  check('2.2 meta description ≥ 80', desc.length >= 80, `${desc.length} chars`);
  check('2.3 canonical present', /^https:\/\//.test(canonical), canonical);

  // 3. Social tags
  const og = (k) => (text.match(new RegExp(`<meta[^>]+property=["']og:${k}["'][^>]+content=["']([^"']+)`, 'i')) || [])[1] || '';
  const tw = (k) => (text.match(new RegExp(`<meta[^>]+name=["']twitter:${k}["'][^>]+content=["']([^"']+)`, 'i')) || [])[1] || '';
  check('3.1 og:title', !!og('title'), og('title').slice(0, 50));
  check('3.2 og:description', !!og('description'));
  check('3.3 og:image', /^https?:\/\//.test(og('image')), og('image'));
  check('3.4 twitter:card', !!tw('card'));

  // 4. Rich Results — Article / FAQ / Breadcrumb JSON-LD
  const jsonLdBlocks = [...text.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const types = new Set();
  for (const b of jsonLdBlocks) {
    try {
      const j = JSON.parse(b);
      const collect = (n) => { if (n && n['@type']) types.add(String(n['@type'])); };
      if (Array.isArray(j)) j.forEach(collect); else collect(j);
      if (j['@graph']) j['@graph'].forEach(collect);
    } catch {}
  }
  check('4.1 Article JSON-LD', [...types].some(t => /Article|Course|Product/.test(t)), [...types].join(','));
  check('4.2 BreadcrumbList JSON-LD', types.has('BreadcrumbList'));
  check('4.3 FAQPage JSON-LD', types.has('FAQPage'));

  // 6. Mobile viewport
  check('6.1 viewport meta', /<meta[^>]+name=["']viewport["']/i.test(text));
  check('6.2 no inline hydration error markers', !/Hydration failed|did not match/i.test(text));

  // X-Robots noindex sanity (must NOT be set on prerendered routes)
  const xr = headers['x-robots-tag'] || '';
  check('canonical-route NOT noindex', !/noindex/i.test(xr), `x-robots="${xr}"`);

  return { path, ok: results.filter(r => r.name.startsWith(path)).every(r => r.ok) };
}

async function verify404() {
  console.log(`\n▶ TRUE-404 CHECK`);
  const rand = `/this-route-does-not-exist-${Math.random().toString(36).slice(2)}`;
  const { status, text, headers } = await fetchText(HOST + rand, { redirect: 'manual' });
  check('5.1 Status === 404', status === 404, `got ${status}`);
  check('5.2 noindex on 404', /noindex/i.test(text + (headers['x-robots-tag'] || '')));
}

async function verifySitemap() {
  console.log(`\n▶ SITEMAP REACHABILITY`);
  const { status, text } = await fetchText(HOST + '/sitemap.xml');
  check('S.1 sitemap 200', status === 200);
  check('S.2 sitemap is valid XML', text.startsWith('<?xml') && /<urlset|<sitemapindex/.test(text));
  const urls = (text.match(/<loc>/g) || []).length;
  check('S.3 sitemap urls > 100', urls > 100, `${urls} urls`);
}

async function verifyRpc() {
  console.log(`\n▶ RPC SMOKE (anon REST reachability)`);
  const url = 'https://ubdvvvsiryenhrfmqsvw.supabase.co/rest/v1/curricula?select=id&limit=1';
  const t0 = Date.now();
  const r = await fetch(url, {
    headers: {
      apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViZHZ2dnNpcnllbmhyZm1xc3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NDA4MjgsImV4cCI6MjA4MzAxNjgyOH0.LGMpcVQMXziF3Zal4SoprwQj6KfNyqjVJXDXEh3pAEc',
    },
  });
  const dt = Date.now() - t0;
  check('R.1 REST 200', r.status === 200, `${dt}ms`);
  check('R.2 latency < 600ms', dt < 600, `${dt}ms`);
}

(async () => {
  console.log(`Active Shadow Verify @ ${HOST}`);
  console.log(`Sample: ${ROUTES.length}/${ALL.length} routes`);
  for (const p of ROUTES) await verifyRoute(p);
  await verify404();
  await verifySitemap();
  await verifyRpc();

  const total = results.length;
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  console.log(`\n══════════════════════════════════════════`);
  console.log(`SCORE: ${passed}/${total} (${Math.round(100 * passed / total)}%)`);
  if (failed.length) {
    console.log(`\nFAIL DETAIL:`);
    for (const f of failed) console.log(`  ❌ ${f.name} — ${f.detail}`);
  }
  const verdict = failed.length === 0 ? 'GO_DOMAIN_MIGRATION'
    : failed.length <= 2 ? 'GO_WITH_KNOWN_DRIFT'
    : 'NO_GO';
  console.log(`\nVerdict: ${verdict}`);
  process.exit(verdict === 'NO_GO' ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
