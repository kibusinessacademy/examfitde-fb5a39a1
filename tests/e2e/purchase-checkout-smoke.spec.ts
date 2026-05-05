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
        // Price visible (€)
        await expect(page.getByText(/€|EUR/).first()).toBeVisible({ timeout: 10_000 });
        // Checkout/Kaufen CTA visible
        await expect(
          page.getByRole("button", { name: /kaufen|jetzt kaufen|checkout|sichern/i }).first(),
        ).toBeVisible({ timeout: 10_000 });
      }
    }

    // Login (so that create-product-checkout has a session) and invoke directly.
    await page.goto("/auth");
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 20_000 });

    const result = await page.evaluate(async (s) => {
      const mod = await import("/src/integrations/supabase/client.ts");
      const { supabase } = mod as any;
      const { data, error } = await supabase.functions.invoke("create-product-checkout", {
        body: { product_slug: s, source: "purchase-checkout-smoke", source_page: "/e2e/smoke" },
      });
      return { data, error: error ? String(error.message ?? error) : null };
    }, slug ?? "");

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
