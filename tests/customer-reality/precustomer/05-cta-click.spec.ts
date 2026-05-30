/**
 * P05 CTA klicken — Visitor klickt primären CTA und landet auf Conversion-Surface
 * (Auth, Checkout, Lead-Funnel, Quiz). Kein 404, kein Dead-End.
 * Weight: 10.
 */
import { test } from '@playwright/test';
import { dismissCookies, markJourney, recordFinding, expect, navigateVisitorToCourse } from './_pre-helpers';

const CONVERSION_SIGNALS = /\/auth|\/checkout|\/preise|\/onboarding|\/quiz|\/demo|\/pruefungsreife|stripe\.com/i;

test.describe('P05 CTA klicken', () => {
  test('Primary CTA führt auf Conversion-Surface', async ({ page }) => {
    let problems = 0;
    const { url } = await navigateVisitorToCourse(page);
    if (!url) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'dead_cta', journey: 'A',
        detail: 'Konnte keine Kursseite öffnen für CTA-Test.',
        fix: 'Erst P03 (Discovery) fixen.',
      });
      markJourney('P05_cta_click', 'fail', 'no-course');
      expect(problems).toBe(0);
      return;
    }

    await dismissCookies(page);
    const before = page.url();
    const cta = page
      .getByRole('link', { name: /kaufen|jetzt|starten|sichern|buchen|loslegen|simulation|testen/i })
      .or(page.getByRole('button', { name: /kaufen|jetzt|starten|sichern|buchen|loslegen|simulation|testen/i }))
      .first();

    if (!(await cta.isVisible().catch(() => false))) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'dead_cta', journey: 'A', route: before,
        detail: 'Kursseite ohne sichtbaren Primary-CTA.',
        fix: 'Conversion-CTA in Produkt-Hero verankern (constraints/shop-ui-conversion-v1).',
      });
    } else {
      await cta.click().catch(() => {});
      await page.waitForTimeout(2000);
      const after = page.url();
      const movedToConversion = after !== before && CONVERSION_SIGNALS.test(after);
      if (!movedToConversion) {
        problems++;
        recordFinding({
          severity: 'P0', kind: 'dead_cta', journey: 'A', route: before,
          detail: `CTA-Klick landete nicht auf Conversion-Surface (${after}).`,
          fix: 'CTA-Ziel prüfen — muss auf /auth, /checkout, /quiz oder Lead-Funnel führen.',
        });
      }
    }

    markJourney('P05_cta_click', problems === 0 ? 'pass' : 'fail', `from=${before}`);
    expect(problems, 'CTA muss konvertieren').toBe(0);
  });
});
