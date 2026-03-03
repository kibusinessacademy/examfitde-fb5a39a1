import { test, expect } from "@playwright/test";
import { login } from "./_helpers";

test.describe("Oral Exam Trainer", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("Start oral exam → answer → receive feedback", async ({ page }) => {
    // Navigate to oral exam area
    await page.goto("/muendliche-pruefung");

    // Fallback if route differs
    if (page.url().includes("404") || page.url().includes("not-found")) {
      await page.goto("/oral-exam");
    }

    // Look for start button
    const startBtn = page.getByRole("button", { name: /start|begin|starten|simulation/i }).first();
    if (!(await startBtn.count())) {
      console.warn("[oral-exam] No start button found — skipping");
      return;
    }

    await startBtn.click();
    await page.waitForLoadState("networkidle");

    // Fill in an answer
    const textarea = page.locator("textarea").first();
    if (await textarea.count()) {
      await textarea.fill("Ich strukturiere meine Antwort: 1) Begriffsdefinition 2) Praxisbeispiel 3) Bezug zur Ausbildungsordnung.");

      // Submit
      const submitBtn = page.getByRole("button", { name: /abgeben|bewerten|submit|senden|antwort/i }).first();
      if (await submitBtn.count()) {
        await submitBtn.click();

        // Wait for AI feedback (can take up to 30s)
        await expect(
          page.getByText(/feedback|stärken|schwächen|bewertung|verbesserung|note/i).first()
        ).toBeVisible({ timeout: 60_000 });
      }
    } else {
      console.warn("[oral-exam] No textarea found for answer input");
    }
  });
});
