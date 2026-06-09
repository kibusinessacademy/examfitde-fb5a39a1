/**
 * P13 Pricing Instant Render — /preise zeigt "24,90 €" SOFORT (vor jeglichem Query/Loading-Gate).
 * Verhindert Hydration-Drift Regression (P04 Wurzel).
 */
import { test, expect } from '@playwright/test';
import { dismissCookies, markJourney, recordFinding } from './_pre-helpers';

const PRICE_RE = /24[.,]90\s*€/;

test.describe('P13 /preise Instant Price Render', () => {
  test('24,90 € erscheint ohne Loading-Gate (kein leeres Render-Fenster)', async ({ page }) => {
    let problems = 0;

    // 1) Cold HTML (Prehydration) muss Preis enthalten.
    const resp = await page.goto('/preise', { waitUntil: 'commit' });
    expect(resp?.status() ?? 0, 'HTTP 200').toBeLessThan(400);

    // 2) Direkt nach domcontentloaded — KEIN Warten auf networkidle.
    await page.waitForLoadState('domcontentloaded');

    const earlyBody = (await page.locator('body').innerText().catch(() => '')) || '';
    const earlyHasPrice = PRICE_RE.test(earlyBody);
    if (!earlyHasPrice) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'workflow_no_feedback', journey: 'A', route: '/preise',
        detail: 'Preis "24,90 €" fehlt im Initial-DOM (Hydration-Drift / Loading-Gate).',
        fix: 'PreisePage muss 24,90 € als Default-Render emittieren, nicht hinter Query/Loading verbergen.',
      });
    }

    // 3) Nach Cookies + voller Hydration darf der Preis NICHT verschwinden.
    await dismissCookies(page);
    await page.waitForLoadState('networkidle').catch(() => {});
    const lateBody = (await page.locator('body').innerText().catch(() => '')) || '';
    const lateHasPrice = PRICE_RE.test(lateBody);
    if (!lateHasPrice) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'workflow_no_feedback', journey: 'A', route: '/preise',
        detail: 'Preis "24,90 €" nach Hydration entfernt (React überschreibt SSR).',
        fix: 'Pricing-Tier-Komponente: Default-State darf nicht leer rendern.',
      });
    }

    markJourney(
      'P13_pricing_instant_render',
      problems === 0 ? 'pass' : 'fail',
      `early=${earlyHasPrice} late=${lateHasPrice}`,
    );
    expect(earlyHasPrice, '24,90 € muss im Initial-Render sichtbar sein').toBe(true);
    expect(lateHasPrice, '24,90 € muss nach Hydration sichtbar bleiben').toBe(true);
  });
});
