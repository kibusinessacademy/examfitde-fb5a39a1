import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const JobsDashboard = lazy(() => import('@/pages/admin/JobsDashboard'));
const JobsList = lazy(() => import('@/pages/admin/JobsList'));
const JobDetail = lazy(() => import('@/pages/admin/JobDetail'));
const JobDeadLetter = lazy(() => import('@/pages/admin/JobDeadLetter'));
const SystemHealthPage = lazy(() => import('@/pages/admin/SystemHealthPage'));
const AIWorkersPage = lazy(() => import('@/pages/admin/AIWorkersPage'));
const OperationsDashboard = lazy(() => import('@/pages/admin/OperationsDashboard'));
const EarlyWarningsPage = lazy(() => import('@/pages/admin/EarlyWarningsPage'));
const PatchCenterPage = lazy(() => import('@/pages/admin/PatchCenterPage'));
const TechCouncilPage = lazy(() => import('@/pages/admin/TechCouncilPage'));
const ComplianceDashboardPage = lazy(() => import('@/pages/admin/ComplianceDashboardPage'));
const QCDashboardPage = lazy(() => import('@/pages/admin/QCDashboardPage'));

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const tabs = [
  { path: '/admin/system/jobs', label: 'Job Queue' },
  { path: '/admin/system/health', label: 'Health' },
  { path: '/admin/system/operations', label: 'Operations' },
  { path: '/admin/system/ai-workers', label: 'AI Workers' },
  { path: '/admin/system/warnings', label: 'Early Warnings' },
  { path: '/admin/system/patches', label: 'Patches' },
  { path: '/admin/system/tech-council', label: 'Tech Council' },
  { path: '/admin/system/compliance', label: 'Compliance' },
  { path: '/admin/system/qa', label: 'QA Center' },
];

export default function SystemPage() {
  const location = useLocation();
  const activeTab = tabs.find(t => location.pathname.startsWith(t.path))?.path || tabs[0].path;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">System & Tech</h1>
        <p className="text-sm text-muted-foreground">Jobs, Monitoring, AI Workers & Infrastruktur</p>
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
          <Route index element={<Navigate to="jobs" replace />} />
          <Route path="jobs" element={<JobsDashboard />} />
          <Route path="jobs/list" element={<JobsList />} />
          <Route path="jobs/deadletter" element={<JobDeadLetter />} />
          <Route path="jobs/:jobId" element={<JobDetail />} />
          <Route path="health" element={<SystemHealthPage />} />
          <Route path="operations" element={<OperationsDashboard />} />
          <Route path="ai-workers" element={<AIWorkersPage />} />
          <Route path="warnings" element={<EarlyWarningsPage />} />
          <Route path="patches" element={<PatchCenterPage />} />
          <Route path="tech-council" element={<TechCouncilPage />} />
          <Route path="compliance" element={<ComplianceDashboardPage />} />
          <Route path="qa" element={<QCDashboardPage />} />
        </Routes>
      </Suspense>
    </div>
  );
}
