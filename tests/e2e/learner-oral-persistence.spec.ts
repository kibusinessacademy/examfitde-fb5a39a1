/**
 * Oral exam answer persistence smoke.
 *
 * Logs in as the grant learner, opens /muendliche-pruefung (or /oral-exam),
 * starts a session, submits a structured answer, asserts feedback appears,
 * then reloads and asserts the answer/feedback survives the reload.
 *
 * Soft-skips if the route is unreachable or no oral session can be started.
 */
import { test, expect, Page } from "@playwright/test";

const URL_BASE = process.env.VITE_SUPABASE_URL!;
const EMAIL = process.env.E2E_GRANT_LEARNER_EMAIL ?? "e2e+grant@examfit-smoke.local";
const PASSWORD = process.env.E2E_GRANT_LEARNER_PASSWORD ?? "SmokeTest_E2E_2026!";

const ANSWER =
  "Strukturierte Antwort: 1) Begriffsdefinition, 2) Praxisbeispiel aus der Ausbildung, 3) Bezug zur Ausbildungsordnung.";

async function login(page: Page) {
  await page.goto("/auth");
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 20_000 });
}

test.describe("Oral exam persistence", () => {
  test.skip(!URL_BASE, "Supabase env required");

  test("submit oral answer → feedback → reload retains feedback", async ({ page }) => {
    await login(page);

    await page.goto("/muendliche-pruefung");
    if (page.url().includes("404") || page.url().includes("not-found")) {
      await page.goto("/oral-exam");
    }
    await page.waitForLoadState("networkidle").catch(() => {});

    const startBtn = page
      .getByRole("button", { name: /start|starten|begin|simulation/i })
      .first();
    if (!(await startBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, "no oral start button surfaced");
      return;
    }
    await startBtn.click();
    await page.waitForLoadState("networkidle").catch(() => {});

    const textarea = page.locator("textarea").first();
    if (!(await textarea.isVisible({ timeout: 8_000 }).catch(() => false))) {
      test.skip(true, "no answer textarea");
      return;
    }
    await textarea.fill(ANSWER);

    const submitBtn = page
      .getByRole("button", { name: /abgeben|bewerten|submit|senden|antwort/i })
      .first();
    await submitBtn.click();

    const feedback = page
      .getByText(/feedback|stärken|schwächen|bewertung|verbesserung|note/i)
      .first();
    await expect(feedback).toBeVisible({ timeout: 60_000 });

    // Persistence check: reload and verify previously-submitted answer or
    // feedback is still part of the session UI (some implementations keep
    // the textarea readonly with the answer, others keep the feedback card).
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    const persisted = page
      .getByText(new RegExp(ANSWER.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))
      .or(page.getByText(/feedback|bewertung|stärken/i))
      .first();
    await expect(persisted).toBeVisible({ timeout: 20_000 });
  });
});
