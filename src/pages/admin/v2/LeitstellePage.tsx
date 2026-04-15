import { useMemo, useState, lazy, Suspense } from 'react';
import { useAdminPackagesSSOT, AdminPackageSSOT } from '@/hooks/useAdminPackagesSSOT';
import { useAdminQueueSSOT } from '@/hooks/useAdminQueueSSOT';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BuildPackageCard, type BuildPackageCardBadge } from '@/components/admin/command/BuildPackageCard';
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Clock,
  Package, Zap, Shield, Cpu, ListChecks, TrendingDown,
  DollarSign, Users, HeadphonesIcon, Globe, CreditCard, Ticket, Building2, Key, FileText, Server, Target, Link2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BlockedPackagesSheet } from '@/components/admin/command/BlockedPackagesSheet';
import { StuckPackagesSheet } from '@/components/admin/command/StuckPackagesSheet';
import { BuildingPackagesSheet } from '@/components/admin/command/BuildingPackagesSheet';
import { CouncilReviewSheet } from '@/components/admin/command/CouncilReviewSheet';
import { PublishDriftSheet } from '@/components/admin/command/PublishDriftSheet';
import { PublishedPackagesSheet } from '@/components/admin/command/PublishedPackagesSheet';
import { FailedJobsSheet } from '@/components/admin/command/FailedJobsSheet';

const FinancePanel = lazy(() => import('@/components/admin/command/FinancePanel'));
const CrmPanel = lazy(() => import('@/components/admin/command/CrmPanel'));
const SupportPanel = lazy(() => import('@/components/admin/command/SupportPanel'));
const IntegrationsPanel = lazy(() => import('@/components/admin/command/IntegrationsPanel'));
const CompliancePanel = lazy(() => import('@/components/admin/command/CompliancePanel'));

// Enterprise panels
const UsersPanel = lazy(() => import('@/components/admin/enterprise/UsersPanel'));
const LicensesPanel = lazy(() => import('@/components/admin/enterprise/LicensesPanel'));
const AssignmentsPanel = lazy(() => import('@/components/admin/enterprise/AssignmentsPanel'));
const OrganizationsPanel = lazy(() => import('@/components/admin/enterprise/OrganizationsPanel'));
const ApiKeysPanel = lazy(() => import('@/components/admin/enterprise/ApiKeysPanel'));
const AuditPanel = lazy(() => import('@/components/admin/enterprise/AuditPanel'));
const SystemPanel = lazy(() => import('@/components/admin/enterprise/SystemPanel'));
const IntegrationHub = lazy(() => import('@/components/admin/enterprise/IntegrationHub'));
const SalesDemoPanel = lazy(() => import('@/components/admin/enterprise/SalesDemoPanel'));

const RepairExhaustedAlert = lazy(() => import('@/components/admin/cards/RepairExhaustedAlert').then(m => ({ default: m.RepairExhaustedAlert })));
const ExamPoolAuditCard = lazy(() => import('@/components/admin/cards/ExamPoolAuditCard'));
const BlockedButReadyCard = lazy(() => import('@/components/admin/cards/BlockedButReadyCard'));
const RecoveryBoardCard = lazy(() => import('@/components/admin/cards/RecoveryBoardCard'));
const ValidateGuardDiagnosticsCard = lazy(() => import('@/components/admin/cards/ValidateGuardDiagnosticsCard'));
const BatchActionsCard = lazy(() => import('@/components/admin/cards/BatchActionsCard'));
const WorkerLivenessCard = lazy(() => import('@/components/admin/cards/WorkerLivenessCard'));
const ThroughputCard = lazy(() => import('@/components/admin/cards/ThroughputCard'));
const OrphanStepCard = lazy(() => import('@/components/admin/cards/OrphanStepCard'));

