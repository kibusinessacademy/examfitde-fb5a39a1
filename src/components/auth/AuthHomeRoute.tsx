import BerufOSHub from '@/pages/BerufOSHub';

/**
 * Route-level guard for /.
 *
 * D8-Fix (Brand-Drift): Sowohl eingeloggte als auch ausgeloggte Besucher landen
 * auf dem BerufOS-Hub (Masterbrand). Eingeloggte sehen im Hero ein
 * personalisiertes Re-Entry-Banner → /dashboard (siehe BerufOSHub.tsx).
 *
 * P0 Hydration-Drift Fix (2026-06-07): Wir blockieren NICHT mehr auf
 * `useAuth().loading` — das hatte den Hub nach React-Hydration durch einen
 * Full-Page-Spinner ersetzt.
 *
 * P0 Hydration-Drift Fix v2 (2026-06-09): BerufOSHub wird EAGER importiert.
 * Vorher: lazy() + Suspense-Spinner → Pre-Customer Reality Probe nach
 * `domcontentloaded` sah nur den Spinner, Hero-CTA „Prüfung starten" galt
 * als fehlend → P01 rot. Root-Route ist immer kritisch, kein Code-Splitting.
 */
export default function AuthHomeRoute() {
  return <BerufOSHub />;
}
