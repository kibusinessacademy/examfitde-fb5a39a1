import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getStoredConsent,
  setConsent,
  type ConsentDecision,
} from "@/lib/gtm";
import { CONSENT_BANNER_EVENT } from "@/hooks/useConsentBannerVisible";
import { Link } from "react-router-dom";

function broadcastBannerState(visible: boolean, height: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CONSENT_BANNER_EVENT, { detail: { visible, height } }),
  );
}

/**
 * GDPR/TTDSG Cookie Consent Banner.
 * - Shows only if no decision is stored.
 * - Default consent state (denied) is set in index.html before GTM loads.
 * - User decision is persisted in localStorage('ef_consent_v1') and
 *   forwarded via gtag('consent','update', …) — Consent Mode v2.
 */
export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [details, setDetails] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [ad, setAd] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (getStoredConsent() === null) {
      // small delay to avoid CLS on first paint
      const t = window.setTimeout(() => setVisible(true), 400);
      return () => window.clearTimeout(t);
    }
  }, []);

  // Broadcast height + visibility so sticky CTAs can lift above the banner.
  useEffect(() => {
    if (!visible) {
      broadcastBannerState(false, 0);
      return;
    }
    const node = containerRef.current;
    if (!node) return;

    const measure = () =>
      broadcastBannerState(true, Math.ceil(node.getBoundingClientRect().height));

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [visible, details]);

  // On unmount → ensure listeners know banner is gone.
  useEffect(() => () => broadcastBannerState(false, 0), []);

  const decide = (decision: ConsentDecision) => {
    setConsent(decision);
    setVisible(false);
    broadcastBannerState(false, 0);
  };

  if (!visible) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="false"
      aria-label="Cookie-Einstellungen"
      data-testid="cookie-banner"
      className="fixed inset-x-0 bottom-0 z-[100] p-2 sm:p-4"
    >
      <div className="mx-auto max-w-3xl rounded-xl sm:rounded-2xl border border-border bg-card text-card-foreground shadow-elev-3 p-3 sm:p-5">
        <div className="space-y-2 sm:space-y-3">
          <div>
            <h2 className="text-sm sm:text-base font-semibold">
              Cookies & Tracking
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-snug">
              <span className="sm:hidden">
                Wir nutzen optionale Analyse- und Marketing-Cookies. Notwendige sind immer aktiv.{" "}
              </span>
              <span className="hidden sm:inline">
                Wir nutzen Cookies und Analyse-Tools (Google Analytics via GTM),
                um ExamFit zu verbessern. Notwendige Cookies sind immer aktiv.
                Alles andere ist optional und du kannst jederzeit zustimmen oder
                ablehnen.{" "}
              </span>
              <Link
                to="/datenschutz"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Datenschutz
              </Link>
            </p>
          </div>
...
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-row sm:items-center sm:justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="w-full sm:w-auto px-2 sm:px-3"
              onClick={() => decide({ analytics: false, ad: false })}
            >
              Ablehnen
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto px-2 sm:px-3"
              onClick={() => setDetails((v) => !v)}
              aria-expanded={details}
            >
              {details ? "Weniger" : "Optionen"}
            </Button>
            {details ? (
              <Button
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => decide({ analytics, ad })}
              >
                Speichern
              </Button>
            ) : (
              <Button
                size="sm"
                className="w-full sm:w-auto px-2 sm:px-3"
                onClick={() => decide({ analytics: true, ad: true })}
              >
                Akzeptieren
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
