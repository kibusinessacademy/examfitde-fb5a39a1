#!/usr/bin/env node
/**
 * Verify Prerender Output
 * ----------------------------------------------------------------
 * Runs AFTER `npm run build`. Asserts that:
 *   1. dist/index.html exists (SPA shell)
 *   2. At least N per-route HTML files exist under dist/<route>/index.html
 *   3. Sample per-route HTMLs differ from dist/index.html
 *      (canonical, title, or <h1> must be route-specific)
 *   4. Sitemap-only routes (DB-driven, per memory
 *      `sitemap-only-mode-for-db-routes-v1`) have NO per-route HTML
 *      and their sitemap shard is referenced in dist/sitemap.xml.
 *
 * Exits non-zero on any failure → blocks CI merge to main and
 * prevents a broken Vercel deploy.
 *
 * Usage: node scripts/seo/verify-prerender-output.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const DIST = resolve(process.cwd(), 'dist');
const MIN_PRERENDERED_ROUTES = parseInt(process.env.MIN_PRERENDERED || '20', 10);

// Routes that MUST be prerendered as dist/<slug>/index.html with
// route-specific title/canonical. Keep aligned with src/content/seoRoutes.ts.
const SAMPLE_PROBE_ROUTES = [
  'fiae-pruefungsvorbereitung',
  'bilanzbuchhalter-pruefungsvorbereitung',
  'pruefungstraining-azubis',
  'preise',
];

// Sitemap-only routes: DB-driven category/listing pages that are intentionally
// NOT prerendered (memory `sitemap-only-mode-for-db-routes-v1`). The build
// must NOT produce dist/<slug>/index.html for these — Vercel rewrites to the
// SPA shell at request time. Each entry's sitemap shard must be referenced
// in dist/sitemap.xml (the sitemap-index).
const SITEMAP_ONLY_ROUTES = [
  { slug: 'berufe', sitemapShard: 'berufe' },
];

let failures = 0;
const log = (ok, msg) => {
  console.log(`  ${ok ? '✅' : '❌'} ${msg}`);
  if (!ok) failures++;
};

console.log('\n▶ Verify Prerender Output\n');

// ── 1. dist/index.html exists ──
const shellPath = join(DIST, 'index.html');
log(existsSync(shellPath), `dist/index.html present`);
const shellHtml = existsSync(shellPath) ? readFileSync(shellPath, 'utf8') : '';

// ── 2. Count per-route HTML files (dist/<slug>/index.html, recursive) ──
function countRouteHtmls(dir, depth = 0) {
  if (depth > 6) return 0;
  let n = 0;
  for (const entry of readdirSync(dir)) {
    if (entry === 'assets' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      const idx = join(full, 'index.html');
      if (existsSync(idx) && statSync(idx).isFile()) n++;
      n += countRouteHtmls(full, depth + 1);
    }
  }
  return n;
}
const routeCount = existsSync(DIST) ? countRouteHtmls(DIST) : 0;
log(
  routeCount >= MIN_PRERENDERED_ROUTES,
  `per-route HTMLs: ${routeCount} (min ${MIN_PRERENDERED_ROUTES})`,
);

// ── 3. Sample probes: per-route HTML must differ from shell ──
const extractTitle = (h) => (h.match(/<title>([^<]*)<\/title>/i) || [, ''])[1].trim();
const extractCanonical = (h) =>
  (h.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) || [, ''])[1].trim();

const shellTitle = extractTitle(shellHtml);
const shellCanonical = extractCanonical(shellHtml);

let probedAny = false;
for (const slug of SAMPLE_PROBE_ROUTES) {
  const p = join(DIST, slug, 'index.html');
  if (!existsSync(p)) {
    log(false, `sample route /${slug} → no dist/${slug}/index.html (Prerender ran but skipped this slug?)`);
    continue;
  }
  probedAny = true;
  const html = readFileSync(p, 'utf8');
  const t = extractTitle(html);
  const c = extractCanonical(html);
  const titleDiffers = t && t !== shellTitle;
  const canonicalDiffers = c && c !== shellCanonical && c.includes(slug);
  log(
    titleDiffers || canonicalDiffers,
    `/${slug} title="${t.slice(0, 60)}" canonical="${c}"`,
  );
}
if (!probedAny) {
  log(false, 'no sample probe routes were prerendered — Prerender output looks empty');
}

// ── 4. Sitemap-only routes: must NOT have per-route HTML, MUST be in sitemap-index ──
console.log('\n▶ Sitemap-only routes (DB-driven, no per-route HTML by design)');
const sitemapPath = join(DIST, 'sitemap.xml');
const sitemapXml = existsSync(sitemapPath) ? readFileSync(sitemapPath, 'utf8') : '';
log(sitemapXml.length > 0, `dist/sitemap.xml present (${sitemapXml.length} bytes)`);

for (const { slug, sitemapShard } of SITEMAP_ONLY_ROUTES) {
  const htmlPath = join(DIST, slug, 'index.html');
  log(
    !existsSync(htmlPath),
    `/${slug} → no dist/${slug}/index.html (sitemap-only, must be absent)`,
  );
  // Sitemap shard is referenced as ?type=<shard> in the sitemap-index.
  const shardRef = `type=${sitemapShard}`;
  log(
    sitemapXml.includes(shardRef),
    `/${slug} → sitemap shard "${shardRef}" referenced in sitemap-index`,
  );
}



console.log(
  `\n${failures === 0 ? '✅ Prerender output verified' : `❌ ${failures} failure(s)`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
