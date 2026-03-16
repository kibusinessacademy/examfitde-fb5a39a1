import { lazy, Suspense } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import PageExplainer from '@/components/admin/PageExplainer';

const SystemHealthPage = lazy(() => import('@/pages/admin/SystemHealthPage'));
const AIWorkersPage = lazy(() => import('@/pages/admin/AIWorkersPage'));
const LoadControlPage = lazy(() => import('@/pages/admin/v4/LoadControlPage'));
const SecurityFreezePage = lazy(() => import('@/pages/admin/v4/SecurityFreezePage'));

const OpsOverview = lazy(() => import('./ops/OpsOverview'));
const QueueDashboard = lazy(() => import('./ops/QueueDashboard'));
const ThroughputDashboard = lazy(() => import('./ops/ThroughputDashboard'));
const ScalingDashboard = lazy(() => import('./ops/ScalingDashboard'));
const QualityCouncilDashboard = lazy(() => import('./ops/QualityCouncilDashboard'));
const ROIDashboard = lazy(() => import('./ops/ROIDashboard'));
const FactoryDashboard = lazy(() => import('./ops/FactoryDashboard'));
const TrustDashboard = lazy(() => import('./ops/TrustDashboard'));
const ProviderAutopilotDashboard = lazy(() => import('./ops/ProviderAutopilotDashboard'));
const AutoHealCenter = lazy(() => import('./ops/AutoHealCenter'));
const LiveLogs = lazy(() => import('./ops/LiveLogs'));
const DeadLetterCenter = lazy(() => import('./ops/DeadLetterCenter'));
const TestDashboard = lazy(() => import('./ops/TestDashboard'));
const SchemaDriftDashboard = lazy(() => import('./ops/SchemaDriftDashboard'));
const AIGatewayDashboard = lazy(() => import('./ops/AIGatewayDashboard'));
const KnowledgeGraphDashboard = lazy(() => import('./ops/KnowledgeGraphDashboard'));
const BatchRecoveryDashboard = lazy(() => import('./ops/BatchRecoveryDashboard'));
const CourseNamingIntegrityPanel = lazy(() => import('./ops/CourseNamingIntegrityPanel'));
const JobFailureIntegrityPanel = lazy(() => import('./ops/JobFailureIntegrityPanel'));
const V2LoopDebugPage = lazy(() => import('./ops/V2LoopDebugPage'));
const ReentryMissesPanel = lazy(() => import('./ops/ReentryMissesPanel'));
const PipelineMapDashboard = lazy(() => import('./ops/PipelineMapDashboard'));
const ExecutiveReportDashboard = lazy(() => import('./ops/ExecutiveReportDashboard'));

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const tabs = [
  { path: '/admin/ops', label: 'Ampel' },
  { path: '/admin/ops/queue', label: 'Queue' },
  { path: '/admin/ops/throughput', label: '📊 ETA & Throughput' },
  { path: '/admin/ops/scaling', label: '⚡ Scaling' },
  { path: '/admin/ops/quality', label: '🛡️ Quality Council' },
  { path: '/admin/ops/roi', label: '💰 ROI' },
  { path: '/admin/ops/factory', label: '🏭 Factory' },
  { path: '/admin/ops/trust', label: '🏅 Trust' },
  { path: '/admin/ops/providers', label: 'Provider Autopilot' },
  { path: '/admin/ops/autoheal', label: 'Auto-Heal' },
  { path: '/admin/ops/load-control', label: 'Load Control' },
  { path: '/admin/ops/logs', label: 'Live Logs' },
  { path: '/admin/ops/deadletter', label: 'Dead Letter' },
  { path: '/admin/ops/health', label: 'Health' },
  { path: '/admin/ops/ai-workers', label: 'AI Workers' },
  { path: '/admin/ops/security', label: '🔐 Security' },
  { path: '/admin/ops/tests', label: '🧪 Tests' },
  { path: '/admin/ops/schema', label: '🛡️ Schema SSOT' },
  { path: '/admin/ops/ai-gateway', label: '🚀 AI Gateway' },
  { path: '/admin/ops/knowledge-graph', label: '🧠 Knowledge Graph' },
  { path: '/admin/ops/batch-recovery', label: '🔄 Batch Recovery' },
  { path: '/admin/ops/course-naming', label: '📛 Course Naming' },
  { path: '/admin/ops/failure-integrity', label: '🛡️ Failure Integrity' },
  { path: '/admin/ops/v2-loop-debug', label: '🧪 V2 Loop Debug' },
  { path: '/admin/ops/reentry-misses', label: '⚠️ Re-Entry Misses' },
  { path: '/admin/ops/pipeline-map', label: '🗺️ Pipeline Map' },
  { path: '/admin/ops/executive', label: '📊 Executive Report' },
];

