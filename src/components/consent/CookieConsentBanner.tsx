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
      className="fixed inset-x-0 bottom-0 z-[100] p-3 sm:p-4"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card text-card-foreground shadow-elev-3 p-4 sm:p-5">
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-semibold">Cookies & Tracking</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Wir nutzen Cookies und Analyse-Tools (Google Analytics via GTM),
              um ExamFit zu verbessern. Notwendige Cookies sind immer aktiv.
              Alles andere ist optional und du kannst jederzeit zustimmen oder
              ablehnen.{" "}
              <Link
                to="/datenschutz"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Datenschutz
              </Link>
            </p>
          </div>

          {details && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <label className="flex items-center justify-between gap-3">
                <span>
                  <strong>Notwendig</strong>
                  <span className="block text-xs text-muted-foreground">
                    Login, Sicherheit, Grundfunktionen
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked
                  disabled
                  className="h-4 w-4 accent-primary"
                  aria-label="Notwendige Cookies (immer aktiv)"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>
                  <strong>Statistik / Analyse</strong>
                  <span className="block text-xs text-muted-foreground">
                    Google Analytics 4 (GA4) – anonymisierte Nutzungsdaten
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={analytics}
                  onChange={(e) => setAnalytics(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                  aria-label="Analyse-Cookies"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>
                  <strong>Marketing</strong>
                  <span className="block text-xs text-muted-foreground">
                    Werbe-Personalisierung, Conversion-Tracking
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={ad}
                  onChange={(e) => setAd(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                  aria-label="Marketing-Cookies"
                />
              </label>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => decide({ analytics: false, ad: false })}
            >
              Alle ablehnen
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDetails((v) => !v)}
              aria-expanded={details}
            >
              {details ? "Weniger anzeigen" : "Einstellungen"}
            </Button>
            {details ? (
              <Button size="sm" onClick={() => decide({ analytics, ad })}>
                Auswahl speichern
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => decide({ analytics: true, ad: true })}
              >
                Alle akzeptieren
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
