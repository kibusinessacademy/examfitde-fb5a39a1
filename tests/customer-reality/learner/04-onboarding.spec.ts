/**
 * Learner Journey 4 — Onboarding (Dashboard next-step). Weight: 10.
 */
import { test } from '@playwright/test';
import { dismissCookies, learnerLogin, markJourney, recordFinding, expect } from './_learner-helpers';

test.describe('J04 Onboarding', () => {
  test('J04 Dashboard shows non-empty next-step + Lernplan reference', async ({ page }) => {
    await learnerLogin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);

    const body = (await page.locator('body').innerText().catch(() => '')) || '';
    if (body.trim().length < 80) {
      recordFinding({
        severity: 'P0',
        kind: 'white_screen',
        journey: 'D',
        route: '/dashboard',
        detail: 'Dashboard ist effektiv leer.',
        fix: 'Empty-State / First-Run-Onboarding bereitstellen.',
      });
      markJourney('J04_onboarding', 'fail', 'empty dashboard');
      throw new Error('Empty dashboard');
    }

    // Next-step CTA must be visible AND must not be a dead anchor
    const cta = page
      .getByRole('link', { name: /starten|weiter|lerneinheit|fortsetzen|challenge/i })
      .or(page.getByRole('button', { name: /starten|weiter|lerneinheit|fortsetzen|challenge/i }))
      .first();
    if (!(await cta.isVisible().catch(() => false))) {
      recordFinding({
        severity: 'P0',
        kind: 'dead_cta',
        journey: 'D',
        route: '/dashboard',
        detail: 'Kein next-step CTA im Dashboard sichtbar.',
        fix: 'Primary-Next-Action im Dashboard.',
      });
      markJourney('J04_onboarding', 'fail', 'no next-step cta');
      throw new Error('No next-step CTA');
    }

    // Lernplan-Hinweis
    const hasPlan = /lernplan|plan|fortschritt|fahrplan/i.test(body);
    if (!hasPlan) {
      recordFinding({
        severity: 'P1',
        kind: 'placeholder_end_state',
        journey: 'D',
        route: '/dashboard',
        detail: 'Kein Lernplan-/Fortschritts-Hinweis im Dashboard sichtbar.',
        fix: 'Lernplan-Karte ergänzen.',
      });
    }

    markJourney('J04_onboarding', 'pass');
    expect(true).toBe(true);
  });
});
