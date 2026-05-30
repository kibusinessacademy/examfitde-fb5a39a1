/**
 * Pre-Customer Reality helpers.
 * Pre-Login Funnel: Visitor → Beruf → Kurs → Preis → CTA → Checkout-Surface.
 * Builds on tests/customer-reality/_helpers.ts.
 */
import { Page, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { recordFinding, BASE_URL } from '../_helpers';

export const RESULTS_DIR = path.resolve(process.cwd(), 'reality-results');
export const PASS_DIR = path.join(RESULTS_DIR, 'journey-pass');
export const METRIC_FILE = path.join(RESULTS_DIR, 'pre-customer-metrics.json');

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

export function writeMetric(key: string, value: number | string | boolean) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  let cur: Record<string, unknown> = {};
  if (fs.existsSync(METRIC_FILE)) {
    try { cur = JSON.parse(fs.readFileSync(METRIC_FILE, 'utf8')); } catch { /* ignore */ }
  }
  cur[key] = value;
  cur._ts = new Date().toISOString();
  fs.writeFileSync(METRIC_FILE, JSON.stringify(cur, null, 2));
}

export async function dismissCookies(page: Page) {
  const btn = page.getByRole('button', { name: /akzeptieren|accept|alle erlauben/i }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(200);
  }
}

/**
 * Find the first reachable course/product page link starting from the homepage.
 * Tries (in order): /berufe top result → any /berufe/<slug> link → any /kurs|/course link.
 * Returns the final URL or null.
 */
export async function navigateVisitorToCourse(page: Page): Promise<{ url: string | null; ms: number }> {
  const start = Date.now();
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await dismissCookies(page);

  // Step 1: Berufe-Hub
  const berufeLink = page
    .getByRole('link', { name: /berufe|alle berufe|berufsfinder|beruf finden/i })
    .first();
  if (await berufeLink.isVisible().catch(() => false)) {
    await berufeLink.click().catch(() => {});
    await page.waitForLoadState('domcontentloaded');
  } else {
    await page.goto('/berufe');
    await page.waitForLoadState('domcontentloaded');
  }
  await dismissCookies(page);

  // Step 2: First Beruf-Karte
  const candidate = page
    .locator('a[href*="/berufe/"], a[href*="/beruf/"], a[href*="/kurs/"], a[href*="/course/"], a[href*="/produkt/"]')
    .filter({ hasNot: page.locator('[aria-hidden="true"]') })
    .first();
  if (await candidate.isVisible().catch(() => false)) {
    await candidate.click().catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    return { url: page.url(), ms: Date.now() - start };
  }
  return { url: null, ms: Date.now() - start };
}

export { recordFinding, BASE_URL, expect };
