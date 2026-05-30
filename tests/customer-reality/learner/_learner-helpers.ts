/**
 * Helpers shared by all 10 Learner-Reality journeys.
 * Builds on top of tests/customer-reality/_helpers.ts.
 */
import { Page, expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { recordFinding, BASE_URL } from '../_helpers';

export const LEARNER = {
  email: process.env.REALITY_LEARNER_EMAIL || process.env.REALITY_PM_EMAIL || '',
  password:
    process.env.REALITY_LEARNER_PASSWORD || process.env.REALITY_PM_PASSWORD || '',
};

export const B2B_LEARNER = {
  email: process.env.REALITY_B2B_LEARNER_EMAIL || '',
  password: process.env.REALITY_B2B_LEARNER_PASSWORD || '',
};

export const HAS_LEARNER = !!(LEARNER.email && LEARNER.password);
export const CHECKOUT_TEST_MODE = process.env.CHECKOUT_TEST_MODE !== 'false';

export const RESULTS_DIR = path.resolve(process.cwd(), 'reality-results');
export const PASS_DIR = path.join(RESULTS_DIR, 'journey-pass');

export function markJourney(id: string, status: 'pass' | 'fail', detail?: string) {
  fs.mkdirSync(PASS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(PASS_DIR, `${id}.json`),
    JSON.stringify(
      { id, status, detail: detail || null, ts: new Date().toISOString() },
      null,
      2,
    ),
  );
}

export async function dismissCookies(page: Page) {
  const btn = page.getByRole('button', { name: /akzeptieren|accept|alle erlauben/i }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

export async function learnerLogin(page: Page) {
  test.skip(
    !HAS_LEARNER,
    'REALITY_LEARNER_EMAIL / _PASSWORD not set → soft skip (NOT a green release).',
  );
  await page.goto('/auth');
  await page.waitForLoadState('domcontentloaded');
  await dismissCookies(page);
  await page.fill('input[type="email"]', LEARNER.email);
  await page.fill('input[type="password"]', LEARNER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), {
    timeout: 20_000,
  });
  // Mark login success so the aggregator can validate "real learner present"
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, 'learner-login-success.flag'),
    JSON.stringify({ ok: true, email: LEARNER.email, ts: new Date().toISOString() }),
  );
}

/**
 * Try to reach the first available learner course from the dashboard.
 * Returns the URL of the course/lesson the learner ended up on, or null.
 */
export async function openFirstAvailableCourse(page: Page): Promise<string | null> {
  await page.goto('/dashboard');
  await page.waitForLoadState('domcontentloaded');
  await dismissCookies(page);

  // Prefer explicit "Lerneinheit starten" / "Kurs öffnen" CTAs
  const cta = page
    .getByRole('link', { name: /lerneinheit|kurs öffnen|weiter lernen|fortsetzen|start/i })
    .or(page.getByRole('button', { name: /lerneinheit|kurs öffnen|weiter lernen|fortsetzen|start/i }))
    .first();
  const before = page.url();
  if (await cta.isVisible().catch(() => false)) {
    await cta.click().catch(() => {});
    await page.waitForTimeout(1500);
    if (page.url() !== before) return page.url();
  }

  // Fallback — first course link in app
  const courseLink = page.locator('a[href*="/course/"], a[href*="/kurs/"]').first();
  if (await courseLink.isVisible().catch(() => false)) {
    await courseLink.click().catch(() => {});
    await page.waitForTimeout(1500);
    return page.url();
  }
  return null;
}

export { recordFinding, BASE_URL, expect };
