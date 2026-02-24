// ExamFit E2E Auth Helper
// Usage: import { loginAs } from './auth';

import { Page } from '@playwright/test';

const BASE_URL = process.env.STAGING_URL || 'https://examfitde.lovable.app';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

export const TEST_USERS = {
  smoke_no_entitlement: {
    email: 'smoke_no_entitlement@examfit.test',
    password: process.env.TEST_USER_PASSWORD || 'TestPass_Smoke1!',
  },
  smoke_with_entitlement: {
    email: 'smoke_with_entitlement@examfit.test',
    password: process.env.TEST_USER_PASSWORD || 'TestPass_Smoke2!',
  },
  uat_azubi: {
    email: 'uat_azubi@examfit.test',
    password: process.env.TEST_USER_PASSWORD || 'TestPass_UAT1!',
  },
};

export async function loginAs(page: Page, userKey: keyof typeof TEST_USERS) {
  const user = TEST_USERS[userKey];
  await page.goto(`${BASE_URL}/auth`);
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);
  await page.click('button[type="submit"]');
  // Wait for redirect away from auth page
  await page.waitForURL((url) => !url.pathname.includes('/auth'), { timeout: 10000 });
}

export async function logout(page: Page) {
  // Click user menu and logout
  await page.goto(`${BASE_URL}/`);
  // Attempt to find and click logout
  const logoutBtn = page.locator('text=Abmelden').or(page.locator('text=Logout'));
  if (await logoutBtn.isVisible()) {
    await logoutBtn.click();
  }
}

export { BASE_URL };
