import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const FinanceDashboard = lazy(() => import('@/pages/admin/FinanceDashboard'));
const EnterpriseSeatManagement = lazy(() => import('@/pages/admin/EnterpriseSeatManagement'));
const AuditExportsPage = lazy(() => import('@/pages/admin/AuditExportsPage'));
const AZAVCompliancePage = lazy(() => import('@/pages/admin/AZAVCompliancePage'));
const ControllingPage = lazy(() => import('@/pages/admin/ControllingPage'));

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const tabs = [
  { path: '/admin/finance/overview', label: 'Umsatz & Billing' },
  { path: '/admin/finance/controlling', label: 'Controlling' },
  { path: '/admin/finance/licenses', label: 'Lizenzen & Seats' },
  { path: '/admin/finance/compliance', label: 'AZAV Compliance' },
  { path: '/admin/finance/exports', label: 'Exports' },
];

export default function FinancePage() {
  const location = useLocation();
  const activeTab = tabs.find(t => location.pathname.startsWith(t.path))?.path || tabs[0].path;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Finance</h1>
        <p className="text-sm text-muted-foreground">Umsatz, Lizenzen, AZAV-Compliance & Steuerexporte</p>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-1 border-b border-border pb-px min-w-max">
          {tabs.map(tab => (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "px-3 py-2 text-sm rounded-t-md transition-colors",
                activeTab === tab.path
                  ? "bg-primary/10 text-primary font-medium border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<FinanceDashboard />} />
          <Route path="controlling" element={<ControllingPage />} />
          <Route path="licenses" element={<EnterpriseSeatManagement />} />
          <Route path="compliance" element={<AZAVCompliancePage />} />
          <Route path="exports" element={<AuditExportsPage />} />
        </Routes>
      </Suspense>
    </div>
  );
}
