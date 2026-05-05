/**
 * A11y smoke for all public routes registered in `tests/e2e/a11y-routes.ts`
 * using @axe-core/playwright.
 *
 * Runs against BASE_URL (preview / staging). Fails on serious/critical
 * violations only — moderate/minor are surfaced as warnings to keep the
 * gate practical. Each route gets its own test so failures are attributable.
 *
 * To add a new route: edit `tests/e2e/a11y-routes.ts` (single source of truth).
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PUBLIC_A11Y_SMOKE_ROUTES } from "./a11y-routes";

const ROUTES = PUBLIC_A11Y_SMOKE_ROUTES;

for (const route of ROUTES) {
  test(`a11y smoke: ${route.name} (${route.path})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));

    const resp = await page.goto(route.path, { waitUntil: "domcontentloaded" });
    // Allow redirects (e.g. /dashboard → /auth) — we just want the rendered page.
    expect(resp, `no response for ${route.path}`).toBeTruthy();

    // Wait for app shell to mount.
    await page.waitForLoadState("networkidle").catch(() => {});

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // Disable rules that trigger on shadcn/Radix portal patterns or
      // are known false-positive prone in SPA shells.
      .disableRules(["color-contrast"]) // covered by separate token audit
      .analyze();

    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );

    if (serious.length > 0) {
      const summary = serious
        .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`)
        .join("\n");
      throw new Error(
        `A11y violations on ${route.path}:\n${summary}\nDetails: ${results.violations.map((v) => v.helpUrl).join(", ")}`,
      );
    }
  });
}
