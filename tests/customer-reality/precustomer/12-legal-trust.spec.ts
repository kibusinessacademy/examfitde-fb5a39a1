/**
 * P12 Legal-Trust-Footer — Impressum, Datenschutz, AGB ab Homepage in einem
 * Klick erreichbar und nicht 404. Pflicht für B2C/B2B Vertrauen + DE-Recht.
 * Weight: 5.
 */
import { test } from '@playwright/test';
import { dismissCookies, markJourney, recordFinding, expect } from './_pre-helpers';

const REQUIRED = [
  { label: 'Impressum', re: /impressum/i },
  { label: 'Datenschutz', re: /datenschutz|privacy/i },
  { label: 'AGB', re: /\bagb\b|nutzungsbedingungen|terms/i },
];

test.describe('P12 Legal-Trust', () => {
  test('Impressum / Datenschutz / AGB ab Homepage erreichbar', async ({ page }) => {
    let problems = 0;
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    for (const { label, re } of REQUIRED) {
      const link = page.getByRole('link', { name: re }).first();
      const href = await link.getAttribute('href').catch(() => null);

      if (!href) {
        problems++;
        recordFinding({
          severity: 'P1', kind: 'broken_route', journey: 'A', route: '/',
          detail: `${label}-Link fehlt auf Homepage / im Footer.`,
          fix: `Footer-Block mit ${label}-Link ergänzen (DE-Recht / Stripe-Requirement).`,
        });
        continue;
      }

      const resp = await page.request.get(new URL(href, page.url()).toString()).catch(() => null);
      const status = resp?.status() ?? 0;
      if (status >= 400) {
        problems++;
        recordFinding({
          severity: 'P0', kind: 'broken_route', journey: 'A', route: href,
          detail: `${label} liefert HTTP ${status}.`,
          fix: `Route ${href} reparieren / Content publishen.`,
        });
      }
    }

    markJourney('P12_legal_trust', problems === 0 ? 'pass' : 'fail', `checked=${REQUIRED.length}`);
    expect(problems, 'Legal-Footer muss vollständig sein').toBe(0);
  });
});
