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

  // ── Guest-Checkout first ──
  // Wir bevorzugen Sofortkauf ohne Login: wenn keine gültige Session da ist,
  // gehen wir direkt in `create-guest-checkout`. Stripe sammelt E-Mail und
  // Adresse selbst; der Webhook legt anschließend einen Account an und
  // verschickt einen Magic-/Recovery-Link zum Passwort-Setzen
  // (`/auth/account-claim?session_id=…`). Nur wenn die Edge-Function einen
  // 4xx-/5xx-Fehler liefert, fallen wir auf den klassischen Login-Pfad zurück.
  const { data: userData } = await supabase.auth.getUser();
  const isAuthed = !!userData?.user;

  if (!isAuthed) {
    const { data, error } = await supabase.functions.invoke("create-guest-checkout", {
      body: {
        product_slug: productSlug,
        anonymous_id: getAnonymousId(),
        session_id: getSessionId(),
        source: ctx.source ?? "startProductCheckout_guest",
        persona_type: ctx.persona_type ?? null,
        source_page: sourcePage,
      },
    });
    if (!error && (data as CheckoutResult)?.ok && (data as CheckoutResult).checkout_url) {
      window.location.href = (data as CheckoutResult).checkout_url!;
      return data as CheckoutResult;
    }
    // Strukturierte Fehler (unbekannter Slug, ambiguous, nicht kaufbar) sollen
    // dem User angezeigt werden — kein Login-Redirect für diese Fälle.
    if (!error && data && (data as CheckoutResult)?.error_code) {
      return data as CheckoutResult;
    }
    // Sonst Fallback: klassischer Login-Gate (Order-Trigger braucht echten User).
    const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    window.location.href = `/auth?next=${next}&intent=checkout`;
    return { ok: false, error: "Bitte melde dich an, um den Kauf abzuschließen." };
  }

  // Session-Token für authentifizierte Käufe (orders.buyer_user_id NOT NULL).
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    window.location.href = `/auth?next=${next}&intent=checkout`;
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
