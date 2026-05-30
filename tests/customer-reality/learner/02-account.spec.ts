/**
 * Learner Journey 2 — Account.
 * Login + logout + protected route gating. Score weight: 10.
 */
import { test } from '@playwright/test';
import {
  HAS_LEARNER,
  learnerLogin,
  markJourney,
  dismissCookies,
  recordFinding,
  expect,
} from './_learner-helpers';

test.describe('J02 Account', () => {
  test('J02a Login → protected route reachable', async ({ page }) => {
    await learnerLogin(page);
    const resp = await page.goto('/dashboard');
    const status = resp?.status() ?? 0;
    if (status >= 400 || page.url().includes('/auth')) {
      recordFinding({
        severity: 'P0',
        kind: 'login_failed',
        journey: 'C',
        route: '/dashboard',
        detail: `Nach Login /dashboard nicht erreichbar (status=${status}, url=${page.url()}).`,
        fix: 'Auth-Session + Route-Guards prüfen.',
      });
      markJourney('J02_account', 'fail', 'dashboard not reachable after login');
      throw new Error('Dashboard unreachable after login');
    }
    markJourney('J02_account', 'pass');
  });

  test('J02b Geschützte Route blockt ohne Login', async ({ browser }) => {
    const ctx = await browser.newContext(); // fresh, unauthenticated
    const page = await ctx.newPage();
    const resp = await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await dismissCookies(page);
    const status = resp?.status() ?? 0;
    const url = page.url();
    const onAuth = url.includes('/auth') || url.includes('/login');
    const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
    const looksLikeDashboard =
      bodyText.toLowerCase().includes('willkommen') ||
      bodyText.toLowerCase().includes('hallo,');
    if (!onAuth && looksLikeDashboard) {
      recordFinding({
        severity: 'P0',
        kind: 'role_blocked',
        journey: 'C',
        route: '/dashboard',
        detail: 'Anonyme Anfrage erreicht Dashboard ohne Redirect zu /auth.',
        fix: 'Route-Guard für /dashboard wiederherstellen.',
      });
      throw new Error('Protected route not gated');
    }
    expect(true).toBe(true);
    await ctx.close();
  });

  test('J02c Logout funktioniert', async ({ page }) => {
    if (!HAS_LEARNER) {
      test.skip(true, 'No learner creds');
      return;
    }
    await learnerLogin(page);
    await page.goto('/dashboard');
    await dismissCookies(page);
    const logout = page
      .getByRole('button', { name: /abmelden|logout|ausloggen/i })
      .or(page.getByRole('link', { name: /abmelden|logout|ausloggen/i }))
      .first();
    if (!(await logout.isVisible().catch(() => false))) {
      recordFinding({
        severity: 'P1',
        kind: 'dead_button',
        journey: 'C',
        route: '/dashboard',
        detail: 'Logout-Button nicht sichtbar im Header.',
        fix: 'Logout-CTA im App-Header sicherstellen.',
      });
      return;
    }
    await logout.click().catch(() => {});
    await page.waitForTimeout(1500);
    const url = page.url();
    if (!(url.includes('/auth') || url.endsWith('/') || url.endsWith('/login'))) {
      recordFinding({
        severity: 'P1',
        kind: 'workflow_no_feedback',
        journey: 'C',
        route: url,
        detail: 'Nach Logout-Click kein Redirect zu Auth/Home.',
        fix: 'Logout-Handler prüfen.',
      });
    }
  });
});
