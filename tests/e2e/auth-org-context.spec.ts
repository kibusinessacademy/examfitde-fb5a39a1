/**
 * E2E: Learner & Org Login Reality Check
 *
 * Verifies against the REAL backend (preview/published) that:
 *  1. learner@learner.de can log in and reaches the learner shell
 *  2. org@unternehmen.de can log in and reaches /app/org with a real org context
 *  3. get-org-console-context edge function returns a non-empty org for the org user
 *
 * Credentials (seeded by previous turn):
 *   learner@learner.de    / ExamFit_Test_2026!
 *   org@unternehmen.de    / ExamFit_Test_2026!
 *
 * Override via env:
 *   E2E_LEARNER_EMAIL / E2E_LEARNER_PASSWORD
 *   E2E_ORG_EMAIL     / E2E_ORG_PASSWORD
 *   PLAYWRIGHT_BASE_URL (defaults to preview)
 */
import { test, expect, Page } from '@playwright/test';

const LEARNER = {
  email: process.env.E2E_LEARNER_EMAIL || 'learner@learner.de',
  password: process.env.E2E_LEARNER_PASSWORD || 'ExamFit_Test_2026!',
};

const ORG = {
  email: process.env.E2E_ORG_EMAIL || 'org@unternehmen.de',
  password: process.env.E2E_ORG_PASSWORD || 'ExamFit_Test_2026!',
};

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ubdvvvsiryenhrfmqsvw.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'sb_publishable_3Z80G1ZZqFaK-wzNpNmaZA__1Tc6r8G';

async function dismissCookies(page: Page) {
  const btn = page
    .getByRole('button', { name: /akzeptieren|accept|alle erlauben/i })
    .first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(200);
  }
}

async function loginUI(page: Page, email: string, password: string) {
  await page.goto('/auth');
  await page.waitForLoadState('domcontentloaded');
  await dismissCookies(page);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), {
    timeout: 20_000,
  });
}

async function getAccessToken(email: string, password: string): Promise<string> {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `auth/token failed: ${res.status} ${await res.text().catch(() => '')}`,
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('no access_token in response');
  return json.access_token;
}

test.describe('Auth Reality — Learner & Org login against real backend', () => {
  test('learner can log in via UI and reach learner shell', async ({ page }) => {
    await loginUI(page, LEARNER.email, LEARNER.password);
    // Should NOT be back on /auth and should expose either /dashboard or /app
    const url = new URL(page.url());
    expect(url.pathname).not.toMatch(/^\/auth/);
    // Sanity probe: hit /dashboard, expect not redirected back to /auth
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    expect(new URL(page.url()).pathname).not.toMatch(/^\/auth/);
  });

  test('learner backend session is valid (REST whoami)', async () => {
    const token = await getAccessToken(LEARNER.email, LEARNER.password);
    expect(token.length).toBeGreaterThan(20);
    const me = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    expect(me.ok).toBeTruthy();
    const body = (await me.json()) as { email?: string };
    expect((body.email || '').toLowerCase()).toBe(LEARNER.email.toLowerCase());
  });

  test('org owner can log in via UI and reach /app/org', async ({ page }) => {
    await loginUI(page, ORG.email, ORG.password);
    await page.goto('/app/org');
    await page.waitForLoadState('domcontentloaded');
    expect(new URL(page.url()).pathname).toMatch(/^\/app\/org/);
    // KPI / org shell renders SOMETHING org-flavoured
    await expect(
      page.getByText(/sitze|lizenzen|mitarbeiter|team|organisation/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('get-org-console-context returns a real org for org owner', async () => {
    const token = await getAccessToken(ORG.email, ORG.password);
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/get-org-console-context`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      },
    );
    expect(res.ok, `edge fn status ${res.status}`).toBeTruthy();
    const json = (await res.json()) as {
      orgs?: Array<{ id: string; my_role: string; name: string }>;
      selected?: { org?: { id: string } | null; my_role?: string | null } | null;
    };
    expect(Array.isArray(json.orgs)).toBeTruthy();
    expect((json.orgs || []).length).toBeGreaterThan(0);
    const owner = (json.orgs || []).find(
      (o) => (o.my_role || '').toLowerCase() === 'owner',
    );
    expect(owner, 'org user must own at least one org').toBeTruthy();
    // selected context should resolve to an org with a role
    expect(json.selected?.org?.id).toBeTruthy();
    expect((json.selected?.my_role || '').toLowerCase()).toMatch(
      /owner|admin|manager/,
    );
  });
});
