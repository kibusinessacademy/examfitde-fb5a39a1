/**
 * P02 Beruf finden — Visitor öffnet /berufe und sieht klickbare Berufe.
 * Weight: 15.
 */
import { test } from '@playwright/test';
import { dismissCookies, markJourney, recordFinding, expect } from './_pre-helpers';

test.describe('P02 Beruf finden', () => {
  test('/berufe listet klickbare Berufe', async ({ page }) => {
    let problems = 0;
    const resp = await page.goto('/berufe');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    const status = resp?.status() ?? 0;
    if (status >= 400) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'broken_route', journey: 'A', route: '/berufe',
        detail: `/berufe HTTP ${status}.`, fix: 'Berufs-Hub-Route reparieren.',
      });
    }

    // Mindestens 3 Beruf-Karten / Links
    const links = page.locator('a[href*="/berufe/"], a[href*="/beruf/"]');
    const count = await links.count().catch(() => 0);
    if (count < 3) {
      problems++;
      recordFinding({
        severity: 'P0', kind: 'broken_route', journey: 'A', route: '/berufe',
        detail: `Nur ${count} Beruf-Links sichtbar — Visitor kann keinen Beruf finden.`,
        fix: 'Berufs-Liste hydratisieren / SSR-Fallback prüfen.',
      });
    }

    // Suche / Filter Optional
    const search = page.locator('input[type="search"], input[placeholder*="uchen" i], input[placeholder*="Beruf" i]').first();
    const hasSearch = await search.isVisible().catch(() => false);
    if (!hasSearch && count < 10) {
      recordFinding({
        severity: 'P2', kind: 'workflow_no_feedback', journey: 'A', route: '/berufe',
        detail: 'Keine Suche und wenige Berufe — Discovery-Friction.',
        fix: 'Such-/Filterleiste hinzufügen.',
      });
    }

    markJourney('P02_find_beruf', problems === 0 ? 'pass' : 'fail', `links=${count}`);
    expect(problems, 'Beruf-Discovery muss ohne P0 bestehen').toBe(0);
  });
});
