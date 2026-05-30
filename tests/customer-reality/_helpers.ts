/**
 * Customer-Reality helpers.
 *
 * Reads credentials from REALITY_* env vars (workflow secrets).
 * Missing creds → tests sauber skippen statt fälschlich grün.
 */
import { Page, expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const BASE_URL =
  process.env.REALITY_BASE_URL ||
  process.env.PREVIEW_URL ||
  'https://examfitde.lovable.app';

export const PM = {
  email: process.env.REALITY_PM_EMAIL || '',
  password: process.env.REALITY_PM_PASSWORD || '',
};

export const OWNER = {
  email: process.env.REALITY_OWNER_EMAIL || '',
  password: process.env.REALITY_OWNER_PASSWORD || '',
};

export const HAS_PM = !!(PM.email && PM.password);
export const HAS_OWNER = !!(OWNER.email && OWNER.password);

export const REPORT_DIR = path.resolve(
  process.cwd(),
  'reality-results',
);

export function ensureReportDir() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.mkdirSync(path.join(REPORT_DIR, 'findings'), { recursive: true });
}

export type Severity = 'P0' | 'P1' | 'P2';
export type FindingKind =
  | 'dead_cta'
  | 'dead_button'
  | 'broken_route'
  | 'white_screen'
  | 'spinner_loop'
  | 'console_error'
  | 'missing_trust_page'
  | 'login_failed'
  | 'sidebar_broken'
  | 'workflow_no_feedback'
  | 'placeholder_end_state'
  | 'demo_unreachable'
  | 'checkout_unreachable'
  | 'role_blocked'
  | 'http_error';

export interface Finding {
  severity: Severity;
  kind: FindingKind;
  journey: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'AUDIT';
  route?: string;
  detail: string;
  fix?: string;
  ts: string;
}

/**
 * Append a finding to disk so the aggregator can pick it up without depending
 * on Playwright reporter internals.
 */
export function recordFinding(f: Omit<Finding, 'ts'>) {
  ensureReportDir();
  const full: Finding = { ...f, ts: new Date().toISOString() };
  const file = path.join(
    REPORT_DIR,
    'findings',
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(full, null, 2));
}

/**
 * Login via /auth. Skip the calling test if creds missing.
 */
export async function loginOrSkip(page: Page, who: 'pm' | 'owner' = 'pm') {
  const user = who === 'owner' ? OWNER : PM;
  test.skip(
    !user.email || !user.password,
    `Skip: REALITY_${who.toUpperCase()}_EMAIL / _PASSWORD nicht gesetzt. Test als SKIP markiert — kein falsches Grün.`,
  );

  await page.goto('/auth');
  await page.waitForLoadState('domcontentloaded');
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);
  await page.click('button[type="submit"]');

  try {
    await page.waitForURL((url) => !url.pathname.startsWith('/auth'), {
      timeout: 15_000,
    });
  } catch (e) {
    recordFinding({
      severity: 'P0',
      kind: 'login_failed',
      journey: 'C',
      route: '/auth',
      detail: `Login mit ${who} schlug fehl: kein Redirect aus /auth.`,
      fix: 'Reality-Testnutzer prüfen, Auth-Flow reparieren — ohne Login keine Reality-Garantie.',
    });
    throw e;
  }
}

/**
 * Sammle console errors während eines Tests. Bestimmte benign Warnings filtern.
 */
export function attachConsoleSink(page: Page): { errors: string[] } {
  const errors: string[] = [];
  const benign = [
    'favicon',
    'ResizeObserver loop',
    'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT', // ad-blocker test envs
  ];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!benign.some((b) => text.includes(b))) errors.push(text);
    }
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return { errors };
}

/**
 * Detect "white screen" = body has effectively no visible text after load.
 */
export async function isWhiteScreen(page: Page): Promise<boolean> {
  const text = (await page.locator('body').innerText().catch(() => '')) || '';
  return text.trim().length < 20;
}

/**
 * Detect endless spinner: still a spinner visible after `timeout` and no
 * meaningful main content.
 */
export async function isSpinnerLoop(page: Page, timeout = 6000): Promise<boolean> {
  const spinner = page
    .locator('[role="progressbar"], [data-loading="true"], .animate-spin')
    .first();
  if (!(await spinner.isVisible().catch(() => false))) return false;
  await page.waitForTimeout(timeout);
  return (
    (await spinner.isVisible().catch(() => false)) &&
    (await isWhiteScreen(page))
  );
}

export { expect };
