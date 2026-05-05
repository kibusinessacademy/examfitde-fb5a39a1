// ExamFit E2E Auth Helper
import { Page, expect } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

export const TEST_USERS = {
  smoke_learner: {
    email: process.env.E2E_EMAIL || 'smoke_with_entitlement@examfit.test',
    password: process.env.E2E_PASSWORD || 'TestPass_Smoke2!',
  },
  smoke_no_entitlement: {
    email: 'smoke_no_entitlement@examfit.test',
    password: process.env.TEST_USER_PASSWORD || 'TestPass_Smoke1!',
  },
  // QA "all-access" learner: full entitlement across all published courses.
  // Used by progress-persistence + golden-path learner regressions.
  qa_allaccess: {
    email:
      process.env.E2E_QA_ALLACCESS_EMAIL ||
      process.env.E2E_TEST_USER_EMAIL ||
      'qa_allaccess@examfit.test',
    password:
      process.env.E2E_QA_ALLACCESS_PASSWORD ||
      process.env.E2E_TEST_USER_PASSWORD ||
      'TestPass_QAAllAccess!',
  },
};

/**
 * Login as a test user via the auth page.
 */
export async function loginAs(page: Page, userKey: keyof typeof TEST_USERS = 'smoke_learner') {
  const user = TEST_USERS[userKey];
  if (!user.email || !user.password) {
    throw new Error(`Missing credentials for ${userKey}`);
  }

  await page.goto('/auth');
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes('/auth'), { timeout: 15_000 });
}

/**
 * Logout by navigating and clicking logout button.
 */
export async function logout(page: Page) {
  await page.goto('/');
  const logoutBtn = page.locator('text=Abmelden').or(page.locator('text=Logout'));
  if (await logoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await logoutBtn.click();
  }
}

/**
 * Get env variable with fallback.
 */
export function env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}
