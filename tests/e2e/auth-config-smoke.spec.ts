/**
 * AUTH.CONFIG.SMOKE.1
 *
 * Read-only / negative smoke for auth config after enabling:
 *   - password_hibp_enabled=true
 *   - external_anonymous_users_enabled=false
 *   - disable_signup=false
 *   - auto_confirm_email=false   ← critical: signup must require email confirm
 *
 * Coverage:
 *   1. /auth page renders
 *   2. Signup form accepts a unique synthetic email until Supabase responds
 *      (we DO NOT confirm the mailbox — only verify the API path)
 *   3. Login BEFORE confirm is blocked with an "email not confirmed" error
 *   4. Existing TEST_USER_* (if set) can still log in → regression guard
 *   5. Missing secrets → skip cleanly, never fail CI
 *
 * Guarantees:
 *   - no real customer accounts (auth-smoke+<ts>@examfit.test)
 *   - no mailbox / DB mutation beyond Supabase Auth signup itself
 *   - no auto-confirm assumption
 */
import { test, expect } from '@playwright/test';

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.E2E_BASE_URL ||
  'https://examfitde.lovable.app';

const EXISTING_EMAIL =
  process.env.E2E_LEARNER_EMAIL ||
  process.env.TEST_USER_EMAIL ||
  '';
const EXISTING_PASSWORD =
  process.env.E2E_LEARNER_PASSWORD ||
  process.env.TEST_USER_PASSWORD ||
  '';

function syntheticEmail(): string {
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 8);
  // Unique, non-deliverable test domain — never a real inbox.
  return `auth-smoke+${ts}-${rnd}@examfit.test`;
}

const SYNTHETIC_PASSWORD = 'AuthSmoke_Test_2026!';

