/**
 * E2E: Non-admin user clicking the Handbook "Smoke" button must see a clear
 * "access denied" message (toast) and NOT see a success result.
 *
 * Strategy: Stub supabase.rpc('admin_smoke_handbook_publish_policy') at the
 * network layer to return PostgREST 403 / 42501, then verify the German
 * access-denied toast surfaces.
 */
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

test.describe('Handbook Smoke — non-admin access denied', () => {
  test('non-admin click → toast surfaces forbidden message, no success state', async ({ page }) => {
    // Intercept the rpc POST and return PostgREST permission-denied
    await page.route(/\/rest\/v1\/rpc\/admin_smoke_handbook_publish_policy(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          code: '42501',
          message: 'permission denied for function admin_smoke_handbook_publish_policy',
          details: null,
          hint: null,
        }),
      });
    });

    // Authenticate as a non-admin learner (any non-admin user is fine).
    try {
      await loginAs(page, 'qa_allaccess');
    } catch {
      test.skip(true, 'No learner credentials configured for this env');
    }

    // Navigate to the Leitstelle (admin page is route-guarded → if redirected,
    // we still want to assert the UI cannot grant smoke success).
    await page.goto('/admin/leitstelle', { waitUntil: 'domcontentloaded' });

    const card = page.getByTestId('handbook-publish-drift');
    if (!(await card.isVisible({ timeout: 5_000 }).catch(() => false))) {
      // Route-guard kicked in → already a valid "denied" outcome.
      await expect(page).not.toHaveURL(/\/admin\/leitstelle/);
      return;
    }

    const smokeBtn = card.getByRole('button', { name: /Smoke/i });
    await smokeBtn.click();

    // Sonner toast: matches the exact message from the card's onError handler.
    await expect(
      page.getByText(/Smoke verweigert: Diese Aktion erfordert Admin- oder service-role-Zugriff\. Bitte als Admin einloggen\./),
    ).toBeVisible({ timeout: 5_000 });

    // Negative assertion: no success toast appeared.
    await expect(page.getByText(/Smoke OK/i)).toHaveCount(0);
  });
});
