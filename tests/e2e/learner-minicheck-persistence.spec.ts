/**
 * MiniCheck progress persistence smoke.
 *
 * Walks through a Mini-Check on the first sellable course's first lesson,
 * answers options to completion, then reloads and asserts the result card
 * (`minicheck-result`) is still rendered with a score → progress survived.
 *
 * Soft-skips when:
 *   - No sellable course is available
 *   - Lesson does not surface a MiniCheck (curriculum without quiz block)
 */
import { test, expect, Page } from "@playwright/test";
import { SERVICE_KEY, SUPABASE_URL } from "./helpers/service-key";

const URL_BASE = SUPABASE_URL;
const SERVICE = SERVICE_KEY;
const EMAIL = process.env.E2E_GRANT_LEARNER_EMAIL ?? "e2e+grant@examfit-smoke.local";
const PASSWORD = process.env.E2E_GRANT_LEARNER_PASSWORD ?? "SmokeTest_E2E_2026!";

async function rpc(name: string, body: Record<string, unknown> = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${name} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function login(page: Page) {
  await page.goto("/auth");
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 20_000 });
}

async function answerThroughMiniCheck(page: Page) {
  // Loop until result card or budget exhausted.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await page.getByTestId("minicheck-result").isVisible().catch(() => false)) return;
    const firstOption = page.getByTestId("question-option-0").first();
    if (await firstOption.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await firstOption.click();
      const submit = page.getByTestId("answer-submit");
      if (await submit.isVisible().catch(() => false)) await submit.click();
      const next = page.getByTestId("question-next");
      if (await next.isVisible({ timeout: 5_000 }).catch(() => false)) await next.click();
    } else {
      await page.waitForTimeout(500);
    }
  }
  throw new Error("MiniCheck result card never appeared");
}

test.describe("MiniCheck progress persistence", () => {
  test.skip(!URL_BASE || !SERVICE, "Supabase env required");

  test("complete minicheck → reload → result still shown", async ({ page }) => {
    const sellable = await rpc("public_sellable_courses");
    test.skip(!sellable?.length, "no sellable course available");
    const target = sellable[0];
    await rpc("admin_create_test_purchase_grant", {
      _course_id: target.course_id,
      _user_email: EMAIL,
      _reason: "playwright minicheck smoke",
    });

    await login(page);
    await page.goto(`/course/${target.course_id}`);
    await expect(page.getByTestId("course-continue-btn")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("course-continue-btn").click();
    await page.waitForURL(/\/lesson\//, { timeout: 15_000 });

    const player = page.getByTestId("minicheck-player");
    if (!(await player.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, "Lesson does not expose a MiniCheck");
      return;
    }

    await answerThroughMiniCheck(page);
    await expect(page.getByTestId("minicheck-result")).toBeVisible();
    const scoreBefore = await page.getByTestId("minicheck-result-score").textContent();

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByTestId("minicheck-result")).toBeVisible({ timeout: 20_000 });
    const scoreAfter = await page.getByTestId("minicheck-result-score").textContent();
    expect(scoreAfter?.trim()).toBe(scoreBefore?.trim());
  });
});
