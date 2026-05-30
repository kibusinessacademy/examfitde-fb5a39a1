/**
 * P04 Preis verstehen — /preise zeigt Preise + Mehrwert + CTA.
 * Weight: 15.
 */
import { test } from '@playwright/test';
import { dismissCookies, markJourney, recordFinding, expect } from './_pre-helpers';

test.describe('P04 Preis verstehen', () => {
  test('/preise zeigt Preise und CTA', async ({ page }) => {
    let problems = 0;
    const resp = await page.goto('/preise');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    const status = resp?.status() ?? 0;
    if (status >= 400) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'broken_route', journey: 'A', route: '/preise',
        detail: `/preise HTTP ${status}.`, fix: 'Pricing-Route reparieren.',
      });
    }

    const body = (await page.locator('body').innerText().catch(() => '')) || '';
    // Mind. eine €-Angabe
    const hasPrice = /€|EUR|euro/i.test(body) && /\d/.test(body);
    if (!hasPrice) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'workflow_no_feedback', journey: 'A', route: '/preise',
        detail: 'Pricing-Seite zeigt keinen €/EUR-Preis.',
        fix: 'Pricing-SSOT auf /preise rendern (statt nur auf Produktseiten).',
      });
    }

    // CTA muss existieren
    const cta = page
      .getByRole('link', { name: /kaufen|jetzt|starten|sichern|buchen|loslegen/i })
      .or(page.getByRole('button', { name: /kaufen|jetzt|starten|sichern|buchen|loslegen/i }))
      .first();
    if (!(await cta.isVisible().catch(() => false))) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'dead_cta', journey: 'A', route: '/preise',
        detail: 'Pricing-Seite hat keinen sichtbaren Kauf-CTA.',
        fix: 'Primary-CTA pro Pricing-Tier hinzufügen.',
      });
    }

    markJourney('P04_pricing', problems === 0 ? 'pass' : 'fail', `hasPrice=${hasPrice}`);
    expect(problems, 'Pricing muss ohne P0 bestehen').toBe(0);
  });
});
