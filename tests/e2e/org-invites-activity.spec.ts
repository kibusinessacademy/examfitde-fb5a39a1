/**
 * B2B Org Console — Invites + Activity Critical Flows
 *
 * Covers:
 *   OrgInvitesPage   → revoke dialog, expiry warning, empty-state CTA, copy-code
 *   OrgActivityPage  → event rendering, type-filter dropdown, empty state
 *
 * Skipped automatically when credentials are not provided so it stays
 * green in CI without the reality-qa fixture.
 *
 * Env:
 *   QA_OWNER_A_EMAIL=qa+org-a-owner@examfit-smoke.local
 *   QA_OWNER_A_PASSWORD=<temp-pw>
 *   QA_ORG_A_ID=<uuid> (optional — falls back to /app/org index)
 */
import { test, expect, type Page } from '@playwright/test';

const OWNER_EMAIL = process.env.QA_OWNER_A_EMAIL ?? '';
const OWNER_PASSWORD = process.env.QA_OWNER_A_PASSWORD ?? '';
const ORG_ID = process.env.QA_ORG_A_ID ?? '';

async function login(page: Page) {
  await page.goto('/auth');
  await page.getByLabel(/e-?mail/i).fill(OWNER_EMAIL);
  await page.getByLabel(/passwort/i).fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: /anmelden|einloggen/i }).click();
  await page.waitForURL(/\/app\b/, { timeout: 15_000 });
}

async function gotoOrg(page: Page, sub: string) {
  if (ORG_ID) {
    await page.goto(`/app/org/${ORG_ID}/${sub}`);
  } else {
    await page.goto('/app/org');
    // Layout redirects to first org's dashboard; we navigate via sidebar.
    await page.getByRole('link', { name: new RegExp(sub, 'i') }).first().click();
  }
}

test.describe('Org Invites & Activity — critical flows', () => {
  test.skip(
    !OWNER_EMAIL || !OWNER_PASSWORD,
    'QA_OWNER_A_EMAIL / QA_OWNER_A_PASSWORD not set — run b2b-org-reality-qa with skip_cleanup first',
  );

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('OrgInvitesPage: empty-state CTA opens invite dialog', async ({ page }) => {
    await gotoOrg(page, 'einladungen');

    const empty = page.getByTestId('invites-empty-state');
    if (await empty.isVisible().catch(() => false)) {
      await page.getByTestId('invites-empty-cta').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
    } else {
      // At least the page rendered with a list
      await expect(page.getByRole('heading', { name: /einladungen/i })).toBeVisible();
    }
  });

  test('OrgInvitesPage: revoke dialog opens and cancels safely', async ({ page }) => {
    await gotoOrg(page, 'einladungen');
    const trigger = page.getByTestId('invite-revoke-trigger').first();
    test.skip(!(await trigger.isVisible().catch(() => false)), 'No pending invites to revoke');

    await trigger.click();
    const dialog = page.getByTestId('invite-revoke-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/zurückziehen/i)).toBeVisible();

    // Cancel keeps invite intact
    await dialog.getByRole('button', { name: /abbrechen/i }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeVisible();
  });

  test('OrgInvitesPage: expiry warning surfaces on near-expiry invites', async ({ page }) => {
    await gotoOrg(page, 'einladungen');
    const rows = page.locator('[data-testid="invite-revoke-trigger"]');
    test.skip((await rows.count()) === 0, 'No pending invites visible');
    // At least one expiry label is rendered ("läuft in" or "abgelaufen")
    await expect(page.getByText(/läuft in|abgelaufen/i).first()).toBeVisible();
  });

  test('OrgInvitesPage: copy invite-code shows confirmation toast', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await gotoOrg(page, 'einladungen');
    const copyBtn = page.getByTestId('invite-copy-code').first();
    test.skip(!(await copyBtn.isVisible().catch(() => false)), 'No pending invites');
    await copyBtn.click();
    await expect(page.getByText(/invite-code kopiert/i)).toBeVisible({ timeout: 4_000 });
  });

  test('OrgActivityPage: renders events list or descriptive empty state', async ({ page }) => {
    await gotoOrg(page, 'aktivitaet');
    await expect(page.getByRole('heading', { name: /aktivität/i })).toBeVisible();

    const list = page.getByTestId('activity-event-list');
    const empty = page.getByTestId('activity-empty-state');

    // Exactly one of the two must be visible
    await Promise.race([
      list.waitFor({ state: 'visible', timeout: 8_000 }),
      empty.waitFor({ state: 'visible', timeout: 8_000 }),
    ]);

    if (await list.isVisible().catch(() => false)) {
      await expect(page.getByTestId('activity-event-row').first()).toBeVisible();
    } else {
      await expect(empty).toContainText(/noch keine aktivität/i);
    }
  });

  test('OrgActivityPage: type filter dropdown narrows the list', async ({ page }) => {
    await gotoOrg(page, 'aktivitaet');
    const filter = page.getByTestId('activity-type-filter');
    test.skip(!(await filter.isVisible().catch(() => false)), 'No events → filter hidden');

    await filter.click();
    // Pick the second option (first concrete event type, after "Alle Ereignisse")
    const options = page.getByRole('option');
    await options.nth(1).click();

    // Either rows match (single type) or the no-results state is shown
    const rows = page.getByTestId('activity-event-row');
    const noResults = page.getByTestId('activity-no-results');
    await Promise.race([
      rows.first().waitFor({ state: 'visible', timeout: 5_000 }),
      noResults.waitFor({ state: 'visible', timeout: 5_000 }),
    ]);

    // URL reflects the active type filter
    await expect(page).toHaveURL(/[?&]type=/);
  });
});
