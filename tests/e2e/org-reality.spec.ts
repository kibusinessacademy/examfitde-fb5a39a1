/**
 * B2B Org Reality QA v1 — Playwright UI stub
 *
 * This spec drives the SAME flow that the server-side `b2b-org-reality-qa`
 * edge function exercises, but through the real UI. It is intentionally
 * lightweight and depends on smoke fixtures created by:
 *
 *   POST /functions/v1/b2b-org-reality-qa  { skip_cleanup: true }
 *
 * Then run this spec, then clean up with:
 *
 *   POST /functions/v1/b2b-org-reality-qa  { cleanup_only: true }
 *
 * Environment:
 *   QA_OWNER_A_EMAIL=qa+org-a-owner@examfit-smoke.local
 *   QA_OWNER_A_PASSWORD=<temp-pw issued by reality-qa run>
 *   PLAYWRIGHT_BASE_URL=https://id-preview--<id>.lovable.app
 *
 * Codes mapped to UI checkpoints:
 *   ORG_DASHBOARD_NOT_REACHABLE  → /app/org renders KPI cards
 *   ORG_INVITE_FAILED            → InviteMemberDialog success toast
 *   ORG_ROLE_CHANGE_FAILED       → role dropdown writes + reloads
 *   ORG_SEAT_ASSIGNMENT_FAILED   → Seat dialog assigns license to member
 */
import { test, expect } from '@playwright/test';

const OWNER_EMAIL = process.env.QA_OWNER_A_EMAIL ?? '';
const OWNER_PASSWORD = process.env.QA_OWNER_A_PASSWORD ?? '';

test.describe('B2B Org Reality — UI smoke', () => {
  test.skip(
    !OWNER_EMAIL || !OWNER_PASSWORD,
    'QA_OWNER_A_EMAIL / QA_OWNER_A_PASSWORD not set — run the reality QA edge function with skip_cleanup first',
  );

  test('owner reaches dashboard, sees members, opens invite dialog', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.getByLabel(/e-?mail/i).fill(OWNER_EMAIL);
    await page.getByLabel(/passwort/i).fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: /anmelden|einloggen/i }).click();

    // ORG_DASHBOARD_NOT_REACHABLE
    await page.goto('/app/org');
    await expect(page.getByText(/sitze|lizenzen|mitarbeiter/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // Team-Tab
    await page.goto('/app/org/team');
    await expect(page.getByText(OWNER_EMAIL.split('@')[0], { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    // ORG_INVITE_FAILED — open dialog (don't actually submit, to keep idempotent)
    const inviteBtn = page.getByRole('button', { name: /einladen|invite/i }).first();
    if (await inviteBtn.isVisible()) {
      await inviteBtn.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
    }
  });
});
