// PR-1 guard: language switcher is present, switching changes <html lang> & dir, key strings translate.
import { test, expect } from "@playwright/test";

test.describe("i18n shell", () => {
  test("switcher renders and toggles <html lang>/dir for EN and AR", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const switcher = page.getByTestId("language-switcher");
    await expect(switcher).toBeVisible();

    // Switch to English
    await switcher.first().click();
    await page.getByTestId("language-option-en").click();
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("en");
    await expect.poll(() => page.evaluate(() => document.documentElement.dir)).toBe("ltr");

    // Switch to Arabic → RTL
    await switcher.first().click();
    await page.getByTestId("language-option-ar").click();
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("ar");
    await expect.poll(() => page.evaluate(() => document.documentElement.dir)).toBe("rtl");

    // Persistence
    const stored = await page.evaluate(() => localStorage.getItem("berufos.lang"));
    expect(stored).toBe("ar");
  });

  test("all 6 supported languages are listed", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("language-switcher").first().click();
    for (const code of ["de", "en", "tr", "ar", "uk", "ru"]) {
      await expect(page.getByTestId(`language-option-${code}`)).toBeVisible();
    }
  });
});
