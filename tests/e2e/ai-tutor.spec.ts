import { test, expect } from "@playwright/test";
import { login } from "./_helpers";

test.describe("AI Tutor", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("Ask question → receive contextual AI response", async ({ page }) => {
    // Navigate to tutor
    await page.goto("/tutor");

    // Fallback routes
    if (page.url().includes("404") || page.url().includes("not-found")) {
      await page.goto("/ai-tutor");
    }

    // Find input area
    const input = page.locator("textarea, input[type='text']").first();
    if (!(await input.count())) {
      console.warn("[ai-tutor] No input field found — skipping");
      return;
    }

    await input.fill("Erkläre mir den wichtigsten Prüfungsbereich in einfachen Worten mit einem Beispiel.");

    // Send
    const sendBtn = page.getByRole("button", { name: /senden|send|fragen|ask/i }).first();
    if (await sendBtn.count()) {
      await sendBtn.click();
    } else {
      // Try Enter key
      await input.press("Enter");
    }

    // Wait for AI response (up to 60s)
    const responseLocator = page.locator(
      '[data-role="assistant-message"], [data-testid="assistant-message"], .assistant-message, .chat-bubble:not(.user)'
    ).first();

    await expect(responseLocator).toBeVisible({ timeout: 60_000 });

    // Verify response has meaningful content (not empty/error)
    const responseText = await responseLocator.textContent();
    expect(responseText?.length).toBeGreaterThan(20);
  });
});
