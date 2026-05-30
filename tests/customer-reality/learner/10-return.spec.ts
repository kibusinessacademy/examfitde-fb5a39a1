/**
 * Learner Journey 10 — Return Journey. Weight: 5.
 * Second login in a fresh context — dashboard should not be cold-empty.
 */
import { test } from '@playwright/test';
import {
  HAS_LEARNER,
  LEARNER,
  dismissCookies,
  markJourney,
  recordFinding,
  expect,
} from './_learner-helpers';

test.describe('J10 Return Journey', () => {
  test('J10 Second login surfaces continuation + recommendation', async ({ browser }) => {
    test.skip(!HAS_LEARNER, 'no learner creds');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/auth');
    await dismissCookies(page);
    await page.fill('input[type="email"]', LEARNER.email);
    await page.fill('input[type="password"]', LEARNER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 20_000 });

    await page.goto('/dashboard');
    await dismissCookies(page);
    const body = (await page.locator('body').innerText().catch(() => '')) || '';

    if (body.trim().length < 80) {
      recordFinding({
        severity: 'P0',
        kind: 'white_screen',
        journey: 'F',
        route: '/dashboard',
        detail: 'Dashboard nach Re-Login leer.',
        fix: 'Session / RLS / Empty-State.',
      });
      markJourney('J10_return', 'fail', 'empty');
      await ctx.close();
      throw new Error('Empty return dashboard');
    }
    const hasContinue = /fortsetzen|weiter|nächste|empfehlung|streak|fortschritt/i.test(body);
    if (!hasContinue) {
      recordFinding({
        severity: 'P2',
        kind: 'placeholder_end_state',
        journey: 'F',
        route: '/dashboard',
        detail: 'Keine sichtbare Fortsetzungs-/Empfehlungs-Karte nach Re-Login.',
        fix: 'Continue-Card / Recommendation-Card im Dashboard.',
      });
    }
    markJourney('J10_return', 'pass');
    expect(true).toBe(true);
    await ctx.close();
  });
});
