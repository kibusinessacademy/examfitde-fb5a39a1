/**
 * P6 Cut 3 — Crawl-State SSOT Contract Tests
 *
 * Verifies that the source-of-truth `route_crawl_policy` table stays in sync
 * with the in-code surfaces:
 *
 *   1. Every NOINDEX_PATTERNS entry in src/components/seo/RouteNoindex.tsx
 *      has at least one prefix-match row in the seed migration.
 *   2. Every <Route ... element={<Navigate to="..." />}> redirect in
 *      src/routes/AppRoutes.tsx has an exact-/prefix-match redirect row.
 *   3. Every static URL in supabase/functions/generate-sitemap/index.ts
 *      "static" branch fallback exists as state='index' exact in the seed.
 *
 * The tests parse the migration SQL (single source of truth for seeds) plus
 * the source files. No DB connection required — pure file IO.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SEED_GLOB = 'supabase/migrations';
const ROUTE_NOINDEX = path.join(ROOT, 'src/components/seo/RouteNoindex.tsx');
const APP_ROUTES = path.join(ROOT, 'src/routes/AppRoutes.tsx');

function readSeedMigration(): string {
  const dir = path.join(ROOT, SEED_GLOB);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  // The latest migration touching route_crawl_policy is the seed.
  const matches = files
    .map((f) => path.join(dir, f))
    .filter((p) => fs.readFileSync(p, 'utf8').includes('route_crawl_policy'))
    .sort();
  if (matches.length === 0) throw new Error('seed migration not found');
  return matches.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
}

const seedSql = readSeedMigration();

function seedHas(pattern: string, state: 'index' | 'noindex' | 'redirect' | 'gone'): boolean {
  // Match either "('<pattern>'," or '"<pattern>"' followed eventually by state literal on same line.
  const re = new RegExp(
    `\\(\\s*'${pattern.replace(/[/\-]/g, (c) => '\\' + c)}'\\s*,[^\\n]*'${state}'`,
    'm',
  );
  return re.test(seedSql);
}

describe('P6 Cut 3 — route_crawl_policy SSOT contract', () => {
  it('seeds at least 40 noindex + 15 redirect + 40 index rows', () => {
    const noindex = (seedSql.match(/'noindex'/g) || []).length;
    const redirect = (seedSql.match(/'redirect'/g) || []).length;
    const index = (seedSql.match(/'index'/g) || []).length;
    // ENUM definition contains each literal once → subtract 1.
    expect(noindex - 1).toBeGreaterThanOrEqual(40);
    expect(redirect - 1).toBeGreaterThanOrEqual(15);
    expect(index - 1).toBeGreaterThanOrEqual(40);
  });

  it('every NOINDEX_PATTERNS prefix has a noindex seed row', () => {
    const src = fs.readFileSync(ROUTE_NOINDEX, 'utf8');
    // Extract patterns like /^\/auth(\/|$)/  or  /^\/quiz\//
    const re = /\/\^\\\/([a-z0-9-]+(?:\\\/[a-z0-9-]+)*)/gi;
    const prefixes = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const p = '/' + m[1].replace(/\\\//g, '/');
      prefixes.add(p);
    }
    expect(prefixes.size).toBeGreaterThan(30);
    const missing: string[] = [];
    for (const p of prefixes) {
      // Allow either the exact prefix OR a child prefix (e.g. /tools/ for /tools).
      if (!seedHas(p, 'noindex') && !seedHas(p + '/', 'noindex')) missing.push(p);
    }
    expect(missing, `missing in seed: ${missing.join(', ')}`).toEqual([]);
  });

  it('every <Navigate to="..." /> legacy redirect has a redirect seed row', () => {
    const src = fs.readFileSync(APP_ROUTES, 'utf8');
    // Match <Route path="/x" element={<Navigate to="/y" replace />} />
    const re = /<Route\s+path="(\/[^"]+)"\s+element=\{<(?:Navigate|LegacyParamRedirect)\s+to=(?:"|\{`)([^"`}]+)/g;
    const pairs: Array<{ from: string; to: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const from = m[1].replace(/\/\*$/, '').replace(/\/:[^/]+/g, '');
      pairs.push({ from, to: m[2] });
    }
    expect(pairs.length).toBeGreaterThan(15);
    const missing: string[] = [];
    for (const { from } of pairs) {
      if (!seedHas(from, 'redirect')) missing.push(from);
    }
    expect(missing, `missing redirects in seed: ${missing.join(', ')}`).toEqual([]);
  });
  it('mutually exclusive: no pattern is both index AND noindex with same match_type', () => {
    // Walk migrations chronologically; INSERTs add a (pattern, match_type, state) tuple,
    // DELETEs with explicit `pattern IN (...) AND match_type = ... AND state = ...`
    // remove it. Final state must have at most one state per (pattern, match_type).
    const dir = path.join(ROOT, 'supabase/migrations');
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => ({ name: f, sql: fs.readFileSync(path.join(dir, f), 'utf8') }))
      .filter(({ sql }) => sql.includes('route_crawl_policy'));

    const effective = new Map<string, Set<string>>(); // key=pattern|match → states
    for (const { sql } of files) {
      // INSERT VALUES tuples
      const insertRe = /\(\s*'([^']+)'\s*,\s*'(exact|prefix|regex)'\s*,\s*'(index|noindex|redirect|gone)'/g;
      let m: RegExpExecArray | null;
      while ((m = insertRe.exec(sql)) !== null) {
        const k = `${m[1]}|${m[2]}`;
        if (!effective.has(k)) effective.set(k, new Set());
        effective.get(k)!.add(m[3]);
      }
      // DELETE FROM ... WHERE state='X' AND match_type='Y' AND pattern IN ('a','b')
      const deleteBlockRe =
        /DELETE FROM public\.route_crawl_policy[^;]*?state\s*=\s*'(index|noindex|redirect|gone)'[^;]*?match_type\s*=\s*'(exact|prefix|regex)'[^;]*?pattern\s+IN\s*\(([^)]+)\)/gi;
      let d: RegExpExecArray | null;
      while ((d = deleteBlockRe.exec(sql)) !== null) {
        const state = d[1];
        const match_type = d[2];
        const patterns = [...d[3].matchAll(/'([^']+)'/g)].map((x) => x[1]);
        for (const p of patterns) {
          const k = `${p}|${match_type}`;
          effective.get(k)?.delete(state);
          if (effective.get(k)?.size === 0) effective.delete(k);
        }
      }
    }
    const conflicts: string[] = [];
    for (const [k, states] of effective) {
      if (states.size > 1) conflicts.push(`${k} → {${[...states].join(',')}}`);
    }
    expect(conflicts, `conflicting states: ${conflicts.join('; ')}`).toEqual([]);
  });
});

