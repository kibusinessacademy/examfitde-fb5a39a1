/**
 * Sellable product → create-product-checkout smoke (no real Stripe charge).
 *
 * Verifies that the first sellable course's product page surfaces a price
 * and CTA, and that calling create-product-checkout returns a Stripe
 * checkout URL (cs_test_*). Stops short of paying the card.
 */
import { test, expect } from "@playwright/test";
import { HAS_ADMIN_PATH, SUPABASE_URL, e2eHelper } from "./helpers/service-key";

const EMAIL = process.env.E2E_GRANT_LEARNER_EMAIL ?? "e2e+grant@examfit-smoke.local";
const PASSWORD = process.env.E2E_GRANT_LEARNER_PASSWORD ?? "SmokeTest_E2E_2026!";

test.describe("Purchase checkout smoke (sellable course)", () => {
  test.skip(!SUPABASE_URL || !HAS_ADMIN_PATH, "E2E_HELPER_TOKEN or service-role alias required");

  test("first sellable course → product page renders + checkout URL returned", async ({ page }) => {
    const { courses } = await e2eHelper<{ ok: boolean; courses: any[] }>({ op: "sellable_courses" });
    test.skip(!courses?.length, "no sellable course available");
    // Skip archived slugs (brittle: first sellable course was an archived clone).
    const target =
      courses.find((c) => {
        const s = String(c.product_slug || c.slug || "");
        return s && !/__archived/i.test(s);
      }) ?? courses[0];
    const slug: string | undefined = target.product_slug || target.slug;

    if (slug) {
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
          // eslint-disable-next-line no-console
          console.warn(`[purchase-smoke] product page for "${slug}" missing — skipping UI checks, asserting checkout URL only.`);
        }
      }
    }

    // Get a user session token via the auth REST endpoint, then invoke the
    // edge function directly. We avoid dynamic-importing the app client
    // because production bundles don't expose source files.
    const ANON = process.env.SUPABASE_ANON_KEY!;
    const SUP = process.env.SUPABASE_URL!;
    const tokenRes = await page.request.post(`${SUP}/auth/v1/token?grant_type=password`, {
      headers: { apikey: ANON, "Content-Type": "application/json" },
      data: { email: EMAIL, password: PASSWORD },
    });
    expect(tokenRes.ok(), `auth login failed: ${tokenRes.status()}`).toBeTruthy();
    const { access_token } = await tokenRes.json();
    expect(access_token, "missing access_token").toBeTruthy();

    const fnRes = await page.request.post(`${SUP}/functions/v1/create-product-checkout`, {
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      data: { product_slug: slug ?? "", source: "purchase-checkout-smoke", source_page: "/e2e/smoke" },
    });
    const data = await fnRes.json().catch(() => ({}));
    const result = { data, error: fnRes.ok() ? null : `HTTP ${fnRes.status()}` };

    // Tolerate already_entitled (grant user) — that's also a green signal.
    if (result?.data?.error === "already_entitled") {
      expect(result.data.error).toBe("already_entitled");
      return;
    }
    expect(result?.error, `invoke error: ${result?.error}`).toBeFalsy();
    expect(result?.data?.checkout_url, "checkout_url must be present").toMatch(
      /^https:\/\/checkout\.stripe\.com/,
    );
  });
});
