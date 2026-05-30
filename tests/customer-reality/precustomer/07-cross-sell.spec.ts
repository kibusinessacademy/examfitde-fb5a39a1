/**
 * P07 Weitere Produkte entdecken — ab Produktseite werden verwandte Berufe/Kurse angeboten.
 * Weight: 10.
 */
import { test } from '@playwright/test';
import { dismissCookies, markJourney, recordFinding, expect, navigateVisitorToCourse } from './_pre-helpers';

test.describe('P07 Cross-Sell', () => {
  test('Produktseite verlinkt mindestens 2 weitere Berufe/Kurse', async ({ page }) => {
    let problems = 0;
    const { url } = await navigateVisitorToCourse(page);
    if (!url) {
      markJourney('P07_cross_sell', 'fail', 'no-course');
      recordFinding({
        severity: 'P1', kind: 'workflow_no_feedback', journey: 'A',
        detail: 'Keine Kursseite erreichbar — Cross-Sell untestbar.',
      });
      expect(0).toBe(1);
      return;
    }
    await dismissCookies(page);

    const here = new URL(url).pathname;
    const internalLinks = await page
      .locator('a[href^="/"], a[href*="examfit"], a[href*="berufos"]')
      .evaluateAll((els, here) => {
        const set = new Set<string>();
        for (const el of els as HTMLAnchorElement[]) {
          try {
            const u = new URL((el as HTMLAnchorElement).href);
            if (u.pathname !== here && /\/berufe\/|\/beruf\/|\/kurs\/|\/course\/|\/produkt\//.test(u.pathname)) {
              set.add(u.pathname);
            }
          } catch { /* ignore */ }
        }
        return Array.from(set);
      }, here);

    if (internalLinks.length < 2) {
      problems++;
      recordFinding({
        severity: 'P1', kind: 'workflow_no_feedback', journey: 'A', route: here,
        detail: `Nur ${internalLinks.length} verwandte Produktlinks — kein Cross-Sell.`,
        fix: 'Related-Berufe / Cluster-Geschwister auf Produktseite anzeigen (constraints/shop-ui-conversion-v1).',
      });
    }

    markJourney('P07_cross_sell', problems === 0 ? 'pass' : 'fail', `internal=${internalLinks.length}`);
    expect(problems, 'Cross-Sell sollte vorhanden sein').toBe(0);
  });
});
