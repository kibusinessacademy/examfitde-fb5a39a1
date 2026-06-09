/**
 * P14 /berufe Fallback Instant — Berufsliste erscheint SOFORT (Fallback-Katalog),
 * ohne leeres Query-Fenster zwischen Mount und Hydration.
 */
import { test, expect } from '@playwright/test';
import { dismissCookies, markJourney, recordFinding } from './_pre-helpers';

const BERUF_LINK = 'a[href*="/berufe/"], a[href*="/beruf/"]';
const MIN_LINKS = 3;

test.describe('P14 /berufe Fallback Instant Render', () => {
  test('Berufsliste ist im Initial-DOM (kein leeres Query-Fenster)', async ({ page }) => {
    let problems = 0;

    const resp = await page.goto('/berufe', { waitUntil: 'commit' });
    expect(resp?.status() ?? 0, 'HTTP 200').toBeLessThan(400);

    await page.waitForLoadState('domcontentloaded');

    // KEIN Warten auf Query/networkidle — Fallback muss sofort da sein.
    const earlyCount = await page.locator(BERUF_LINK).count().catch(() => 0);
    if (earlyCount < MIN_LINKS) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'broken_route', journey: 'A', route: '/berufe',
        detail: `Nur ${earlyCount} Beruf-Links im Initial-DOM — leeres Query-Fenster.`,
        fix: 'BerufePage: FALLBACK_CATALOG als Default rendern, Query nur additiv.',
      });
    }

    // Nach Hydration: Liste darf nicht schrumpfen / verschwinden.
    await dismissCookies(page);
    await page.waitForLoadState('networkidle').catch(() => {});
    const lateCount = await page.locator(BERUF_LINK).count().catch(() => 0);
    if (lateCount < MIN_LINKS) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'broken_route', journey: 'A', route: '/berufe',
        detail: `Nach Hydration nur ${lateCount} Beruf-Links — Fallback durch Query überschrieben.`,
        fix: 'Query darf Fallback nur erweitern, nicht ersetzen, wenn leer.',
      });
    }

    markJourney(
      'P14_berufe_fallback_instant',
      problems === 0 ? 'pass' : 'fail',
      `early=${earlyCount} late=${lateCount}`,
    );
    expect(earlyCount, `mindestens ${MIN_LINKS} Beruf-Links im Initial-DOM`).toBeGreaterThanOrEqual(MIN_LINKS);
    expect(lateCount, `mindestens ${MIN_LINKS} Beruf-Links nach Hydration`).toBeGreaterThanOrEqual(MIN_LINKS);
  });
});
