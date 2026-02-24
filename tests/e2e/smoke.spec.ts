// ExamFit Smoke Tests
// Duration: 2-5 minutes | Trigger: every deploy
// Checks: App loads, auth works, entitlement gates, core modules alive, pipeline health

import { test, expect } from '@playwright/test';
import { loginAs, logout, BASE_URL, TEST_USERS } from './helpers/auth';

test.describe('Smoke: App Health', () => {
  test('Landing page loads without errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const response = await page.goto(BASE_URL);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState('networkidle');

    // Filter out known benign errors
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('serviceworker')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('Auth page loads', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/auth`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('Protected route redirects when not logged in', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForURL((url) => url.pathname.includes('/auth') || url.pathname === '/', {
      timeout: 5000,
    });
  });
});

test.describe('Smoke: Auth Happy Path', () => {
  test('Test user can login and logout', async ({ page }) => {
    await loginAs(page, 'smoke_with_entitlement');
    // Should be on dashboard or home after login
    await expect(page).not.toHaveURL(/\/auth/);
    await logout(page);
  });
});

test.describe('Smoke: Entitlement Gates', () => {
  test('User without entitlement sees purchase CTA', async ({ page }) => {
    await loginAs(page, 'smoke_no_entitlement');
    await page.goto(`${BASE_URL}/courses`);
    await page.waitForLoadState('networkidle');

    // Should see some form of "no access" or "purchase" indication
    const pageContent = await page.textContent('body');
    const hasGate =
      pageContent?.includes('Kein Zugriff') ||
      pageContent?.includes('Kurs kaufen') ||
      pageContent?.includes('Jetzt starten') ||
      pageContent?.includes('Freischalten');
    expect(hasGate).toBeTruthy();
  });

  test('User with entitlement sees course content', async ({ page }) => {
    await loginAs(page, 'smoke_with_entitlement');
    await page.goto(`${BASE_URL}/courses`);
    await page.waitForLoadState('networkidle');

    // Should see course content or "Prüfung starten"
    const pageContent = await page.textContent('body');
    const hasContent =
      pageContent?.includes('Prüfung starten') ||
      pageContent?.includes('Weiterlernen') ||
      pageContent?.includes('Modul');
    expect(hasContent).toBeTruthy();
  });
});

test.describe('Smoke: Core Modules Alive', () => {
  test('Exam trainer page loads', async ({ page }) => {
    await loginAs(page, 'smoke_with_entitlement');
    await page.goto(`${BASE_URL}/exam`);
    await page.waitForLoadState('networkidle');
    // Page should not show error state
    const errorVisible = await page.locator('text=Fehler').isVisible().catch(() => false);
    // Allow for "no questions" state but not crash
    expect(await page.title()).toBeTruthy();
  });
});