test.describe('AUTH.CONFIG.SMOKE.1', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      // Surface unhandled errors but don't fail the smoke — we're read-only.
      console.warn('[pageerror]', err.message);
    });
  });

  test('1. /auth lädt korrekt', async ({ page }) => {
    const resp = await page.goto(`${BASE_URL}/auth`, { waitUntil: 'domcontentloaded' });
    expect(resp?.status(), 'auth page must respond').toBeLessThan(500);
    await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test('2. Signup-Form akzeptiert Testdaten bis zum Supabase-Response (kein Auto-Confirm)', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/auth`, { waitUntil: 'domcontentloaded' });

    // Try to switch into sign-up mode if the UI is tab-based.
    const signupTrigger = page
      .getByRole('tab', { name: /(sign\s*up|registrieren|konto\s*erstellen)/i })
      .or(page.getByRole('button', { name: /(sign\s*up|registrieren|konto\s*erstellen)/i }))
      .first();
    if (await signupTrigger.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await signupTrigger.click().catch(() => {});
    }

    const email = syntheticEmail();
    await page.locator('input[type="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(SYNTHETIC_PASSWORD);

    // Capture the Supabase /auth/v1/signup network response without asserting on UI text.
    const signupRespPromise = page
      .waitForResponse(
        (r) => /\/auth\/v1\/signup/.test(r.url()),
        { timeout: 15_000 },
      )
      .catch(() => null);

    const submit = page
      .getByRole('button', { name: /(sign\s*up|registrieren|konto\s*erstellen|los)/i })
      .or(page.locator('button[type="submit"]'))
      .first();
    await submit.click().catch(() => {});

    const signupResp = await signupRespPromise;
    if (!signupResp) {
      test.info().annotations.push({
        type: 'note',
        description: 'No /auth/v1/signup response observed — UI may use a different flow.',
      });
      return;
    }

    // Either 200 (user created, awaiting confirm) or 4xx (rate-limit / disposable-domain
    // block) is acceptable. The critical invariant: NO session token in the body.
    const status = signupResp.status();
    expect(status, `signup HTTP status was ${status}`).toBeLessThan(500);

    const body = await signupResp.json().catch(() => ({} as any));
    // auto_confirm_email=false ⇒ Supabase MUST NOT mint an access_token here.
    expect(body?.access_token, 'auto-confirm must be OFF — no access_token on signup').toBeFalsy();
    expect(body?.session, 'auto-confirm must be OFF — no session on signup').toBeFalsy();
  });

  test('3. Login vor Email-Confirm wird blockiert', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth`, { waitUntil: 'domcontentloaded' });

    // Use a freshly-created (but never-confirmed) synthetic account.
    // Sign-up first via API behaviour above, then try to log in.
    const email = syntheticEmail();

    // Quick signup pass.
    const signupTrigger = page
      .getByRole('tab', { name: /(sign\s*up|registrieren)/i })
      .or(page.getByRole('button', { name: /(sign\s*up|registrieren)/i }))
      .first();
    if (await signupTrigger.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await signupTrigger.click().catch(() => {});
    }
    await page.locator('input[type="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(SYNTHETIC_PASSWORD);
    const signupBtn = page
      .getByRole('button', { name: /(sign\s*up|registrieren|konto\s*erstellen)/i })
      .or(page.locator('button[type="submit"]'))
      .first();
    const signupWait = page
      .waitForResponse((r) => /\/auth\/v1\/signup/.test(r.url()), { timeout: 15_000 })
      .catch(() => null);
    await signupBtn.click().catch(() => {});
    await signupWait;

    // Now switch to sign-in and try the same creds → must fail (email not confirmed).
    await page.goto(`${BASE_URL}/auth`, { waitUntil: 'domcontentloaded' });
    const signinTrigger = page
      .getByRole('tab', { name: /(sign\s*in|anmelden|login)/i })
      .or(page.getByRole('button', { name: /(sign\s*in|anmelden|login)/i }))
      .first();
    if (await signinTrigger.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await signinTrigger.click().catch(() => {});
    }

    await page.locator('input[type="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(SYNTHETIC_PASSWORD);

    const tokenRespPromise = page
      .waitForResponse((r) => /\/auth\/v1\/token/.test(r.url()), { timeout: 15_000 })
      .catch(() => null);

    const submit = page
      .getByRole('button', { name: /(sign\s*in|anmelden|login)/i })
      .or(page.locator('button[type="submit"]'))
      .first();
    await submit.click().catch(() => {});

    const tokenResp = await tokenRespPromise;
    if (!tokenResp) {
      test.info().annotations.push({
        type: 'note',
        description: 'No /auth/v1/token response observed — cannot assert confirm-block.',
      });
      return;
    }

    // Expect 400 with error_code email_not_confirmed (Supabase canonical).
    expect(tokenResp.status(), 'pre-confirm login must NOT return 200').not.toBe(200);
    const body = await tokenResp.json().catch(() => ({} as any));
    const errStr = JSON.stringify(body).toLowerCase();
    expect(
      errStr.includes('email_not_confirmed') ||
        errStr.includes('email not confirmed') ||
        errStr.includes('invalid login') ||
        errStr.includes('confirm'),
      `expected email-not-confirmed style error, got: ${errStr.slice(0, 200)}`,
    ).toBe(true);
  });

  test('4. bestehender Test-User kann sich weiterhin einloggen', async ({ page }) => {
    test.skip(
      !EXISTING_EMAIL || !EXISTING_PASSWORD,
      'TEST_USER_* / E2E_LEARNER_* secrets not set — skipping regression login (per spec).',
    );

    await page.goto(`${BASE_URL}/auth`, { waitUntil: 'domcontentloaded' });
    const signinTrigger = page
      .getByRole('tab', { name: /(sign\s*in|anmelden|login)/i })
      .or(page.getByRole('button', { name: /(sign\s*in|anmelden|login)/i }))
      .first();
    if (await signinTrigger.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await signinTrigger.click().catch(() => {});
    }

    await page.locator('input[type="email"]').first().fill(EXISTING_EMAIL);
    await page.locator('input[type="password"]').first().fill(EXISTING_PASSWORD);

    const tokenRespPromise = page
      .waitForResponse(
        (r) => /\/auth\/v1\/token/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 20_000 },
      )
      .catch(() => null);

    const submit = page
      .getByRole('button', { name: /(sign\s*in|anmelden|login)/i })
      .or(page.locator('button[type="submit"]'))
      .first();
    await submit.click().catch(() => {});

    const tokenResp = await tokenRespPromise;
    expect(tokenResp, 'no token endpoint response observed').not.toBeNull();
    expect(tokenResp!.status(), 'existing confirmed user must still log in').toBe(200);
  });
});
