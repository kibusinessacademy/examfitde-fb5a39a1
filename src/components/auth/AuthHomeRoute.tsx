import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';
import { lazy, Suspense } from 'react';

const BerufOSHub = lazy(() => import('@/pages/BerufOSHub'));

/**
 * Route-level guard for /.
 * Authenticated users → /dashboard BEFORE any HomePage rendering.
 * Unauthenticated users → BerufOSHub (Masterbrand — Hardcut 2026-05-25).
 * Vorher: HomePageV2 (ExamFit-Marketing) — jetzt unter /examfit erreichbar.
 */
export default function AuthHomeRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
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
