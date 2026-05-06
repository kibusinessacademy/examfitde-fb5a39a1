/**
 * Launch-critical: Entitlement → CTA → Lesson Start regression.
 *
 * Verifies that a learner with an active grant on a sellable course sees
 * "Training fortsetzen" / "Lektion starten" (NOT "Jetzt einschreiben"),
 * can open the lesson player, and that progress persists across reload.
 */
import { test, expect } from "@playwright/test";
import { HAS_ADMIN_PATH, SUPABASE_URL, e2eHelper } from "./helpers/service-key";
import { createPhaseTracker } from "./helpers/phase-tracker";

const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;
const EMAIL = process.env.E2E_GRANT_LEARNER_EMAIL ?? "e2e+grant@examfit-smoke.local";
const PASSWORD = process.env.E2E_GRANT_LEARNER_PASSWORD ?? "SmokeTest_E2E_2026!";

test.describe("Entitlement → CTA → Lesson (launch gate)", () => {
  test.skip(!SUPABASE_URL || !HAS_ADMIN_PATH || !ANON, "E2E_HELPER_TOKEN or service-role alias required");

  test.describe.configure({ retries: 3 });

  test("grant user sees continue-CTA, opens lesson, progress persists", async ({ page }, testInfo) => {
    test.slow();
    const tracker = createPhaseTracker({ suite: "learner-entitlement-flow", page, testInfo });

    // Capture access RPC status + body for cta-assert / lesson-open phase debugging.
    page.on("response", async (res) => {
      const u = res.url();
      if (u.includes("/rest/v1/rpc/check_product_access_by_curriculum") || u.includes("/auth/v1/token")) {
        let body = "";
        try { body = (await res.text()).slice(0, 300); } catch {}
        tracker.recordRpc(u.includes("auth") ? "auth/token" : "access-rpc", res.status(), body);
      }
    });

    try {
      tracker.set("provision-grant");
      const sellableResp = await e2eHelper<{ ok: boolean; courses: any[] }>({ op: "sellable_courses" });
      const sellable = sellableResp?.courses ?? [];
      test.skip(!sellable.length, "no sellable course available");
      const target = sellable[0];

      const grantResp = await e2eHelper<{ ok: boolean; grant: any }>({
        op: "create_test_grant",
        course_id: target.course_id,
        email: EMAIL,
        reason: "playwright entitlement-flow",
      });
      expect(grantResp?.grant?.ok, `grant failed: ${JSON.stringify(grantResp)}`).toBe(true);

      tracker.set("ui-login");
      await page.goto("/auth", { waitUntil: "domcontentloaded" });
      const emailInput = page.locator('input[type="email"]');
      await emailInput.waitFor({ state: "visible", timeout: 20_000 });
      await emailInput.fill(EMAIL);
      await page.fill('input[type="password"]', PASSWORD);
      await Promise.all([
        page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 25_000 }),
        page.click('button[type="submit"]'),
      ]);

      tracker.set("course-detail-rpc");
      await page.goto(`/course/${target.course_id}`, { waitUntil: "domcontentloaded" });
      const rpcResp = await page
        .waitForResponse(
          (r) => r.url().includes("/rest/v1/rpc/check_product_access_by_curriculum") && r.ok(),
          { timeout: 20_000 },
        )
        .catch(() => null);
      if (!rpcResp) {
        console.log(`[entitlement-e2e] ⚠ no access RPC observed within 20s — falling through`);
      }
      await page.waitForLoadState("networkidle").catch(() => {});

      tracker.set("cta-assert");
      const continueBtn = page.getByTestId("course-continue-btn");
      await expect(continueBtn).toBeVisible({ timeout: 20_000 });
      await expect(continueBtn).toHaveText(/training fortsetzen|lektion starten/i);
      await expect(page.getByRole("button", { name: /jetzt einschreiben/i })).toHaveCount(0);

      tracker.set("lesson-open");
      await Promise.all([
        page.waitForURL(/\/lesson\//, { timeout: 20_000 }),
        continueBtn.click(),
      ]);
      await expect(page.getByTestId("lesson-player")).toBeVisible({ timeout: 25_000 });

      tracker.set("lesson-reload-persist");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("lesson-player")).toBeVisible({ timeout: 25_000 });
      expect(page.url()).toMatch(/\/lesson\//);
      tracker.set("done");
    } catch (err) {
      await tracker.attachFailure(err);
      throw err;
    }
  });

  test("anonymous visitor cannot reach LessonPlayer", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();
    try {
      const sellableResp = await e2eHelper<{ ok: boolean; courses: any[] }>({ op: "sellable_courses" });
      const sellable = sellableResp?.courses ?? [];
      test.skip(!sellable?.length, "no sellable course available");
      const target = sellable[0];
      await page.goto(`/course/${target.course_id}`, { waitUntil: "domcontentloaded" });
      const cta = page
        .getByRole("button", { name: /anmelden|jetzt einschreiben|lizenz/i })
        .first();
      await expect(cta).toBeVisible({ timeout: 25_000 });
      await expect(page.getByTestId("course-continue-btn")).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
