/**
 * SEO & Conversion Tracking Utilities
 * Lightweight event tracking for marketing analytics
 */

export type ConversionEvent =
  | 'cta_click'
  | 'shop_view'
  | 'product_view'
  | 'checkout_start'
  | 'signup_start'
  | 'signup_complete'
  | 'exam_start'
  | 'faq_expand'
  | 'page_view'
  | 'scroll_depth'
  | 'course_search'
  | 'course_click';

interface TrackingPayload {
  event: ConversionEvent;
  label?: string;
  value?: number;
  page?: string;
  source?: string;
}

/**
 * Track a conversion event.
 * Currently logs to console & stores in sessionStorage for debugging.
 * Can be extended with GTM / GA4 / PostHog integration.
 */
export function trackConversion(payload: TrackingPayload) {
  const enriched = {
    ...payload,
    timestamp: new Date().toISOString(),
    page: payload.page || window.location.pathname,
    referrer: document.referrer || 'direct',
  };

  // Store for session analytics
  try {
    const existing = JSON.parse(sessionStorage.getItem('ef_events') || '[]');
    existing.push(enriched);
    // Keep last 50 events per session
    if (existing.length > 50) existing.shift();
    sessionStorage.setItem('ef_events', JSON.stringify(existing));
  } catch {
    // Silent fail for SSR / privacy mode
  }

  if (import.meta.env.DEV) {
    console.log('[ExamFit Track]', enriched);
  }
}

/**
 * Get session conversion events (for debugging / admin analytics)
 */
export function getSessionEvents(): TrackingPayload[] {
  try {
    return JSON.parse(sessionStorage.getItem('ef_events') || '[]');
  } catch {
    return [];
  }
}

/**
 * Track CTA clicks with a data attribute approach
 * Usage: <Button {...ctaProps('hero_cta', 'Prüfungstraining starten')}>
 */
export function ctaProps(source: string, label: string) {
  return {
    onClick: () => trackConversion({ event: 'cta_click', source, label }),
    'data-track': source,
  };
}
