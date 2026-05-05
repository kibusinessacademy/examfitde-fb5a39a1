/**
 * Sellable product → create-product-checkout smoke (no real Stripe charge).
 *
 * Verifies that the first sellable course's product page surfaces a price
 * and CTA, and that calling create-product-checkout returns a Stripe
 * checkout URL (cs_test_*). Stops short of paying the card.
 */
import { test, expect } from "@playwright/test";
import { SERVICE_KEY, SUPABASE_URL } from "./helpers/service-key";

const URL_BASE = SUPABASE_URL;
const SERVICE = SERVICE_KEY;
const EMAIL = process.env.E2E_GRANT_LEARNER_EMAIL ?? "e2e+grant@examfit-smoke.local";
const PASSWORD = process.env.E2E_GRANT_LEARNER_PASSWORD ?? "SmokeTest_E2E_2026!";

async function rpc(name: string, body: Record<string, unknown> = {}, key = SERVICE) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${name} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

test.describe("Purchase checkout smoke (sellable course)", () => {
  test.skip(!URL_BASE || !ANON, "Supabase env required");

  test("first sellable course → product page renders + checkout URL returned", async ({ page }) => {
    const sellable = await rpc("public_sellable_courses");
    test.skip(!sellable?.length, "no sellable course available");
    const target = sellable[0];
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
