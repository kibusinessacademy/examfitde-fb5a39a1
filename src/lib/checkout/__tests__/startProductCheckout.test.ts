/**
 * Verifies the client-side checkout launcher contract for several example packages:
 *   1) Bekannte Slugs → Stripe-Checkout-Session (checkout_url) wird zurückgeliefert.
 *   2) Unbekannter Slug → kein Hard-Fail mehr, sondern strukturiertes
 *      `error_code: "product_not_found"` mit `suggested_url` / `fallback_url`,
 *      damit die UI verständlich umleiten kann.
 *   3) Mehrdeutiger Slug → `error_code: "slug_ambiguous"` mit `candidates[]`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase-Client mocken ──────────────────────────────────────────────
const invokeMock = vi.fn();
const getUserMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: (...a: unknown[]) => getUserMock(...a),
      getSession: (...a: unknown[]) => getSessionMock(...a),
    },
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
  },
}));

vi.mock("@/lib/conversionTracking", () => ({
  getAnonymousId: () => "anon-test",
  getSessionId: () => "sess-test",
}));

// jsdom stellt window bereit; wir verhindern echte Redirects.
let lastHref = "";
beforeEach(() => {
  invokeMock.mockReset();
  getUserMock.mockReset();
  getSessionMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "tok" } } });
  lastHref = "";
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname: "/paket/test", search: "", get href() { return lastHref; }, set href(v: string) { lastHref = v; } },
  });
});

const SAMPLE_PACKAGES = [
  "anlagenmechaniker-in-fuer-sanitaer-heizungs-und-klimatechnik",
  "industriekaufmann-frau",
  "fachinformatiker-in-systemintegration",
  "bilanzbuchhalter-ihk",
  "kaufmann-frau-im-einzelhandel",
];

describe("startProductCheckout — multi-package happy path", () => {
  it.each(SAMPLE_PACKAGES)(
    "leitet bei %s erfolgreich zu Stripe-Checkout weiter",
    async (slug) => {
      invokeMock.mockResolvedValue({
        data: {
          ok: true,
          checkout_url: `https://checkout.stripe.com/c/pay/cs_${slug}`,
          order_id: `order-${slug}`,
          product_id: `prod-${slug}`,
        },
        error: null,
      });
      const { startProductCheckout } = await import("../startProductCheckout");
      const result = await startProductCheckout(slug, { source: "unit-test" });
      expect(result.ok).toBe(true);
      expect(result.checkout_url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
      expect(lastHref).toBe(result.checkout_url);
      // genau ein Edge-Function-Call mit dem korrekten product_slug
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(invokeMock.mock.calls[0][0]).toBe("create-product-checkout");
      expect(invokeMock.mock.calls[0][1].body.product_slug).toBe(slug);
    },
  );
});

describe("startProductCheckout — error_code Pfade", () => {
  it("product_not_found liefert suggested_url + fallback_url durch", async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: false,
        error: "Komplettpaket nicht gefunden.",
        error_code: "product_not_found",
        original_slug: "industrie-typo",
        suggested_slug: "industriekaufmann-frau",
        suggested_url: "/paket/industriekaufmann-frau",
        fallback_url: "/berufe",
      },
      error: null,
    });
    const { startProductCheckout } = await import("../startProductCheckout");
    const result = await startProductCheckout("industrie-typo");
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("product_not_found");
    expect(result.suggested_url).toBe("/paket/industriekaufmann-frau");
    expect(result.fallback_url).toBe("/berufe");
    // KEIN Stripe-Redirect bei Fehlerpfad
    expect(lastHref).toBe("");
  });

  it("slug_ambiguous liefert candidates[] durch", async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: false,
        error: "Mehrere Produkte passen zu diesem Link.",
        error_code: "slug_ambiguous",
        candidates: [
          { slug: "fachinformatiker-in-systemintegration", url: "/paket/fachinformatiker-in-systemintegration" },
          { slug: "fachinformatiker-in-anwendungsentwicklung", url: "/paket/fachinformatiker-in-anwendungsentwicklung" },
        ],
      },
      error: null,
    });
    const { startProductCheckout } = await import("../startProductCheckout");
    const result = await startProductCheckout("fachinformatiker");
    expect(result.error_code).toBe("slug_ambiguous");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates?.[0].url).toMatch(/^\/paket\//);
    expect(lastHref).toBe("");
  });
});
