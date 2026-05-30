/**
 * P06 Checkout erreichen — Visitor erreicht Auth/Stripe-Surface ohne echten Zahlvorgang.
 * Non-destruktiv: Test bricht vor Stripe-Submit ab.
 * Weight: 15.
 */
import { test } from '@playwright/test';
import { dismissCookies, markJourney, recordFinding, expect, navigateVisitorToCourse } from './_pre-helpers';

const CHECKOUT_SURFACE = /\/auth|\/checkout|stripe\.com|\/onboarding/i;

test.describe('P06 Checkout-Surface erreichen', () => {
  test('Visitor erreicht Auth- oder Stripe-Checkout-Surface', async ({ page }) => {
    let problems = 0;
    const nav = await navigateVisitorToCourse(page);
    if (!nav.url) {
      markJourney('P06_checkout_surface', 'fail', 'no-course');
      recordFinding({
        severity: 'P0', kind: 'checkout_unreachable', journey: 'A',
        detail: 'Konnte keine Kursseite öffnen — Checkout-Surface untestbar.',
        fix: 'P03 fixen.',
      });
      expect(0).toBe(1);
      return;
    }
    await dismissCookies(page);

    const cta = page
      .getByRole('link', { name: /kaufen|jetzt|sichern|buchen|loslegen|starten/i })
      .or(page.getByRole('button', { name: /kaufen|jetzt|sichern|buchen|loslegen|starten/i }))
      .first();
    if (await cta.isVisible().catch(() => false)) {
      await cta.click().catch(() => {});
      await page.waitForTimeout(3000);
    }

    // Falls Auth-Seite: kein Login ausführen — wir prüfen nur Surface.
    const url = page.url();
    if (!CHECKOUT_SURFACE.test(url)) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'checkout_unreachable', journey: 'A', route: url,
        detail: `Kauf-CTA führt nicht auf Auth/Checkout-Surface (${url}).`,
        fix: 'Kauf-Pfad zu Stripe-Checkout / Auth-Gate prüfen.',
      });
    }

    markJourney('P06_checkout_surface', problems === 0 ? 'pass' : 'fail', `final=${url}`);
    expect(problems, 'Checkout-Surface muss erreichbar sein').toBe(0);
  });
});
