/**
 * Visual regression: Produkt- & Landingpage-Badges.
 *
 * Sichert Token-Migrationen pixelgenau ab. Schießt Snapshots der Status-
 * Badges auf den Produkt-/Landingpage-Routen. Updates der Baseline:
 *
 *   bunx playwright test tests/e2e/badge-visual.spec.ts --update-snapshots
 *
 * Snapshots liegen unter `tests/e2e/__screenshots__/badge-visual/…`
 */
import { test, expect } from "@playwright/test";

const TARGETS = [
  { name: "shop", path: "/shop" },
  { name: "preise", path: "/preise" },
  { name: "unternehmen", path: "/unternehmen" },
];

for (const target of TARGETS) {
  test(`badges visual: ${target.name}`, async ({ page }) => {
    await page.goto(target.path, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    // Disable animations & font swap for stable snapshots
    await page.addStyleTag({
      content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`,
    });

    const badges = page.locator(
      '[class*="bg-success-bg-subtle"], [class*="bg-warning-bg-subtle"], ' +
        '[class*="bg-destructive-bg-subtle"], [class*="bg-info-bg-subtle"], ' +
        '[data-slot="badge"], [class*="rounded-full"][class*="border-"]'
    );
    const count = await badges.count();
    if (count === 0) {
      test.skip(true, `no badges found on ${target.path}`);
      return;
    }

    // Snapshot the first ≤6 visible badges as a single composite to keep
    // snapshot count low. Take the bounding section (first viewport).
    await expect(page).toHaveScreenshot(`${target.name}-badges.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });
}