export default function OpsPage() {
  const location = useLocation();
  const activeTab = tabs.find(t => location.pathname === t.path)?.path ||
    tabs.find(t => location.pathname.startsWith(t.path) && t.path !== '/admin/ops')?.path ||
    tabs[0].path;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Ops & Auto-Heal</h1>
        <p className="text-sm text-muted-foreground">Ampel · Queue · Auto-Heal · Logs · Health · AI Workers</p>
      </div>

      <PageExplainer
        title="Wie funktioniert Ops & Auto-Heal?"
        description="Die technische Leitzentrale mit Ampel-System. Der Daily Runner prüft Schema, RLS, Jobs, Edge Functions und triggert bei Content-Gaps automatisch den Auto-Gap-Closer – blockiert aber bei strukturellen Problemen."
        workflow={[
          { label: 'Leitstelle' },
          { label: 'Studio' },
          { label: 'Quality' },
          { label: 'Ops', active: true },
          { label: 'Business' },
          { label: 'Growth' },
          { label: 'Scale' },
        ]}
        actions={[
          '"Ampel" – System-Status auf einen Blick mit Root-Cause-Ranking und Quick Actions',
          '"Queue" – Alle Jobs mit Status, Attempts und Fehlermeldungen',
          '"Auto-Heal" – Autofix Runs, Budget-Verbrauch, Policy-Konfiguration, Freeze/Stop-Gründe',
          '"Live Logs" – Terminal-ähnliche Echtzeit-Ansicht aller Job-Events',
          '"Dead Letter" – Fehlgeschlagene Jobs retrien oder exportieren',
        ]}
        tips={[
          'Grün = alles ok. Gelb = Warnung (failed jobs). Rot = Strukturproblem (Auto-Heal blockiert)',
          'Budget Circuit-Breaker stoppt bei €15/Tag automatisch',
          'Regression-Freeze friert ein, wenn Score sich nicht verbessert',
        ]}
      />

      <div className="overflow-x-auto">
        <div className="flex gap-1 border-b border-border pb-px min-w-max">
          {tabs.map(tab => (
            <Link key={tab.path} to={tab.path}
              className={cn(
                "px-3 py-2 text-sm rounded-t-md transition-colors",
                activeTab === tab.path
                  ? "bg-primary/10 text-primary font-medium border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}>
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<OpsOverview />} />
          <Route path="queue" element={<QueueDashboard />} />
          <Route path="throughput" element={<ThroughputDashboard />} />
          <Route path="scaling" element={<ScalingDashboard />} />
          <Route path="quality" element={<QualityCouncilDashboard />} />
          <Route path="roi" element={<ROIDashboard />} />
          <Route path="factory" element={<FactoryDashboard />} />
          <Route path="trust" element={<TrustDashboard />} />
          <Route path="providers" element={<ProviderAutopilotDashboard />} />
          <Route path="autoheal" element={<AutoHealCenter />} />
          <Route path="load-control" element={<LoadControlPage />} />
          <Route path="logs" element={<LiveLogs />} />
          <Route path="deadletter" element={<DeadLetterCenter />} />
          <Route path="health" element={<SystemHealthPage />} />
          <Route path="ai-workers" element={<AIWorkersPage />} />
          <Route path="security" element={<SecurityFreezePage />} />
          <Route path="tests" element={<TestDashboard />} />
          <Route path="schema" element={<SchemaDriftDashboard />} />
          <Route path="ai-gateway" element={<AIGatewayDashboard />} />
          <Route path="knowledge-graph" element={<KnowledgeGraphDashboard />} />
          <Route path="batch-recovery" element={<BatchRecoveryDashboard />} />
          <Route path="course-naming" element={<CourseNamingIntegrityPanel />} />
          <Route path="failure-integrity" element={<JobFailureIntegrityPanel />} />
          <Route path="v2-loop-debug" element={<V2LoopDebugPage />} />
          <Route path="reentry-misses" element={<ReentryMissesPanel />} />
          <Route path="pipeline-map" element={<PipelineMapDashboard />} />
        </Routes>
      </Suspense>
    </div>
  );
}
