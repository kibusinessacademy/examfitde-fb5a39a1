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

  // Auth-Gate: ohne Session kein B2C-Checkout möglich (orders.buyer_user_id NOT NULL).
  // Statt 401-Hardfail → freundlicher Redirect nach /auth mit Rücksprung auf die Paket-Seite.
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) {
    if (typeof window !== "undefined") {
      const next = encodeURIComponent(
        `${window.location.pathname}${window.location.search}`,
      );
      window.location.href = `/auth?next=${next}&intent=checkout`;
    }
    return { ok: false, error: "Bitte melde dich an, um den Kauf abzuschließen." };
  }

  const { data, error } = await supabase.functions.invoke("create-product-checkout", {
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
