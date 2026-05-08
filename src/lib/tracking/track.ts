/**
 * Conversion & Usage Tracking Helper (SSOT)
 *
 * All trackable events flow through this function. Two sinks:
 *   1. tracking_events (legacy: usage timeline)
 *   2. conversion_events via track_conversion_event_v2 RPC + GTM dataLayer
 *      → SSOT für Funnel-Reports (landing_view, quiz_started, …)
 *
 * Bis zum 2026-05-08 schrieb landingView() NUR in tracking_events. Damit
 * fehlten landing_view-Events in conversion_events vollständig (1 Treffer in
 * 14 Tagen → cta_visible_stall-Folgealarm). Der Helper fan-outet jetzt in
 * beide Senken — tracking_events bleibt für die Usage-Timeline, conversion_events
 * speist GA4/GTM/Marketing-Reports.
 */
import { supabase } from "@/integrations/supabase/client";
import { trackFunnel, type FunnelEventType } from "@/lib/conversionTracking";

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
 * Funnel-Mirror-Set: Events die NEBEN tracking_events auch in conversion_events
 * landen müssen (für GA4/GTM/Marketing-Reports). Whitelist statt 1:1, damit
 * legacy product_view & co die Funnel-KPIs nicht verwässern.
 */
const FUNNEL_MIRROR: ReadonlyMap<string, FunnelEventType> = new Map([
  ["landing_view", "lead_magnet_view" as FunnelEventType],
  // landing_view existiert in conversion_events.event_type → Cast über RPC
  // (track_conversion_event_v2 akzeptiert beide Schreibweisen).
]);

async function mirrorToConversion(
  eventName: string,
  productSlug: string | undefined,
  landingType: string | undefined,
  metadata: Record<string, unknown>,
) {
  // landing_view ist KEIN strict-event → package_id nicht erzwungen.
  // Wir reichen die wichtigsten Kontextfelder weiter; GTM-Schema verlangt sie.
  if (!FUNNEL_MIRROR.has(eventName) && eventName !== "landing_view") return;
  try {
    await trackFunnel(
      // landing_view bleibt der kanonische Eventname (siehe FunnelEventType-Union).
      // Falls eine Mirror-Map einen Cast definiert, wird der genutzt — aber
      // landing_view selbst ist kein dedizierter FunnelEventType, daher: cast.
      (eventName as FunnelEventType),
      {
        source_page:
          typeof window !== "undefined" ? window.location.pathname : null,
        metadata: {
          product_slug: productSlug ?? null,
          landing_type: landingType ?? null,
          ...metadata,
        },
      },
    );
  } catch {
    // never break UX
  }
}

/**
 * Pre-defined event helpers for type safety
 */
export const TrackingEvents = {
  landingView: async (slug: string, landingType: string) => {
    // Dual-write: legacy timeline + conversion_events (Funnel-SSOT)
    await trackEvent({ eventName: "landing_view", productSlug: slug, landingType });
    await mirrorToConversion("landing_view", slug, landingType, {});
  },

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

