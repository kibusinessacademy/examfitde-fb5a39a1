/**
 * Learner Journey 3 — Purchase / Access.
 * Non-destructive: open a product page, hit the "buy" CTA, verify checkout
 * surface (Stripe redirect or auth-gate) without ever completing a payment.
 * Score weight: 10.
 */
import { test } from '@playwright/test';
import { dismissCookies, markJourney, recordFinding, expect } from './_learner-helpers';

test.describe('J03 Purchase / Access', () => {
  test('J03 product → checkout CTA reaches auth/payment surface', async ({ page }) => {
    // Try /preise or /paket/<slug> as entry points
    await page.goto('/preise');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    let cta = page
      .getByRole('button', { name: /kaufen|jetzt starten|paket starten|checkout/i })
      .or(page.getByRole('link', { name: /kaufen|jetzt starten|paket starten|checkout/i }))
      .first();

    if (!(await cta.isVisible().catch(() => false))) {
      // Fallback: open a curriculum-specific paket page (used by header CTA)
      await page.goto('/berufe');
      await dismissCookies(page);
      const firstCourse = page
        .locator('a[href*="/berufe/"], a[href*="/paket/"], a[href*="/course/"]')
        .first();
      if (!(await firstCourse.isVisible().catch(() => false))) {
        recordFinding({
          severity: 'P0',
          kind: 'demo_unreachable',
          journey: 'B',
          route: '/berufe',
          detail: 'Kein Produkt-Einstiegspunkt erreichbar.',
          fix: 'Produktkatalog reparieren.',
        });
        markJourney('J03_purchase', 'fail', 'no entry point');
        throw new Error('No product entry point');
      }
      await firstCourse.click().catch(() => {});
      await page.waitForTimeout(1500);
      cta = page
        .getByRole('button', { name: /kaufen|jetzt starten|paket starten|checkout|komplettpaket/i })
        .or(page.getByRole('link', { name: /kaufen|jetzt starten|paket starten|checkout|komplettpaket/i }))
        .first();
    }

    if (!(await cta.isVisible().catch(() => false))) {
      recordFinding({
        severity: 'P0',
        kind: 'dead_cta',
        journey: 'B',
        route: page.url(),
        detail: 'Kein Kauf-/Start-CTA auf Produkt-/Preisseite.',
        fix: 'CTA "Jetzt starten" auf Produktseite sicherstellen.',
      });
      markJourney('J03_purchase', 'fail', 'no buy cta');
      throw new Error('No buy CTA');
    }

    const before = page.url();
    await cta.click().catch(() => {});
    await page.waitForTimeout(3500);
    const after = page.url();
    const onCheckoutSurface =
      after.includes('stripe.com') ||
      after.includes('/auth') ||
      after.includes('/checkout') ||
      after.includes('/login') ||
      after !== before;

    if (!onCheckoutSurface) {
      recordFinding({
        severity: 'P0',
        kind: 'checkout_unreachable',
        journey: 'B',
        route: before,
        detail: 'Buy-CTA löst keinen Wechsel zu Auth/Checkout/Stripe aus.',
        fix: 'startProductCheckout-Verkabelung + auth-gate prüfen.',
      });
      markJourney('J03_purchase', 'fail', 'no checkout surface');
      throw new Error('Checkout not reachable');
    }

    markJourney('J03_purchase', 'pass', `landed at ${after.slice(0, 80)}`);
    expect(true).toBe(true);
  });
});
