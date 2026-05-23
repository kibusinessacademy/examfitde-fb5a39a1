/**
 * Product Checkout Launcher (B2C Einmalkauf)
 *
 * SSOT-konform: Tracking läuft komplett server-seitig in `create-product-checkout`
 * (schreibt `checkout_started` in `conversion_events`), damit der Stripe-Redirect
 * nichts verliert. Der Client liefert nur den Tracking-Kontext (anon/session/source).
 *
 * Kein Schreiben mehr in `tracking_events` aus dem Browser.
 */
import { supabase } from "@/integrations/supabase/client";
import { getAnonymousId, getSessionId } from "@/lib/conversionTracking";

export interface CheckoutResult {
  ok: boolean;
  checkout_url?: string;
  order_id?: string;
  package_id?: string | null;
  persona?: string | null;
  product_id?: string | null;
  price_id?: string | null;
  stripe_price_id?: string | null;
  error?: string;
  /**
   * Stable machine-code for UI handling. Currently emitted:
   *   - "product_not_found"  → unbekannter Slug (mit suggested_url/fallback_url)
   *   - "slug_ambiguous"     → mehrere Treffer (mit candidates[])
   *   - "already_entitled"   → User hat den Kurs bereits
   */
  error_code?: "product_not_found" | "slug_ambiguous" | "already_entitled" | string;
  original_slug?: string | null;
  suggested_slug?: string | null;
  suggested_url?: string | null;
  fallback_url?: string | null;
  candidates?: { slug: string; url: string }[];
  already_entitled?: boolean;
}

export interface CheckoutContext {
  /** Free-form source label, e.g. "persona_landing", "dynamic_landing", "shop_card". */
  source?: string;
  /** Optional persona override (azubi, betrieb, umschulung …). Server falls back to package.persona_profile. */
  persona_type?: string | null;
}

export async function startProductCheckout(
  productSlug: string,
  ctx: CheckoutContext = {},
): Promise<CheckoutResult> {
  const sourcePage =
    typeof window !== "undefined" ? window.location.pathname : null;

  // Auth-Gate: ohne gültige Session kein B2C-Checkout (orders.buyer_user_id NOT NULL).
  // getUser() validiert den JWT serverseitig — getSession() würde abgelaufene/stale
  // localStorage-Einträge als truthy zurückgeben und der Edge-Call würde mit
  // "User not authenticated" als 401 fehlschlagen (siehe edge-logs 2026-05-18).
  const redirectToAuth = () => {
    if (typeof window !== "undefined") {
      const next = encodeURIComponent(
        `${window.location.pathname}${window.location.search}`,
      );
      window.location.href = `/auth?next=${next}&intent=checkout`;
    }
  };

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    redirectToAuth();
    return { ok: false, error: "Bitte melde dich an, um den Kauf abzuschließen." };
  }

  // Session-Token explizit lesen — supabase.functions.invoke hängt den JWT in
  // bestimmten Webview-/Refresh-Konstellationen nicht zuverlässig an. Ohne JWT
  // sieht die Edge-Function nur den publishable-Key und antwortet 401.
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    redirectToAuth();
    return { ok: false, error: "Sitzung abgelaufen. Bitte erneut anmelden." };
  }

  const { data, error } = await supabase.functions.invoke("create-product-checkout", {
    headers: { Authorization: `Bearer ${accessToken}` },
    body: {
      product_slug: productSlug,
      anonymous_id: getAnonymousId(),
      session_id: getSessionId(),
      source: ctx.source ?? "startProductCheckout",
      persona_type: ctx.persona_type ?? null,
      source_page: sourcePage,
    },
  });

  if (error) {
    // Safety-Net: falls Edge-Function trotzdem 401 liefert (Token race / refresh-failure),
    // statt rotem Toast → Re-Auth-Redirect.
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("not authenticated") || msg.includes("401") || msg.includes("non-2xx")) {
      redirectToAuth();
      return { ok: false, error: "Bitte melde dich erneut an, um den Kauf abzuschließen." };
    }
    return { ok: false, error: error.message };
  }

  const result = data as CheckoutResult;

  if (result.already_entitled) {
    return result;
  }

  if (result.ok && result.checkout_url) {
    // Redirect to Stripe — Tracking ist bereits server-seitig persistiert.
    window.location.href = result.checkout_url;
  }

  return result;
}
