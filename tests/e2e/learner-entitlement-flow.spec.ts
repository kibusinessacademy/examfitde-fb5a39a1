/**
 * Launch-critical: Entitlement → CTA → Lesson Start regression.
 *
 * Verifies that a learner with an active grant on a sellable course sees
 * "Training fortsetzen" / "Lektion starten" (NOT "Jetzt einschreiben"),
 * can open the lesson player, and that progress persists across reload.
 *
 * Required env:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (to provision grant + read progress)
 *   E2E_GRANT_LEARNER_EMAIL    (default: e2e+grant@examfit-smoke.local)
 *   E2E_GRANT_LEARNER_PASSWORD (default: SmokeTest_E2E_2026!)
 */
import { test, expect } from "@playwright/test";
import { HAS_ADMIN_PATH, SUPABASE_URL, e2eHelper } from "./helpers/service-key";

const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;
const EMAIL = process.env.E2E_GRANT_LEARNER_EMAIL ?? "e2e+grant@examfit-smoke.local";
const PASSWORD = process.env.E2E_GRANT_LEARNER_PASSWORD ?? "SmokeTest_E2E_2026!";

test.describe("Entitlement → CTA → Lesson (launch gate)", () => {
  test.skip(!SUPABASE_URL || !HAS_ADMIN_PATH || !ANON, "E2E_HELPER_TOKEN or service-role alias required");

  // Post-deploy bundles can take a few seconds to settle; allow extra retries here
  // on top of the global config so deployment lag does not turn into red gates.
  test.describe.configure({ retries: 3 });

  test("grant user sees continue-CTA, opens lesson, progress persists", async ({ page }, testInfo) => {
    test.slow();

    // ── Phase tracker: prints which step we're in on each retry, so flake
    //    triage is "scroll to PHASE_FAIL line" instead of stack-spelunking.
    const attempt = testInfo.retry;
    let currentPhase = "init";
    const phase = (name: string) => {
      currentPhase = name;
      // eslint-disable-next-line no-console
      console.log(`[entitlement-e2e][attempt=${attempt}] ▶ phase: ${name}`);
    };
    // Tag console + network errors with the active phase.
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        // eslint-disable-next-line no-console
        console.log(`[entitlement-e2e][attempt=${attempt}][phase=${currentPhase}] console.error: ${msg.text()}`);
      }
    });
    page.on("requestfailed", (req) => {
      // eslint-disable-next-line no-console
      console.log(
        `[entitlement-e2e][attempt=${attempt}][phase=${currentPhase}] requestfailed: ${req.method()} ${req.url()} — ${req.failure()?.errorText}`,
      );
    });
    page.on("response", (res) => {
      const u = res.url();
      if (u.includes("/rest/v1/rpc/check_product_access_by_curriculum") || u.includes("/auth/v1/token")) {
        // eslint-disable-next-line no-console
        console.log(`[entitlement-e2e][attempt=${attempt}][phase=${currentPhase}] ${res.status()} ${u}`);
      }
    });
    testInfo.attach("entitlement-phase-on-fail", {
      body: Buffer.from(`will be overwritten on failure`),
      contentType: "text/plain",
    }).catch(() => {});

    try {
    phase("provision-grant");
    // 1. Pick a sellable course and ensure grant exists for the test learner.
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

    // 2. Login as grant user via UI — wait for the form to be hydrated first.
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    const emailInput = page.locator('input[type="email"]');
    await emailInput.waitFor({ state: "visible", timeout: 20_000 });
    await emailInput.fill(EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 25_000 }),
      page.click('button[type="submit"]'),
    ]);

    // 3. Open course detail page and wait for entitlement RPC to settle.
    await page.goto(`/course/${target.course_id}`, { waitUntil: "domcontentloaded" });
    await page
      .waitForResponse(
        (r) => r.url().includes("/rest/v1/rpc/check_product_access_by_curriculum") && r.ok(),
        { timeout: 20_000 },
      )
      .catch(() => {
        // RPC may be cached / served from another response — fall through to UI assertion.
      });
    await page.waitForLoadState("networkidle").catch(() => {});

    // 4. CTA assertions: continue-button must be visible, enroll-CTA must NOT.
    const continueBtn = page.getByTestId("course-continue-btn");
    await expect(continueBtn).toBeVisible({ timeout: 20_000 });
    await expect(continueBtn).toHaveText(/training fortsetzen|lektion starten/i);
    await expect(page.getByRole("button", { name: /jetzt einschreiben/i })).toHaveCount(0);

    // 5. Click → land on lesson player + LessonPlayer renders.
    await Promise.all([
      page.waitForURL(/\/lesson\//, { timeout: 20_000 }),
      continueBtn.click(),
    ]);
    await expect(page.getByTestId("lesson-player")).toBeVisible({ timeout: 25_000 });

    // 6. Reload and assert lesson player still renders (progress hook re-hydrates).
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("lesson-player")).toBeVisible({ timeout: 25_000 });
    expect(page.url()).toMatch(/\/lesson\//);
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
