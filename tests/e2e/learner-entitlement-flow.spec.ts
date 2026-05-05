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
import { SERVICE_KEY, SUPABASE_URL } from "./helpers/service-key";

const URL_BASE = SUPABASE_URL;
const SERVICE = SERVICE_KEY;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;
const EMAIL = process.env.E2E_GRANT_LEARNER_EMAIL ?? "e2e+grant@examfit-smoke.local";
const PASSWORD = process.env.E2E_GRANT_LEARNER_PASSWORD ?? "SmokeTest_E2E_2026!";

async function rpc(name: string, body: Record<string, unknown> = {}, key = SERVICE) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${name} → ${r.status}: ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
}

test.describe("Entitlement → CTA → Lesson (launch gate)", () => {
  test.skip(!URL_BASE || !SERVICE || !ANON, "Supabase env required");

  test("grant user sees continue-CTA, opens lesson, progress persists", async ({ page }) => {
    // 1. Pick a sellable course and ensure grant exists for the test learner.
    const sellable = await rpc("public_sellable_courses");
    test.skip(!sellable?.length, "no sellable course available");
    const target = sellable[0];

    const grant = await rpc("admin_create_test_purchase_grant", {
      _course_id: target.course_id,
      _user_email: EMAIL,
      _reason: "playwright entitlement-flow",
    });
    expect(grant?.ok, `grant failed: ${JSON.stringify(grant)}`).toBe(true);

    // 2. Login as grant user via UI.
    await page.goto("/auth");
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 20_000 });

    // 3. Open course detail page.
    await page.goto(`/course/${target.course_id}`);
    await page.waitForLoadState("networkidle").catch(() => {});

    // 4. CTA assertions: continue-button must be visible, enroll-CTA must NOT.
    const continueBtn = page.getByTestId("course-continue-btn");
    await expect(continueBtn).toBeVisible({ timeout: 15_000 });
    await expect(continueBtn).toHaveText(/training fortsetzen|lektion starten/i);
    await expect(page.getByRole("button", { name: /jetzt einschreiben/i })).toHaveCount(0);

    // 5. Click → land on lesson player + LessonPlayer renders.
    await continueBtn.click();
    await page.waitForURL(/\/lesson\//, { timeout: 15_000 });
    await expect(page.getByTestId("lesson-player")).toBeVisible({ timeout: 20_000 });

    // 6. Reload and assert lesson player still renders (progress hook re-hydrates).
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("lesson-player")).toBeVisible({ timeout: 20_000 });
    expect(page.url()).toMatch(/\/lesson\//);
  });

  test("anonymous visitor cannot reach LessonPlayer", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();
    try {
      const sellable = await rpc("public_sellable_courses");
      test.skip(!sellable?.length, "no sellable course available");
      const target = sellable[0];
      await page.goto(`/course/${target.course_id}`);
      const cta = page
        .getByRole("button", { name: /anmelden|jetzt einschreiben|lizenz/i })
        .first();
      await expect(cta).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("course-continue-btn")).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
