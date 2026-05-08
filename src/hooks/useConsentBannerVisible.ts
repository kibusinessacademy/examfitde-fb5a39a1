import { useEffect, useState } from "react";
import { getStoredConsent } from "@/lib/gtm";

/**
 * Tracks whether the cookie consent banner is currently visible.
 * Sticky CTAs use this to lift above the banner so the banner never
 * occludes a primary action on mobile (390/430px).
 *
 * SSOT: CookieConsentBanner dispatches `ef:consent-banner-visibility` with
 * { visible: boolean, height: number } on mount, dismiss, and resize.
 */
export const CONSENT_BANNER_EVENT = "ef:consent-banner-visibility";

export interface ConsentBannerState {
  visible: boolean;
  /** Measured banner height in px (incl. safe-area), 0 when hidden. */
  height: number;
}

export function useConsentBannerVisible(): ConsentBannerState {
  const [state, setState] = useState<ConsentBannerState>(() => ({
    // Optimistic: if no decision is stored, banner will appear shortly.
    visible: typeof window !== "undefined" && getStoredConsent() === null,
    height: 0,
  }));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<ConsentBannerState>).detail;
      if (!detail) return;
      setState({ visible: !!detail.visible, height: detail.height || 0 });
    };
    window.addEventListener(CONSENT_BANNER_EVENT, onEvent as EventListener);
    return () => window.removeEventListener(CONSENT_BANNER_EVENT, onEvent as EventListener);
  }, []);

  return state;
}
