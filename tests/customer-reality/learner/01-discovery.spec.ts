/**
 * Learner Journey 1 — Public Discovery.
 * Score weight: 10.
 */
import { test } from '@playwright/test';
import { dismissCookies, markJourney, recordFinding, expect } from './_learner-helpers';

const TRUST_ROUTES = ['/impressum', '/datenschutz'];
const PUBLIC_ROUTES = ['/', '/preise', '/berufe'];

test.describe('J01 Discovery', () => {
  test('J01 public pages render with CTA + trust pages reachable', async ({ page }) => {
    let problems = 0;

    for (const route of PUBLIC_ROUTES) {
      const resp = await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      await dismissCookies(page);
      const status = resp?.status() ?? 0;
      const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
      if (status >= 400 || bodyText.trim().length < 40) {
        problems++;
        recordFinding({
          severity: 'P0',
          kind: 'broken_route',
          journey: 'A',
          route,
          detail: `Public route ${route} returned status ${status} / empty body.`,
          fix: 'Route reparieren oder Navigation entfernen.',
        });
      }
    }

    // Primary CTA visible on `/`
    await page.goto('/');
    await dismissCookies(page);
    const cta = page
      .getByRole('link', { name: /starten|jetzt|testen|loslegen|prüfung/i })
      .or(page.getByRole('button', { name: /starten|jetzt|testen|loslegen|prüfung/i }))
      .first();
    if (!(await cta.isVisible().catch(() => false))) {
      problems++;
      recordFinding({
        severity: 'P0',
        kind: 'dead_cta',
        journey: 'A',
        route: '/',
        detail: 'Kein primärer CTA im sichtbaren Bereich der Homepage.',
        fix: 'Hero-CTA prüfen / cookie banner darf CTA nicht verdecken.',
      });
    }

    // Trust pages
    for (const route of TRUST_ROUTES) {
      const resp = await page.goto(route);
      const status = resp?.status() ?? 0;
      if (status >= 400) {
        problems++;
        recordFinding({
          severity: 'P1',
          kind: 'missing_trust_page',
          journey: 'A',
          route,
          detail: `Trust page ${route} HTTP ${status}.`,
          fix: 'Impressum/Datenschutz wiederherstellen.',
        });
      }
    }

    markJourney('J01_discovery', problems === 0 ? 'pass' : 'fail', `problems=${problems}`);
    expect(problems, 'Discovery muss ohne Probleme bestehen').toBe(0);
  });
});
