/**
 * P11 SEO-Surface — Pre-Login-Routen liefern Title, Meta-Description,
 * Canonical, OG-Tags und mindestens 1 JSON-LD-Block. Voraussetzung für
 * R1 "Brand-Entity" (SSOT Strategic North Star).
 * Weight: 7.
 */
import { test } from '@playwright/test';
import { markJourney, recordFinding, expect } from './_pre-helpers';

const ROUTES = ['/', '/berufe', '/preise'];

test.describe('P11 SEO Surface', () => {
  test('Kern-Routen haben Title / Meta / Canonical / OG / JSON-LD', async ({ page }) => {
    let problems = 0;

    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });

      const title = (await page.title()) || '';
      if (title.length < 15 || title.length > 70) {
        problems++;
        recordFinding({
          severity: 'P1', kind: 'workflow_no_feedback', journey: 'A', route,
          detail: `Title-Länge ${title.length} außerhalb 15-70 (SEO-Limit).`,
          fix: 'Title-Template prüfen — Brand + Keyword + Persona.',
        });
      }

      const meta = await page.locator('meta[name="description"]').getAttribute('content').catch(() => null);
      if (!meta || meta.length < 50) {
        problems++;
        recordFinding({
          severity: 'P1', kind: 'workflow_no_feedback', journey: 'A', route,
          detail: `Meta-Description fehlt oder <50 Zeichen.`,
          fix: 'Pro Route Meta-Description rendern (SSR/Prerender).',
        });
      }

      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href').catch(() => null);
      if (!canonical) {
        recordFinding({
          severity: 'P2', kind: 'workflow_no_feedback', journey: 'A', route,
          detail: 'Canonical-Tag fehlt — riskiert Duplicate-Content.',
          fix: 'Canonical pro Route im Head setzen.',
        });
      }

      const ogTitle = await page.locator('meta[property="og:title"]').count().catch(() => 0);
      const ogImage = await page.locator('meta[property="og:image"]').count().catch(() => 0);
      if (ogTitle === 0 || ogImage === 0) {
        recordFinding({
          severity: 'P2', kind: 'workflow_no_feedback', journey: 'A', route,
          detail: `OG-Tags unvollständig (og:title=${ogTitle}, og:image=${ogImage}).`,
          fix: 'OG-Tags für Social-Preview rendern.',
        });
      }

      const jsonLd = await page.locator('script[type="application/ld+json"]').count().catch(() => 0);
      if (jsonLd === 0) {
        recordFinding({
          severity: 'P2', kind: 'workflow_no_feedback', journey: 'A', route,
          detail: 'Keine JSON-LD Struktur — schwächt LLM-Visibility & Rich-Snippets.',
          fix: 'Mindestens Organization / WebSite / Product Schema rendern.',
        });
      }
    }

    markJourney('P11_seo_surface', problems === 0 ? 'pass' : 'fail', `routes=${ROUTES.length}`);
    expect(problems, 'SEO-Basis muss ohne P1 stehen').toBe(0);
  });
});
