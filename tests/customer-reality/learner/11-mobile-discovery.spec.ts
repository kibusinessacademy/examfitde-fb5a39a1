/**
 * Mobile sanity — Discovery on 390x844 iPhone viewport.
 * Doesn't add to score, but flags P2 if homepage CTA invisible on mobile.
 */
import { test, devices } from '@playwright/test';
import { dismissCookies, recordFinding } from './_learner-helpers';

test.use({ ...devices['iPhone 13'] });

test.describe('J11 Mobile Discovery', () => {
  test('J11 Mobile homepage shows CTA above the fold (heuristic)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    const cta = page
      .getByRole('link', { name: /starten|jetzt|testen|loslegen/i })
      .or(page.getByRole('button', { name: /starten|jetzt|testen|loslegen/i }))
      .first();
    const visible = await cta.isVisible().catch(() => false);
    if (!visible) {
      recordFinding({
        severity: 'P2',
        kind: 'dead_cta',
        journey: 'A',
        route: '/ (mobile)',
        detail: 'Auf iPhone 13 viewport ist kein Primary-CTA sichtbar (möglicherweise vom Cookie-Banner verdeckt).',
        fix: 'Cookie-Banner non-blocking machen oder Hero-CTA repositionieren.',
      });
    }
  });
});
