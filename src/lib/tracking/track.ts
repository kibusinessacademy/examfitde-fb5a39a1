/**
 * Conversion & Usage Tracking Helper (SSOT)
 * 
 * All trackable events flow through this function into tracking_events.
 * No direct .insert() calls elsewhere — always use trackEvent().
 */
import { supabase } from "@/integrations/supabase/client";

let _sessionId: string | null = null;

function getSessionId(): string {
  if (!_sessionId) {
    _sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  return _sessionId;
}

export async function trackEvent(input: {
  eventName: string;
  productSlug?: string;
  landingType?: string;
  pagePath?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    await (supabase as any).from("tracking_events").insert({
      user_id: user?.id ?? null,
      session_id: getSessionId(),
      event_name: input.eventName,
      product_slug: input.productSlug ?? null,
      landing_type: input.landingType ?? null,
      page_path: input.pagePath ?? window.location.pathname,
      metadata: input.metadata ?? {},
    });
  } catch {
    // Tracking should never block UX
  }
}

/**
 * Pre-defined event helpers for type safety
 */
export const TrackingEvents = {
  landingView: (slug: string, landingType: string) =>
    trackEvent({ eventName: "landing_view", productSlug: slug, landingType }),

  ctaPrimaryClick: (slug: string, ctaText: string, price?: string) =>
    trackEvent({
      eventName: "cta_primary_click",
      productSlug: slug,
      metadata: { cta_text: ctaText, price_display: price },
    }),

  ctaSecondaryClick: (slug: string, ctaText: string) =>
    trackEvent({
      eventName: "cta_secondary_click",
      productSlug: slug,
      metadata: { cta_text: ctaText },
    }),

  checkoutStarted: (slug: string) =>
    trackEvent({ eventName: "checkout_started", productSlug: slug }),

  checkoutCompleted: (slug: string, orderId: string) =>
    trackEvent({
      eventName: "checkout_completed",
      productSlug: slug,
      metadata: { order_id: orderId },
    }),

  checkoutCancelled: (slug: string) =>
    trackEvent({ eventName: "checkout_cancelled", productSlug: slug }),

  productAccessed: (slug: string) =>
    trackEvent({ eventName: "product_accessed", productSlug: slug }),
} as const;
