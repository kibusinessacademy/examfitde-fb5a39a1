import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';
import { lazy, Suspense } from 'react';

const HomePage = lazy(() => import('@/pages/HomePage'));

/**
 * Route-level guard for /.
 * Authenticated users → /dashboard BEFORE any HomePage rendering.
 * Unauthenticated users → HomePage (marketing).
 * Prevents flicker, false tracking, and old-landing-page bleed.
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
      <HomePage />
    </Suspense>
  );
}
