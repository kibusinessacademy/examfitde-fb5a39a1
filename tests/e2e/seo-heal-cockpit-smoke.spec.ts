/**
 * SEO Heal Cockpit — Smoke (Diagnostics tab → SEO Card → Rollback Dialog).
 *
 * Read-only smoke. Verifies:
 *  1. Admin reaches /admin/heal
 *  2. Erweitert accordion expands → Diagnostik tab
 *  3. SeoJobHealthCard renders
 *  4. Rollback dialog opens (no toggle is fired)
 *  5. Telemetry section + Filter bar are visible
 *
 * Toggling the actual flag is intentionally NOT done here — that is reserved
 * for an isolated test environment with the admin_set_seo_feature_flag RPC
 * gated by a sandboxed flag_key.
 *
 * Skipped automatically when admin credentials are missing.
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL =
  process.env.E2E_ADMIN_EMAIL || process.env.E2E_EMAIL || "";
const ADMIN_PASS =
  process.env.E2E_ADMIN_PASSWORD || process.env.E2E_PASSWORD || "";

test.describe("SEO Heal Cockpit smoke", () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASS,
    "Set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD to run the SEO admin smoke",
  );

  test("Diagnostics → SEO Card → Rollback Dialog renders telemetry + filters", async ({
    page,
  }) => {
    // 1. Login
    await page.goto("/auth");
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/auth"), {
      timeout: 20_000,
    });

    // 2. Heal Cockpit
    await page.goto("/admin/heal");
    await expect(
      page.getByRole("heading", { name: /Heal Cockpit/i }),
    ).toBeVisible({ timeout: 15_000 });

    // 3. Expand "Erweitert" accordion (it's collapsed by default)
    const erweitert = page.getByRole("button", { name: /Erweitert/i }).first();
    await erweitert.click();

    // 4. Switch to Diagnostik tab
    await page.getByRole("tab", { name: /Diagnostik/i }).click();

    // 5. SEO Card visible
    const seoCard = page
      .locator("section,article,div")
      .filter({ hasText: /SEO.*Job.*Health|seo_sitemap_refresh/i })
      .first();
    await expect(seoCard).toBeVisible({ timeout: 10_000 });

    // 6. Open Rollback dialog
    const rollbackBtn = page
      .getByRole("button", { name: /Rollback…|Aktivieren/ })
      .first();
    await rollbackBtn.click();

    // 7. Dialog rendered with telemetry + filter bar (read-only checks)
    await expect(
      page.getByRole("dialog").getByText(/Toggle-Telemetrie/i),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("24h:")).toBeVisible();
    await expect(page.getByText("7d:")).toBeVisible();
    await expect(page.getByText("Score:")).toBeVisible();
    await expect(page.getByLabel(/min Score/i)).toBeVisible();
    await expect(page.getByLabel(/error_code/i)).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: /hard_fail/i }),
    ).toBeVisible();

    // 8. Close — explicitly do NOT submit
    await page.keyboard.press("Escape");
  });
});
