import { useEffect } from "react";

/**
 * Microsoft Clarity — Heatmaps & Session Recordings.
 *
 * Aktiviert sich automatisch, sobald `VITE_CLARITY_PROJECT_ID` als
 * Build-Secret im Workspace gesetzt ist (Workspace Settings → Build Secrets).
 *
 * - DSGVO: respektiert CookieConsentBanner. Initialisiert NUR wenn
 *   `examfit_consent_analytics` im localStorage = 'granted'.
 * - Lädt nur einmal pro Session.
 * - Lädt nicht auf Preview-/Lovable-Hosts (nur examfit.de + www).
 */
export function ClarityTracker() {
  useEffect(() => {
    const projectId = import.meta.env.VITE_CLARITY_PROJECT_ID as string | undefined;
    if (!projectId) return;

    if (typeof window === "undefined") return;
    if ((window as any).clarity) return; // already loaded

    // Authority-Host Gate (kein Tracking auf Previews)
    const host = window.location.hostname;
    const isAuthority = host === "examfit.de" || host === "www.examfit.de";
    if (!isAuthority) return;

    // Consent-Gate
    const consent = localStorage.getItem("examfit_consent_analytics");
    if (consent !== "granted") return;

    // Offizielles Clarity-Snippet
    (function (c: any, l: Document, a: string, r: string, i: string) {
      c[a] = c[a] || function () {
        (c[a].q = c[a].q || []).push(arguments);
      };
      const t = l.createElement(r) as HTMLScriptElement;
      t.async = true;
      t.src = "https://www.clarity.ms/tag/" + i;
      const y = l.getElementsByTagName(r)[0];
      y.parentNode?.insertBefore(t, y);
    })(window, document, "clarity", "script", projectId);
  }, []);

  return null;
}
