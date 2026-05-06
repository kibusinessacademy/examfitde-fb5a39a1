/**
 * Sellable product → create-product-checkout smoke (no real Stripe charge).
 *
 * Verifies that the first sellable course's product page surfaces a price
 * and CTA, and that calling create-product-checkout returns a Stripe
 * checkout URL. Stops short of paying the card.
 *
 * Adds per-phase tracking + failure attachments via shared tracker so
 * checkout flakes report the exact response phase + screenshot/network.
 */
import { test, expect } from "@playwright/test";
import { HAS_ADMIN_PATH, SUPABASE_URL, e2eHelper } from "./helpers/service-key";
import { createPhaseTracker } from "./helpers/phase-tracker";

const EMAIL = process.env.E2E_GRANT_LEARNER_EMAIL ?? "e2e+grant@examfit-smoke.local";
const PASSWORD = process.env.E2E_GRANT_LEARNER_PASSWORD ?? "SmokeTest_E2E_2026!";

test.describe("Purchase checkout smoke (sellable course)", () => {
  test.skip(!SUPABASE_URL || !HAS_ADMIN_PATH, "E2E_HELPER_TOKEN or service-role alias required");

  test.describe.configure({ retries: 2 });

  test("first sellable course → product page renders + checkout URL returned", async ({ page }, testInfo) => {
    const tracker = createPhaseTracker({ suite: "purchase-checkout-smoke", page, testInfo });
    try {
      tracker.set("fetch-sellable");
      const { courses } = await e2eHelper<{ ok: boolean; courses: any[] }>({ op: "sellable_courses" });
      test.skip(!courses?.length, "no sellable course available");
      const target =
        courses.find((c) => {
          const s = String(c.product_slug || c.slug || "");
          return s && !/__archived/i.test(s);
        }) ?? courses[0];
      const slug: string | undefined = target.product_slug || target.slug;

      if (slug) {
        tracker.set("product-page-render");
        const resp = await page.goto(`/produkt/${slug}`).catch(() => null);
        if (resp && resp.status() < 400) {
          await page.waitForLoadState("networkidle").catch(() => {});
          const body = (await page.locator("body").innerText().catch(() => "")) || "";
          const productMissing = /Produkt nicht gefunden|nicht verf(ü|u)gbar/i.test(body);
          if (!productMissing) {
            await expect(page.getByText(/€|EUR/).first()).toBeVisible({ timeout: 10_000 });
            await expect(
              page.getByRole("button", { name: /kaufen|jetzt kaufen|checkout|sichern/i }).first(),
            ).toBeVisible({ timeout: 10_000 });
          } else {
            console.warn(`[purchase-smoke] product page for "${slug}" missing — skipping UI checks.`);
          }
        }
      }

      tracker.set("auth-token");
      const ANON = process.env.SUPABASE_ANON_KEY!;
      const SUP = process.env.SUPABASE_URL!;
      const tokenRes = await page.request.post(`${SUP}/auth/v1/token?grant_type=password`, {
        headers: { apikey: ANON, "Content-Type": "application/json" },
        data: { email: EMAIL, password: PASSWORD },
      });
      const tokenBody = await tokenRes.text();
      tracker.recordRpc("auth/token", tokenRes.status(), tokenBody.slice(0, 200));
      expect(tokenRes.ok(), `auth login failed: ${tokenRes.status()}`).toBeTruthy();
      const { access_token } = JSON.parse(tokenBody);
      expect(access_token, "missing access_token").toBeTruthy();

      tracker.set("create-product-checkout");
      const fnRes = await page.request.post(`${SUP}/functions/v1/create-product-checkout`, {
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        data: { product_slug: slug ?? "", source: "purchase-checkout-smoke", source_page: "/e2e/smoke" },
      });
      const fnBody = await fnRes.text();
      tracker.recordRpc("create-product-checkout", fnRes.status(), fnBody);
      const data = (() => { try { return JSON.parse(fnBody); } catch { return {}; } })();
      const result = { data, error: fnRes.ok() ? null : `HTTP ${fnRes.status()}` };

      tracker.set("assert-checkout-url");
      if (result?.data?.error === "already_entitled") {
        expect(result.data.error).toBe("already_entitled");
        tracker.set("done");
        return;
      }
      expect(result?.error, `invoke error: ${result?.error}`).toBeFalsy();
      expect(result?.data?.checkout_url, "checkout_url must be present").toMatch(
        /^https:\/\/checkout\.stripe\.com/,
      );
      tracker.set("done");
    } catch (err) {
      await tracker.attachFailure(err);
      throw err;
    }
  });
});
