/**
 * Mobile-IAP Smoke — admin harness Playwright spec.
 *
 * Skips when no admin session is available (env-driven login).
 * Verifies the harness renders and exposes the smoke configuration form.
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASS = process.env.E2E_ADMIN_PASS;

test.describe("Mobile IAP Smoke Harness", () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASS, "admin credentials not provided");

  test("loads and shows smoke configuration", async ({ page }) => {
    await page.goto("/auth");
    await page.getByLabel(/e-mail/i).fill(ADMIN_EMAIL!);
    await page.getByLabel(/passwort/i).fill(ADMIN_PASS!);
    await page.getByRole("button", { name: /anmelden|login/i }).click();
    await page.waitForLoadState("networkidle");

    await page.goto("/admin/tools/mobile-iap-smoke");
    await expect(page.getByRole("heading", { name: /Mobile-IAP Smoke Harness/i })).toBeVisible();
    await expect(page.getByText(/SSOT/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Smoke ausführen/i })).toBeVisible();
  });
});