function KpiTile({ label, value, icon, tone = 'neutral', onClick }: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone?: 'green' | 'yellow' | 'red' | 'neutral';
  onClick?: () => void;
}) {
  const toneClasses = {
    green: 'border-success/30 bg-success/5',
    yellow: 'border-warning/30 bg-warning/5',
    red: 'border-destructive/30 bg-destructive/5',
    neutral: 'border-border bg-card',
  };
  return (
    <div
      className={cn(
        "rounded-xl border p-3 flex items-start gap-3",
        toneClasses[tone],
        onClick && 'cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all active:scale-[0.98]'
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="min-w-0">
        <div className="text-lg font-bold text-foreground leading-tight">{value}</div>
        <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{label}</div>
      </div>
    </div>
  );
}

function getBuildPackageWarnings(pkg: AdminPackageSSOT): BuildPackageCardBadge[] {
  const warnings: BuildPackageCardBadge[] = [];
  if (pkg.is_stuck) warnings.push({ label: 'Festgefahren', tone: 'red' });
  if (pkg.has_stale_publish) warnings.push({ label: 'Stale Publish', tone: 'yellow' });
  if (pkg.has_publish_drift) warnings.push({ label: 'Publish Drift', tone: 'red' });
  if (pkg.jobs_failed > 0) warnings.push({ label: `${pkg.jobs_failed} Jobs fehlgeschlagen`, tone: 'red' });
  if (pkg.council_sessions_pending > 0) warnings.push({ label: `Council: ${pkg.council_sessions_pending} offen`, tone: 'yellow' });
  if (pkg.council_complete && !pkg.council_approved) warnings.push({ label: 'Council fertig, nicht approved', tone: 'yellow' });
  if (pkg.blocked_reason) warnings.push({ label: 'Blockiert', tone: 'red' });

  return warnings;
}

export default function LeitstellePage() {
  const { data: packages, isLoading: pkgLoading } = useAdminPackagesSSOT();
  const { data: jobs, isLoading: jobLoading } = useAdminQueueSSOT();
  const [blockedSheetOpen, setBlockedSheetOpen] = useState(false);
  const [stuckSheetOpen, setStuckSheetOpen] = useState(false);
  const [buildingSheetOpen, setBuildingSheetOpen] = useState(false);
  const [councilSheetOpen, setCouncilSheetOpen] = useState(false);
  const [driftSheetOpen, setDriftSheetOpen] = useState(false);
  const [publishedSheetOpen, setPublishedSheetOpen] = useState(false);
  const [failedJobsOpen, setFailedJobsOpen] = useState(false);
  const [zombieJobsOpen, setZombieJobsOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [crmOpen, setCrmOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [complianceOpen, setComplianceOpen] = useState(false);

  const kpis = useMemo(() => {
    if (!packages || !jobs) return null;
    const building = packages.filter(p => p.status === 'building').length;
    const councilReview = packages.filter(p => p.status === 'council_review').length;
    const published = packages.filter(p => p.status === 'published' || p.is_published).length;
    const stuck = packages.filter(p => p.is_stuck).length;
    const blocked = packages.filter(p => p.blocked_reason).length;
    const stalePublish = packages.filter(p => p.has_stale_publish).length;
    const publishDrift = packages.filter(p => p.has_publish_drift).length;
    const councilCompleteNotApproved = packages.filter(p => p.council_complete && !p.council_approved).length;
    const jobsPending = jobs.filter(j => j.job_status === 'pending' || j.job_status === 'queued').length;
    const jobsProcessing = jobs.filter(j => ['processing', 'running', 'batch_pending'].includes(j.job_status)).length;
    const jobsFailed = jobs.filter(j => j.job_status === 'failed').length;
    const zombies = jobs.filter(j => j.health_signal === 'zombie').length;
    return { building, councilReview, published, stuck, blocked, stalePublish, publishDrift, councilCompleteNotApproved, jobsPending, jobsProcessing, jobsFailed, zombies };
  }, [packages, jobs]);

  const criticalPackages = useMemo(() => {
    if (!packages) return [];
    return packages.filter(p =>
      p.is_stuck || p.has_stale_publish || p.has_publish_drift ||
      p.jobs_failed > 0 || p.blocked_reason ||
      p.council_sessions_pending > 0 ||
      (p.council_complete && !p.council_approved)
    )
      .sort((a, b) => {
        if (a.is_stuck !== b.is_stuck) return a.is_stuck ? -1 : 1;
        if (a.has_publish_drift !== b.has_publish_drift) return a.has_publish_drift ? -1 : 1;
        if ((a.jobs_failed > 0) !== (b.jobs_failed > 0)) return a.jobs_failed > 0 ? -1 : 1;
        return 0;
      })
      .slice(0, 10);
  }, [packages]);

  const isLoading = pkgLoading || jobLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      </div>
    );
  }

  const isFallback = packages?.some(p => p._source === 'fallback_course_packages');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground">Leitstelle</h1>
          <p className="text-xs text-muted-foreground mt-0.5">SSOT-Systemlage · Echtdaten</p>
        </div>
        {isFallback && (
          <Badge variant="outline" className="border-warning/50 text-warning text-[10px] px-1.5 py-0.5">
            Fallback-Modus
          </Badge>
        )}
      </div>

      {/* Enterprise Command Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full flex overflow-x-auto">
          <TabsTrigger value="overview" className="text-xs flex-1 min-w-0">Übersicht</TabsTrigger>
          <TabsTrigger value="users" className="text-xs flex-1 min-w-0 gap-1"><Users className="h-3 w-3 hidden sm:block" />Users</TabsTrigger>
          <TabsTrigger value="licenses" className="text-xs flex-1 min-w-0 gap-1"><CreditCard className="h-3 w-3 hidden sm:block" />Lizenzen</TabsTrigger>
          <TabsTrigger value="assignments" className="text-xs flex-1 min-w-0 gap-1"><Ticket className="h-3 w-3 hidden sm:block" />Seats</TabsTrigger>
          <TabsTrigger value="orgs" className="text-xs flex-1 min-w-0 gap-1"><Building2 className="h-3 w-3 hidden sm:block" />Orgs</TabsTrigger>
          <TabsTrigger value="integrations" className="text-xs flex-1 min-w-0 gap-1"><Link2 className="h-3 w-3 hidden sm:block" />SSO/SCIM</TabsTrigger>
          <TabsTrigger value="apikeys" className="text-xs flex-1 min-w-0 gap-1"><Key className="h-3 w-3 hidden sm:block" />API Keys</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs flex-1 min-w-0 gap-1"><FileText className="h-3 w-3 hidden sm:block" />Audit</TabsTrigger>
          <TabsTrigger value="system" className="text-xs flex-1 min-w-0 gap-1"><Server className="h-3 w-3 hidden sm:block" />System</TabsTrigger>
          <TabsTrigger value="demo" className="text-xs flex-1 min-w-0 gap-1"><Target className="h-3 w-3 hidden sm:block" />Demo</TabsTrigger>
        </TabsList>

        {/* Enterprise Tabs */}
        <TabsContent value="users"><Suspense fallback={<Skeleton className="h-64" />}><UsersPanel /></Suspense></TabsContent>
        <TabsContent value="licenses"><Suspense fallback={<Skeleton className="h-64" />}><LicensesPanel /></Suspense></TabsContent>
        <TabsContent value="assignments"><Suspense fallback={<Skeleton className="h-64" />}><AssignmentsPanel /></Suspense></TabsContent>
        <TabsContent value="orgs"><Suspense fallback={<Skeleton className="h-64" />}><OrganizationsPanel /></Suspense></TabsContent>
        <TabsContent value="integrations"><Suspense fallback={<Skeleton className="h-64" />}><IntegrationHub /></Suspense></TabsContent>
        <TabsContent value="apikeys"><Suspense fallback={<Skeleton className="h-64" />}><ApiKeysPanel /></Suspense></TabsContent>
        <TabsContent value="audit"><Suspense fallback={<Skeleton className="h-64" />}><AuditPanel /></Suspense></TabsContent>
        <TabsContent value="system"><Suspense fallback={<Skeleton className="h-64" />}><SystemPanel /></Suspense></TabsContent>
        <TabsContent value="demo"><Suspense fallback={<Skeleton className="h-64" />}><SalesDemoPanel /></Suspense></TabsContent>

        {/* Original Overview Content */}
        <TabsContent value="overview" className="space-y-6">

      {/* ═══ SECTION 1: Critical Alerts (always visible, top priority) ═══ */}
      <Suspense fallback={null}>
        <RepairExhaustedAlert />
      </Suspense>

      {/* KPI Grid */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiTile label="Builds aktiv" value={kpis.building} icon={<Activity className="h-4 w-4 text-primary" />} tone={kpis.building > 0 ? 'green' : 'neutral'} onClick={() => setBuildingSheetOpen(true)} />
          <KpiTile label="Council Review" value={kpis.councilReview} icon={<Shield className="h-4 w-4 text-warning" />} tone={kpis.councilReview > 0 ? 'yellow' : 'neutral'} onClick={() => setCouncilSheetOpen(true)} />
          <KpiTile label="Veröffentlicht" value={kpis.published} icon={<CheckCircle2 className="h-4 w-4 text-success" />} tone="green" onClick={() => setPublishedSheetOpen(true)} />
          <KpiTile label="Festgefahren" value={kpis.stuck} icon={<AlertTriangle className="h-4 w-4 text-destructive" />} tone={kpis.stuck > 0 ? 'red' : 'neutral'} onClick={() => setStuckSheetOpen(true)} />
          <KpiTile label="Blockiert" value={kpis.blocked} icon={<XCircle className="h-4 w-4 text-destructive" />} tone={kpis.blocked > 0 ? 'red' : 'neutral'} onClick={() => setBlockedSheetOpen(true)} />
          <KpiTile label="Publish Drift" value={kpis.publishDrift} icon={<TrendingDown className="h-4 w-4 text-destructive" />} tone={kpis.publishDrift > 0 ? 'red' : 'neutral'} onClick={() => setDriftSheetOpen(true)} />
        </div>
      )}

      {/* ═══ SECTION 2: Situational Warnings ═══ */}
      {/* Drift Warnings */}
      {kpis && kpis.stalePublish > 0 && (
        <div
          className="rounded-xl border border-warning/30 bg-warning/5 p-3 flex items-start gap-3 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          onClick={() => setDriftSheetOpen(true)}
          role="button"
        >
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-foreground">{kpis.stalePublish} Paket(e) mit Stale-Publish-Signalen</div>
            <div className="text-xs text-muted-foreground mt-0.5">Historische Veröffentlichungsmarker, aber Paket nicht veröffentlicht.</div>
          </div>
        </div>
      )}

      {kpis && kpis.publishDrift > 0 && (
        <div
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-3 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          onClick={() => setDriftSheetOpen(true)}
          role="button"
        >
          <TrendingDown className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-foreground">{kpis.publishDrift} Paket(e) mit Publish Drift</div>
            <div className="text-xs text-muted-foreground mt-0.5">Status „published", aber Publish-Gate inhaltlich nicht bestanden.</div>
          </div>
        </div>
      )}

      {kpis && kpis.councilCompleteNotApproved > 0 && (
        <div
          className="rounded-xl border border-warning/30 bg-warning/5 p-3 flex items-start gap-3 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          onClick={() => setCouncilSheetOpen(true)}
          role="button"
        >
          <Shield className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-foreground">{kpis.councilCompleteNotApproved} Paket(e): Council fertig, nicht approved</div>
            <div className="text-xs text-muted-foreground mt-0.5">Alle Sessions abgeschlossen, aber council_approved noch nicht gesetzt.</div>
          </div>
        </div>
      )}

      {/* ═══ SECTION 3: Queue Status ═══ */}
      {kpis && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-muted-foreground" /> Queue
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiTile label="Pending" value={kpis.jobsPending} icon={<Clock className="h-4 w-4 text-muted-foreground" />} />
            <KpiTile label="Processing" value={kpis.jobsProcessing} icon={<Zap className="h-4 w-4 text-primary" />} tone={kpis.jobsProcessing > 0 ? 'green' : 'neutral'} />
            <KpiTile label="Failed" value={kpis.jobsFailed} icon={<XCircle className="h-4 w-4 text-destructive" />} tone={kpis.jobsFailed > 0 ? 'red' : 'neutral'} onClick={() => setFailedJobsOpen(true)} />
            <KpiTile label="Zombies" value={kpis.zombies} icon={<AlertTriangle className="h-4 w-4 text-destructive" />} tone={kpis.zombies > 0 ? 'red' : 'neutral'} onClick={() => setZombieJobsOpen(true)} />
          </div>
        </div>
      )}

      {/* ═══ SECTION 4: Diagnostics & Repair Tools ═══ */}
      {/* Validate Guard Diagnostics — actionable repair cards */}
      <Suspense fallback={<Skeleton className="h-28" />}>
        <ValidateGuardDiagnosticsCard />
      </Suspense>

      {/* Exam Pool Audit */}
      <Suspense fallback={<Skeleton className="h-32" />}>
        <ExamPoolAuditCard />
      </Suspense>

      {/* Status Invariant Violations */}
      <Suspense fallback={<Skeleton className="h-28" />}>
        <BlockedButReadyCard />
      </Suspense>

      {/* Recovery Board */}
      <Suspense fallback={<Skeleton className="h-28" />}>
        <RecoveryBoardCard />
      </Suspense>

      {/* ═══ SECTION 5: Throughput & Operations ═══ */}
      {/* Throughput & Cost */}
      <Suspense fallback={<Skeleton className="h-24" />}>
        <ThroughputCard />
      </Suspense>

      {/* Batch Actions */}
      <Suspense fallback={<Skeleton className="h-28" />}>
        <BatchActionsCard />
      </Suspense>

      {/* Worker Liveness */}
      <Suspense fallback={<Skeleton className="h-20" />}>
        <WorkerLivenessCard />
      </Suspense>

      {/* Orphan-Step Audit */}
      <Suspense fallback={<Skeleton className="h-28" />}>
        <OrphanStepCard />
      </Suspense>

      {/* Critical Packages */}
      {criticalPackages.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" /> Kritische Pakete
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {criticalPackages.map((pkg) => {
              const title = pkg.canonical_title || pkg.raw_title || 'Unbenannt';

              return (
                <BuildPackageCard
                  key={pkg.package_id}
                  packageId={pkg.package_id}
                  title={title}
                  status={pkg.status}
                  badges={getBuildPackageWarnings(pkg)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Link to="/admin/studio" className="rounded-xl border border-border bg-card p-4 hover:bg-muted/50 transition-colors flex items-center gap-3">
          <Package className="h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-semibold">Alle Kurse</div>
            <div className="text-[11px] text-muted-foreground">{packages?.length || 0} Pakete</div>
          </div>
        </Link>
        <Link to="/admin/queue" className="rounded-xl border border-border bg-card p-4 hover:bg-muted/50 transition-colors flex items-center gap-3">
          <ListChecks className="h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-semibold">Queue</div>
            <div className="text-[11px] text-muted-foreground">{jobs?.length || 0} Jobs</div>
          </div>
        </Link>
        <div
          className="rounded-xl border border-border bg-card p-4 hover:bg-muted/50 transition-colors flex items-center gap-3 cursor-pointer"
          onClick={() => setFinanceOpen(true)}
          role="button"
        >
          <DollarSign className="h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-semibold">Finanzen</div>
            <div className="text-[11px] text-muted-foreground">Revenue & Kosten</div>
          </div>
        </div>
        <div
          className="rounded-xl border border-border bg-card p-4 hover:bg-muted/50 transition-colors flex items-center gap-3 cursor-pointer"
          onClick={() => setCrmOpen(true)}
          role="button"
        >
          <Users className="h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-semibold">CRM</div>
            <div className="text-[11px] text-muted-foreground">Leads & Pipeline</div>
          </div>
        </div>
        <div
          className="rounded-xl border border-border bg-card p-4 hover:bg-muted/50 transition-colors flex items-center gap-3 cursor-pointer"
          onClick={() => setSupportOpen(true)}
          role="button"
        >
          <HeadphonesIcon className="h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-semibold">Support</div>
            <div className="text-[11px] text-muted-foreground">Tickets & Alerts</div>
          </div>
        </div>
        <div
          className="rounded-xl border border-border bg-card p-4 hover:bg-muted/50 transition-colors flex items-center gap-3 cursor-pointer"
          onClick={() => setIntegrationsOpen(true)}
          role="button"
        >
          <Globe className="h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-semibold">Integrationen</div>
            <div className="text-[11px] text-muted-foreground">SSO, LTI, CSV, API</div>
          </div>
        </div>
        <div
          className="rounded-xl border border-border bg-card p-4 hover:bg-muted/50 transition-colors flex items-center gap-3 cursor-pointer"
          onClick={() => setComplianceOpen(true)}
          role="button"
        >
          <Shield className="h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-semibold">Compliance</div>
            <div className="text-[11px] text-muted-foreground">DSGVO, AI Act, Security</div>
          </div>
        </div>
      </div>

      <BlockedPackagesSheet open={blockedSheetOpen} onOpenChange={setBlockedSheetOpen} />
      <StuckPackagesSheet open={stuckSheetOpen} onOpenChange={setStuckSheetOpen} />
      <BuildingPackagesSheet open={buildingSheetOpen} onOpenChange={setBuildingSheetOpen} />
      <CouncilReviewSheet open={councilSheetOpen} onOpenChange={setCouncilSheetOpen} />
      <PublishDriftSheet open={driftSheetOpen} onOpenChange={setDriftSheetOpen} />
      <PublishedPackagesSheet open={publishedSheetOpen} onOpenChange={setPublishedSheetOpen} />
      <FailedJobsSheet open={failedJobsOpen} onOpenChange={setFailedJobsOpen} mode="failed" />
      <FailedJobsSheet open={zombieJobsOpen} onOpenChange={setZombieJobsOpen} mode="zombie" />

      <Suspense fallback={null}>
        <FinancePanel open={financeOpen} onOpenChange={setFinanceOpen} />
        <CrmPanel open={crmOpen} onOpenChange={setCrmOpen} />
        <SupportPanel open={supportOpen} onOpenChange={setSupportOpen} />
        <IntegrationsPanel open={integrationsOpen} onOpenChange={setIntegrationsOpen} />
        <CompliancePanel open={complianceOpen} onOpenChange={setComplianceOpen} />
      </Suspense>
      </TabsContent>
      </Tabs>
    </div>
  );
}
