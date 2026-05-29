import { Suspense, lazy } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

const BerufOSHub = lazy(() => import('@/pages/BerufOSHub'));

/**
 * Route-level guard for /.
 *
 * D8-Fix (Brand-Drift): Auth-Status entscheidet NICHT mehr über die Brand-Heimat.
 * Sowohl eingeloggte als auch ausgeloggte Besucher landen auf dem BerufOS-Hub
 * (Masterbrand). Eingeloggte sehen im Hero ein personalisiertes Re-Entry-Banner
 * → /dashboard (siehe BerufOSHub.tsx) — kein Force-Redirect mehr in das
 * ExamFit-gebrandete /dashboard.
 */
export default function AuthHomeRoute() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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
