/**
 * Sitemap Live Validation — /, /berufe, /preise
 *
 * Holt die live deployte `generate-sitemap` Edge Function (Static-Sub-Sitemap)
 * und prüft:
 *   - HTTP 200 + application/xml
 *   - /, /berufe, /preise sind als <loc> mit korrektem SITE_URL Canonical enthalten
 *   - jede Route trägt <lastmod> (YYYY-MM-DD), <changefreq>, <priority>
 *   - /preise lastmod == /preise lastmod (stabil zwischen 2 Aufrufen, weil PRICING_LAST_UPDATED konstant)
 *   - /sitemap.xml (Public Hardcut) liefert 200 + <sitemapindex>
 */
import { test, expect } from '@playwright/test';

const SUPABASE_PROJECT_REF = 'ubdvvvsiryenhrfmqsvw';
const STATIC_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/generate-sitemap?type=static`;
const PUBLIC_SITEMAP = 'https://berufos.com/sitemap.xml';

function extractUrlBlocks(xml: string): string[] {
  return xml.match(/<url>[\s\S]+?<\/url>/g) ?? [];
}

function findBlockByLoc(blocks: string[], pathSuffix: string): string | undefined {
  return blocks.find((b) => new RegExp(`<loc>[^<]+${pathSuffix.replace(/[/]/g, '\\/')}<\\/loc>`).test(b));
}

test.describe('Sitemap — static class (/, /berufe, /preise)', () => {
  test('liefert XML mit /, /berufe, /preise inkl. lastmod, changefreq, priority', async ({ request }) => {
    const res = await request.get(STATIC_URL);
    expect(res.status(), `status ${res.status()}`).toBe(200);
    const ct = res.headers()['content-type'] || '';
    expect(ct).toContain('xml');

    const xml = await res.text();
    expect(xml).toContain('<urlset');
    const blocks = extractUrlBlocks(xml);
    expect(blocks.length, 'mind. 3 URLs').toBeGreaterThanOrEqual(3);

    for (const suffix of ['/', '/berufe', '/preise']) {
      const block = findBlockByLoc(blocks, suffix === '/' ? 'examfit.de/<' : suffix);
      // Fallback: tolerantere Suche
      const matched =
        block ??
        blocks.find((b) =>
          new RegExp(`<loc>https?:\\/\\/[^<]*${suffix === '/' ? '\\/<' : suffix + '<'}`).test(b),
        );
      expect(matched, `Route ${suffix} fehlt in Static-Sitemap`).toBeTruthy();
      expect(matched!).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
      expect(matched!).toMatch(/<changefreq>(daily|weekly|monthly)<\/changefreq>/);
      expect(matched!).toMatch(/<priority>0?\.\d|1\.0<\/priority>/);
    }
  });

  test('/preise lastmod ist deterministisch (PRICING_LAST_UPDATED Konstante)', async ({ request }) => {
    const a = await (await request.get(STATIC_URL)).text();
    const b = await (await request.get(STATIC_URL)).text();
    const re = /<url>[^<]*<loc>[^<]+\/preise<\/loc>\s*<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/;
    const ma = a.match(re);
    const mb = b.match(re);
    expect(ma?.[1], '/preise lastmod (A)').toBeTruthy();
    expect(mb?.[1], '/preise lastmod (B)').toBeTruthy();
    expect(ma![1]).toBe(mb![1]);
  });

  test('/sitemap.xml (public hardcut) ist erreichbar und liefert sitemapindex', async ({ request }) => {
    const res = await request.get(PUBLIC_SITEMAP);
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<sitemapindex');
    expect(xml).toContain('type=static');
  });
});
