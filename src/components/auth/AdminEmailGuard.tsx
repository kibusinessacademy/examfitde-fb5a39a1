import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

const ADMIN_EMAILS = [
  'likeitmark9@gmail.com',
];

/**
 * Protects admin/work routes: requires auth + email allowlist.
 */
export default function AdminEmailGuard() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  const email = user.email?.toLowerCase() ?? '';
  if (!ADMIN_EMAILS.includes(email)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4 p-8">
          <h1 className="text-2xl font-bold">Kein Zugriff</h1>
          <p className="text-muted-foreground">Dein Account ist nicht für den Admin-Bereich freigeschaltet.</p>
          <a href="/work" className="inline-block mt-4 px-6 py-2 rounded-lg border hover:bg-muted">Zurück</a>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
