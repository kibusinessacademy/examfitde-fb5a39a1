import { useMemo, lazy, Suspense } from 'react';
import { useAdminPackagesSSOT, AdminPackageSSOT } from '@/hooks/useAdminPackagesSSOT';
import { useAdminQueueSSOT } from '@/hooks/useAdminQueueSSOT';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Clock,
  Package, Zap, Shield, ArrowRight, Cpu, ListChecks, TrendingDown
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ExamPoolAuditCard = lazy(() => import('@/components/admin/cards/ExamPoolAuditCard'));
const TrapCoverageAuditCard = lazy(() => import('@/components/admin/cards/TrapCoverageAuditCard'));
const TrapDistributionAuditCard = lazy(() => import('@/components/admin/cards/TrapDistributionAuditCard'));
const BlueprintMatchAuditCard = lazy(() => import('@/components/admin/cards/BlueprintMatchAuditCard'));

function KpiTile({ label, value, icon, tone = 'neutral' }: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone?: 'green' | 'yellow' | 'red' | 'neutral';
}) {
  const toneClasses = {
    green: 'border-success/30 bg-success/5',
    yellow: 'border-warning/30 bg-warning/5',
    red: 'border-destructive/30 bg-destructive/5',
    neutral: 'border-border bg-card',
  };
  return (
    <div className={cn("rounded-xl border p-3 flex items-start gap-3", toneClasses[tone])}>
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="min-w-0">
        <div className="text-lg font-bold text-foreground leading-tight">{value}</div>
        <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{label}</div>
      </div>
    </div>
  );
}

function CriticalPackageCard({ pkg }: { pkg: AdminPackageSSOT }) {
  const title = pkg.canonical_title || pkg.raw_title || 'Unbenannt';
  const warnings: { label: string; tone: 'red' | 'yellow' }[] = [];
  if (pkg.is_stuck) warnings.push({ label: 'Festgefahren', tone: 'red' });
  if (pkg.has_stale_publish) warnings.push({ label: 'Stale Publish', tone: 'yellow' });
  if (pkg.has_publish_drift) warnings.push({ label: 'Publish Drift', tone: 'red' });
  if (pkg.jobs_failed > 0) warnings.push({ label: `${pkg.jobs_failed} Jobs fehlgeschlagen`, tone: 'red' });
  if (pkg.council_sessions_pending > 0) warnings.push({ label: `Council: ${pkg.council_sessions_pending} offen`, tone: 'yellow' });
  if (pkg.council_complete && !pkg.council_approved) warnings.push({ label: 'Council fertig, nicht approved', tone: 'yellow' });
  if (pkg.blocked_reason) warnings.push({ label: 'Blockiert', tone: 'red' });

  return (
    <Link
      to={`/admin/studio/${pkg.package_id}`}
      className="block rounded-xl border border-border bg-card p-3 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground truncate">{title}</div>
          <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
            {pkg.package_id.slice(0, 8)} · {pkg.status}
          </div>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
      </div>
      <div className="flex flex-wrap gap-1">
        {warnings.map((w, i) => (
          <Badge
            key={i}
            variant="outline"
            className={cn(
              "text-[9px] px-1.5 py-0 h-4",
              w.tone === 'red' ? 'border-destructive/40 text-destructive bg-destructive/5' : 'border-warning/40 text-warning bg-warning/5'
            )}
          >
            {w.label}
          </Badge>
        ))}
      </div>
    </Link>
  );
}

