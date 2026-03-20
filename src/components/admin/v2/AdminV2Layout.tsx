import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';
import AdminV2Shell from './AdminV2Shell';
import AdminErrorBoundary from './AdminErrorBoundary';

export default function AdminV2Layout() {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" state={{ from: location }} replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <AdminV2Shell>
      <AdminErrorBoundary resetKey={location.pathname}>
        <Outlet />
      </AdminErrorBoundary>
    </AdminV2Shell>
  );
}
