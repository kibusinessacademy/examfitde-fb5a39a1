/**
 * Journey B — Demo / Try-before-buy.
 * Ein Interessent soll die Plattform berühren können, ohne zu kaufen.
 */
import { test, expect } from '@playwright/test';
import { recordFinding, isWhiteScreen } from '../_helpers';

test.describe('Journey B — Demo', () => {
  test('B1 Demo-CTA erreichbar von Homepage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const demo = page
      .getByRole('link', { name: /demo|kostenlos|testen|prüfungsanalyse/i })
      .or(page.getByRole('button', { name: /demo|kostenlos|testen|prüfungsanalyse/i }))
      .first();

    if (!(await demo.isVisible().catch(() => false))) {
      recordFinding({
        severity: 'P1',
        kind: 'demo_unreachable',
        journey: 'B',
        route: '/',
        detail: 'Kein Demo / Try-Before-Buy CTA auf Homepage.',
        fix: 'Demo-Pfad als sekundäre Conversion-Route prominent anbieten.',
      });
    }
    expect(await demo.isVisible().catch(() => false)).toBe(true);
  });

  test('B2 Demo-Ziel rendert echten Inhalt', async ({ page }) => {
    // Kandidaten-Demo-Routen; erste lieferfähige zählt
    const candidates = ['/demo', '/pruefungsanalyse', '/probepruefung', '/berufe'];
    let success = false;

    for (const route of candidates) {
      const res = await page.goto(route).catch(() => null);
      if (!res || !res.ok()) continue;
      await page.waitForLoadState('domcontentloaded');
      if (await isWhiteScreen(page)) continue;

      const hasForm = await page.locator('form, input, button[type="submit"]').first().isVisible().catch(() => false);
      const hasContent = (await page.locator('body').innerText()).length > 200;

      if (hasForm || hasContent) {
        success = true;
        break;
      }
    }

    if (!success) {
      recordFinding({
        severity: 'P1',
        kind: 'demo_unreachable',
        journey: 'B',
        route: candidates.join('|'),
        detail: 'Keine der erwarteten Demo-Routen lieferte echten Inhalt.',
        fix: 'Mindestens eine Demo-Landing mit Formular oder interaktivem Element bereitstellen.',
      });
    }
    expect(success, 'Mindestens eine Demo-Route muss inhaltlich tragen').toBe(true);
  });
});
