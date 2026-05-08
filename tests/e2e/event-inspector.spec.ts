/**
 * E2E: /tools/event-inspector
 * Klickt die 5 Trigger-Buttons und validiert die DataLayer-Pushes
 * gegen docs/analytics/funnel-events.schema.json.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const schema = JSON.parse(
  readFileSync(path.resolve("docs/analytics/funnel-events.schema.json"), "utf8"),
);
const REQUIRED: string[] = schema.requiredDataLayerFieldsForAllFunnelEvents;
const PIXEL: Record<string, { meta?: { required?: string[] }; ads?: { required?: string[] } }> =
  schema.pixelConversions?.derive ?? {};

const BUTTONS = [
  "landing_view",
  "cta_clicked",
  "quiz_started",
  "checkout_started",
  "purchase_completed",
] as const;

const STRICT = new Set(["quiz_started", "checkout_started", "purchase_completed"]);

test.describe("/tools/event-inspector → DataLayer schema parity", () => {
  test("clicks all 5 triggers and each push satisfies the schema", async ({ page }) => {
    // Reset dataLayer BEFORE the page loads so we control what's captured.
    await page.addInitScript(() => {
      // @ts-ignore
      window.__pushes = [];
      // @ts-ignore
      window.dataLayer = [];
      const dl = (window as any).dataLayer as any[];
      const original = dl.push.bind(dl);
      dl.push = (...args: any[]) => {
        for (const a of args) {
          if (a && typeof a === "object" && !Array.isArray(a)) {
            (window as any).__pushes.push(a);
          }
        }
        return original(...args);
      };
    });

    await page.goto("/tools/event-inspector");
    await expect(page.getByRole("heading", { name: /Event Inspector/i })).toBeVisible();

    for (const label of BUTTONS) {
      await page.getByTestId(`trigger-${label}`).click();
      // Wait for our captured push to appear
      await page.waitForFunction(
        (ev) => (window as any).__pushes?.some((p: any) => p.event === ev),
        label,
        { timeout: 5000 },
      );
    }

    const pushes: any[] = await page.evaluate(() => (window as any).__pushes ?? []);

    for (const label of BUTTONS) {
      const p = pushes.find((x) => x.event === label);
      expect(p, `missing dataLayer push for ${label}`).toBeTruthy();

      // All required top-level keys present (value may be null, key must exist).
      for (const f of REQUIRED) {
        expect(Object.prototype.hasOwnProperty.call(p, f), `${label}: missing key ${f}`).toBe(true);
      }
      // Strict events: package_id non-null
      if (STRICT.has(label)) {
        expect(p.package_id, `${label}: package_id must be non-null`).toBeTruthy();
      }
      // Pixel-conversion fields for checkout/purchase
      const pixel = PIXEL[label];
      if (pixel) {
        const need = new Set([
          ...(pixel.meta?.required ?? []),
          ...(pixel.ads?.required ?? []),
        ]);
        for (const f of need) {
          const v = p[f];
          expect(v == null || v === "", `${label}: pixel field ${f} required`).toBe(false);
        }
      }
    }
  });

  test("Copy last payload button is enabled after a trigger", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "clipboard write unreliable in webkit headless");

    await page.goto("/tools/event-inspector");
    const copyBtn = page.getByTestId("copy-last");
    await expect(copyBtn).toBeDisabled();

    await page.getByTestId("trigger-checkout_started").click();
    await expect(copyBtn).toBeEnabled();
    await expect(page.getByTestId("copy-last-status")).toHaveText("OK");
  });
});
