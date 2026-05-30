/**
 * Journey F — Support & Trust.
 * Pflichtseiten (Impressum, Datenschutz, AGB, Kontakt, FAQ) erreichbar + nicht leer.
 * Fehlerseite verständlich.
 */
import { test, expect } from '@playwright/test';
import { recordFinding, isWhiteScreen } from '../_helpers';

const PFLICHT = [
  { route: '/impressum', kind: 'Impressum', critical: true },
  { route: '/datenschutz', kind: 'Datenschutz', critical: true },
  { route: '/agb', kind: 'AGB', critical: true },
  { route: '/kontakt', kind: 'Kontakt', critical: false },
  { route: '/faq', kind: 'FAQ', critical: false },
] as const;

test.describe('Journey F — Support & Trust', () => {
  for (const item of PFLICHT) {
    test(`F:${item.kind} erreichbar + Inhalt`, async ({ page }) => {
      const res = await page.goto(item.route).catch(() => null);
      const status = res?.status() ?? 0;

      if (!res || status >= 400) {
        recordFinding({
          severity: item.critical ? 'P0' : 'P2',
          kind: 'missing_trust_page',
          journey: 'F',
          route: item.route,
          detail: `${item.kind} antwortet mit ${status}.`,
          fix: 'Route bereitstellen oder Footer-Link entfernen.',
        });
        if (item.critical) expect(status, `${item.kind} muss 2xx liefern`).toBeLessThan(400);
        return;
      }
      await page.waitForLoadState('domcontentloaded');
      if (await isWhiteScreen(page)) {
        recordFinding({
          severity: item.critical ? 'P0' : 'P2',
          kind: 'placeholder_end_state',
          journey: 'F',
          route: item.route,
          detail: `${item.kind} rendert ohne Inhalt.`,
          fix: 'Inhalt befüllen.',
        });
      }
    });
  }

  test('F:404 Seite ist verständlich', async ({ page }) => {
    await page.goto('/nicht-existente-route-' + Date.now()).catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    const body = (await page.locator('body').innerText()).toLowerCase();
    const recognizable = /nicht gefunden|404|seite|page not found/.test(body);
    if (!recognizable) {
      recordFinding({
        severity: 'P2',
        kind: 'placeholder_end_state',
        journey: 'F',
        route: '/<random>',
        detail: '404-Seite ist nicht als solche erkennbar.',
        fix: 'NotFound-Seite mit klarer Botschaft + Zurück-Link.',
      });
    }
    expect(recognizable).toBe(true);
  });
});
