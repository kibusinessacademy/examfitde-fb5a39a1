/**
 * P6 Cut 3b — Dynamic Sitemap Entity Integration Contract Tests
 *
 * Verifies:
 *   1. Pattern-Policies für die dynamischen SEO-Routenklassen sind seeded.
 *   2. Die Sitemap-Function filtert verbotene Pfade (Hard-Gate gegen Drift).
 *   3. /paket/:slug emission stützt sich auf v_paket_sitemap_entries (SSOT),
 *      nicht auf den vollen berufe-Bestand.
 *
 * Reine File-IO-Tests (kein DB-Zugriff).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SITEMAP_FN = path.join(ROOT, 'supabase/functions/generate-sitemap/index.ts');
const MIG_DIR = path.join(ROOT, 'supabase/migrations');

function migrationsConcat(): string {
  return fs
    .readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIG_DIR, f), 'utf8'))
    .join('\n');
}

describe('P6 Cut 3b — dynamic sitemap entity integration', () => {
  const sql = migrationsConcat();
  const fn = fs.readFileSync(SITEMAP_FN, 'utf8');

  it('seeds prefix=index policies for all dynamic SEO route classes', () => {
    const required = [
      '/paket/',
      '/blog/',
      '/wissen/',
      '/pruefungstraining/',
      '/berufe/',
      '/kurse/',
      '/ihk-pruefungen/',
      '/produkt/',
    ];
    const missing = required.filter(
      (p) =>
        !new RegExp(
          `\\('${p.replace(/\//g, '\\/')}'\\s*,\\s*'prefix'\\s*,\\s*'index'`,
          'm',
        ).test(sql),
    );
    expect(missing, `missing prefix=index seeds: ${missing.join(', ')}`).toEqual([]);
  });

  it('defines fn_resolve_route_crawl_state + v_paket_sitemap_entries', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_resolve_route_crawl_state/);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.v_paket_sitemap_entries/);
  });

  it('sitemap function uses v_paket_sitemap_entries (not full berufe-table) for /paket/', () => {
    expect(fn).toMatch(/v_paket_sitemap_entries/);
    // /paket/ must NOT be emitted unconditionally inside the berufe-loop
    const berufeLoop = fn.match(
      /if \(action === "berufe"\)[\s\S]+?return xmlResponse\(toSitemapXML\(urls\)/,
    );
    expect(berufeLoop, 'berufe branch present').toBeTruthy();
    const body = berufeLoop![0];
    // emission for /paket/ must be guarded by the published-packages view, not by the berufe-loop
    const inBerufeLoop = body.match(
      /for \(const b of berufe \|\| \[\]\) \{([\s\S]+?)\n\s*\}/,
    );
    expect(inBerufeLoop, 'berufe inner loop present').toBeTruthy();
    expect(inBerufeLoop![1]).not.toMatch(/\/paket\//);
  });

  it('sitemap function hard-blocks forbidden prefixes (defense-in-depth)', () => {
    expect(fn).toMatch(/SITEMAP_FORBIDDEN_PREFIXES/);
    expect(fn).toMatch(/isAllowedSitemapPath/);
    for (const p of [
      '"/products"',
      '"/product/"',
      '"/category/"',
      '"/learning/"',
      '"/dashboard"',
      '"/checkout"',
      '"/search"',
      '"/legal/"',
    ]) {
      expect(fn).toContain(p);
    }
  });

  it('toSitemapXML applies the forbidden-prefix filter before serialising', () => {
    expect(fn).toMatch(
      /function toSitemapXML\(urlsIn: SitemapURL\[\]\)[\s\S]+?urlsIn\.filter\(\(u\) => isAllowedSitemapPath/,
    );
  });
});
