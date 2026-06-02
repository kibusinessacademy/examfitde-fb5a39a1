/**
 * Sitemap — Static-Class lastmod + changefreq + priority Contract
 *
 * Verifiziert, dass die `generate-sitemap` Edge Function für den
 * `static`-Branch:
 *   1. /, /berufe und /preise mit korrektem Canonical (SITE_URL + Pfad) emittiert
 *   2. changefreq und priority pro Route trägt (kein pauschaler Default)
 *   3. Per-Route lastmod-Resolver nutzt (statt überall `today`)
 *   4. /preise an einen manuell gepflegten PRICING_LAST_UPDATED bindet
 *   5. /berufe lastmod von v_paket_sitemap_entries ableitet
 *   6. /  von Berufen + Blog die jüngste Änderung übernimmt
 *   7. Forbidden-Prefix-Filter weiterhin aktiv bleibt
 *
 * Reine File-Level-Contract-Tests (kein DB-/Netzwerk-Zugriff).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const FN = fs.readFileSync(
  path.join(process.cwd(), 'supabase/functions/generate-sitemap/index.ts'),
  'utf8',
);

function staticBranch(): string {
  const m = FN.match(/if \(action === "static"\)[\s\S]+?return xmlResponse\(toSitemapXML\(pages\), headers\);\s*\}/);
  expect(m, 'static branch present').toBeTruthy();
  return m![0];
}

describe('generate-sitemap — static class lastmod + changefreq + priority', () => {
  const branch = staticBranch();

  it('definiert resolveStaticLastmod als per-Route Resolver (statt pauschal today)', () => {
    expect(branch).toMatch(/function resolveStaticLastmod\(path: string\)/);
    // Default-Branch fällt auf today zurück, nicht alle Routen
    expect(branch).toMatch(/default: return today;/);
  });

  it('bindet /preise an einen manuell gepflegten PRICING_LAST_UPDATED', () => {
    expect(branch).toMatch(/const PRICING_LAST_UPDATED = "\d{4}-\d{2}-\d{2}"/);
    expect(branch).toMatch(/case "\/preise": return PRICING_LAST_UPDATED;/);
  });

  it('leitet /berufe lastmod von v_paket_sitemap_entries ab (MAX)', () => {
    expect(branch).toMatch(/v_paket_sitemap_entries/);
    expect(branch).toMatch(/order\("lastmod", \{ ascending: false \}\)\.limit\(1\)/);
    expect(branch).toMatch(/case "\/berufe":[\s\S]+?return berufeMax;/);
  });

  it('homepage / nimmt MAX(berufeMax, blogMax)', () => {
    expect(branch).toMatch(/const homeMax = \[berufeMax, blogMax\]\.sort\(\)\.reverse\(\)\[0\]/);
    expect(branch).toMatch(/case "\/": return homeMax;/);
  });

  it('emittiert /, /berufe und /preise im Fallback mit korrekten Canonicals + changefreq + priority', () => {
    // /
    expect(branch).toMatch(
      /\{ loc: `\$\{SITE_URL\}\/`, lastmod: resolveStaticLastmod\("\/"\), changefreq: "daily", priority: 1\.0 \}/,
    );
    // /berufe
    expect(branch).toMatch(
      /\{ loc: `\$\{SITE_URL\}\/berufe`, lastmod: resolveStaticLastmod\("\/berufe"\), changefreq: "weekly", priority: 0\.9 \}/,
    );
    // /preise
    expect(branch).toMatch(
      /\{ loc: `\$\{SITE_URL\}\/preise`, lastmod: resolveStaticLastmod\("\/preise"\), changefreq: "weekly", priority: 0\.95 \}/,
    );
  });

  it('SSOT-Branch (route_crawl_policy) trägt resolveStaticLastmod statt today', () => {
    expect(branch).toMatch(/lastmod: resolveStaticLastmod\(r\.pattern\)/);
    // sicherstellen, dass NICHT mehr pauschal `lastmod: today` im ssot-map vorkommt
    const ssotMap = branch.match(/const ssot: SitemapURL\[\] = [\s\S]+?\}\)\);/);
    expect(ssotMap, 'ssot map block').toBeTruthy();
    expect(ssotMap![0]).not.toMatch(/lastmod: today,/);
  });

  it('loggt class=static Anzahl + lastmod-Werte für Observability', () => {
    expect(branch).toMatch(/class=static count=/);
    expect(branch).toMatch(/home_lastmod=/);
    expect(branch).toMatch(/berufe_lastmod=/);
    expect(branch).toMatch(/preise_lastmod=/);
  });
});

describe('generate-sitemap — XML output contract (toSitemapXML)', () => {
  it('serialisiert changefreq und priority(1 Dezimalstelle) korrekt', () => {
    expect(FN).toMatch(/`    <changefreq>\$\{u\.changefreq\}<\/changefreq>\\n`/);
    expect(FN).toMatch(/priority\.toFixed\(1\)/);
  });

  it('forbidden-prefix-Filter bleibt aktiv', () => {
    expect(FN).toMatch(/SITEMAP_FORBIDDEN_PREFIXES/);
    expect(FN).toMatch(
      /function toSitemapXML\(urlsIn: SitemapURL\[\]\)[\s\S]+?urlsIn\.filter\(\(u\) => isAllowedSitemapPath/,
    );
  });

  it('static im Sitemap-Index referenziert wird', () => {
    const indexBranch = FN.match(/if \(action === "index"\)[\s\S]+?return xmlResponse\(toSitemapIndex/)![0];
    expect(indexBranch).toMatch(/type=static/);
    expect(indexBranch).toMatch(/type=berufe/);
  });
});
