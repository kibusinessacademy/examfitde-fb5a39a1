import { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';

const BerufOSHub = lazy(() => import('@/pages/BerufOSHub'));

/**
 * Route-level guard for /.
 *
 * D8-Fix (Brand-Drift): Sowohl eingeloggte als auch ausgeloggte Besucher landen
 * auf dem BerufOS-Hub (Masterbrand). Eingeloggte sehen im Hero ein
 * personalisiertes Re-Entry-Banner → /dashboard (siehe BerufOSHub.tsx).
 *
 * P0 Hydration-Drift Fix (2026-06-07): Wir blockieren NICHT mehr auf
 * `useAuth().loading` — das hatte den Hub nach React-Hydration durch einen
 * Full-Page-Spinner ersetzt und die Pre-Customer Reality Gate auf P01 rot
 * geschaltet (Hero-CTA verschwand post-hydration). BerufOSHub liest `user`
 * selbst und rendert ein optionales Re-Entry-Banner, sobald die Session
 * aufgelöst ist — der öffentliche Funnel-Content ist davon unabhängig.
 */
export default function AuthHomeRoute() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <BerufOSHub />
    </Suspense>
  );
}