export default function LeitstellePage() {
  const { data: packages, isLoading: pkgLoading } = useAdminPackagesSSOT();
  const { data: jobs, isLoading: jobLoading } = useAdminQueueSSOT();

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

      {/* KPI Grid */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiTile label="Builds aktiv" value={kpis.building} icon={<Activity className="h-4 w-4 text-primary" />} tone={kpis.building > 0 ? 'green' : 'neutral'} />
          <KpiTile label="Council Review" value={kpis.councilReview} icon={<Shield className="h-4 w-4 text-warning" />} tone={kpis.councilReview > 0 ? 'yellow' : 'neutral'} />
          <KpiTile label="Veröffentlicht" value={kpis.published} icon={<CheckCircle2 className="h-4 w-4 text-success" />} tone="green" />
          <KpiTile label="Festgefahren" value={kpis.stuck} icon={<AlertTriangle className="h-4 w-4 text-destructive" />} tone={kpis.stuck > 0 ? 'red' : 'neutral'} />
          <KpiTile label="Blockiert" value={kpis.blocked} icon={<XCircle className="h-4 w-4 text-destructive" />} tone={kpis.blocked > 0 ? 'red' : 'neutral'} />
          <KpiTile label="Publish Drift" value={kpis.publishDrift} icon={<TrendingDown className="h-4 w-4 text-destructive" />} tone={kpis.publishDrift > 0 ? 'red' : 'neutral'} />
        </div>
      )}

      {/* Queue Pressure */}
      {kpis && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-muted-foreground" /> Queue
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiTile label="Pending" value={kpis.jobsPending} icon={<Clock className="h-4 w-4 text-muted-foreground" />} />
            <KpiTile label="Processing" value={kpis.jobsProcessing} icon={<Zap className="h-4 w-4 text-primary" />} tone={kpis.jobsProcessing > 0 ? 'green' : 'neutral'} />
            <KpiTile label="Failed" value={kpis.jobsFailed} icon={<XCircle className="h-4 w-4 text-destructive" />} tone={kpis.jobsFailed > 0 ? 'red' : 'neutral'} />
            <KpiTile label="Zombies" value={kpis.zombies} icon={<AlertTriangle className="h-4 w-4 text-destructive" />} tone={kpis.zombies > 0 ? 'red' : 'neutral'} />
          </div>
        </div>
      )}

      {/* Drift Warnings */}
      {kpis && kpis.stalePublish > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-foreground">{kpis.stalePublish} Paket(e) mit Stale-Publish-Signalen</div>
            <div className="text-xs text-muted-foreground mt-0.5">Historische Veröffentlichungsmarker, aber Paket nicht veröffentlicht.</div>
          </div>
        </div>
      )}

      {kpis && kpis.publishDrift > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-3">
          <TrendingDown className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-foreground">{kpis.publishDrift} Paket(e) mit Publish Drift</div>
            <div className="text-xs text-muted-foreground mt-0.5">Status „published", aber Publish-Gate inhaltlich nicht bestanden.</div>
          </div>
        </div>
      )}

      {kpis && kpis.councilCompleteNotApproved > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 flex items-start gap-3">
          <Shield className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-foreground">{kpis.councilCompleteNotApproved} Paket(e): Council fertig, nicht approved</div>
            <div className="text-xs text-muted-foreground mt-0.5">Alle Sessions abgeschlossen, aber council_approved noch nicht gesetzt.</div>
          </div>
        </div>
      )}

      {/* Exam Pool Lifecycle Audit */}
      {/* Exam Pool Lifecycle Audit */}
      <Suspense fallback={<Skeleton className="h-32" />}>
        <ExamPoolAuditCard />
      </Suspense>

      {/* Trap Coverage Audit */}
      <Suspense fallback={<Skeleton className="h-24" />}>
        <TrapCoverageAuditCard />
      </Suspense>

      {/* Trap Distribution Quality Audit */}
      <Suspense fallback={<Skeleton className="h-32" />}>
        <TrapDistributionAuditCard />
      </Suspense>

      {/* Critical Packages */}
      {criticalPackages.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" /> Kritische Pakete
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {criticalPackages.map(pkg => (
              <CriticalPackageCard key={pkg.package_id} pkg={pkg} />
            ))}
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-3">
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
      </div>
    </div>
  );
}
