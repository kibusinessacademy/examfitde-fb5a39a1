/**
 * P08 BerufOS verstehen — Hub-Seite erklärt Produkt und bietet CTA.
 * Weight: 10.
 */
import { test } from '@playwright/test';
import { dismissCookies, markJourney, recordFinding, expect } from './_pre-helpers';

const CANDIDATES = ['/berufos', '/komplettpaket', '/produkte'];

test.describe('P08 BerufOS Hub', () => {
  test('BerufOS-/Komplettpaket-Hub erreichbar mit Erklärung + CTA', async ({ page }) => {
    let problems = 0;
    let reached: string | null = null;

    for (const route of CANDIDATES) {
      const resp = await page.goto(route, { waitUntil: 'domcontentloaded' });
      const status = resp?.status() ?? 0;
      if (status >= 400) continue;
      const text = (await page.locator('body').innerText().catch(() => '')) || '';
      if (text.trim().length > 400) {
        reached = route;
        break;
      }
    }

    if (!reached) {
      problems++;
      recordFinding({
        severity: 'P1', kind: 'broken_route', journey: 'A',
        detail: `Kein BerufOS-/Komplettpaket-Hub erreichbar (${CANDIDATES.join(', ')}).`,
        fix: 'Mindestens eine Hub-Route mit Produkt-Erklärung publishen.',
      });
    } else {
      await dismissCookies(page);
      const cta = page
        .getByRole('link', { name: /starten|jetzt|testen|loslegen|kaufen|sichern/i })
        .or(page.getByRole('button', { name: /starten|jetzt|testen|loslegen|kaufen|sichern/i }))
        .first();
      if (!(await cta.isVisible().catch(() => false))) {
        problems++;
        recordFinding({
          severity: 'P1', kind: 'dead_cta', journey: 'A', route: reached,
          detail: 'BerufOS-Hub ohne sichtbaren CTA.',
          fix: 'Conversion-CTA auf Hub verankern.',
        });
      }
    }

    markJourney('P08_berufos_hub', problems === 0 ? 'pass' : 'fail', `reached=${reached ?? 'NONE'}`);
    expect(problems, 'BerufOS-Hub muss erreichbar + konversionsfähig sein').toBe(0);
  });
});
