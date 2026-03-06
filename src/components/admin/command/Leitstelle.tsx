import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCommandData, type PipelinePackage } from '@/hooks/useCommandData';
import { deriveStepProgress } from '@/lib/pipeline-steps';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Package,
  RefreshCw,
  Server,
  Sparkles,
  Wrench,
  XCircle,
  Zap,
  DollarSign,
  Filter,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type JsonRow = Record<string, unknown>;
type FocusMode = 'priorities' | 'build' | 'bottlenecks';

type AlertItem = {
  id: string;
  kind: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  ageMin: number;
  source: 'job_queue' | 'stuck' | 'runner';
  packageId?: string | null;
};

const fmtEur = (v: number) =>
  new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(v || 0);

function freshnessTone(ageMin: number) {
  if (ageMin <= 10) return 'text-emerald-500';
  if (ageMin <= 30) return 'text-amber-500';
  return 'text-muted-foreground';
}

function getStepOk(statuses: Record<string, string>, genKey: string, valKey: string) {
  const gen = statuses[genKey];
  const val = statuses[valKey];
  const done = (gen === 'done' || gen === 'skipped') && (val === 'done' || val === 'skipped');
  const partial = gen === 'done' || gen === 'skipped';
  return { done, partial };
}

function ContentIcon({ done, partial }: { done: boolean; partial?: boolean }) {
  if (done) return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (partial) return <Clock3 className="h-3.5 w-3.5 text-amber-500" />;
  return <XCircle className="h-3.5 w-3.5 text-destructive" />;
}

function KpiTile({
  title,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  title: string;
  value: string | number;
  hint?: string;
  icon: React.ReactNode;
  tone?: 'default' | 'danger' | 'success' | 'warning';
}) {
  return (
    <Card
      className={cn(
        'border-border/70 bg-card/70',
        tone === 'danger' && 'border-destructive/30 bg-destructive/5',
        tone === 'success' && 'border-emerald-500/20 bg-emerald-500/5',
        tone === 'warning' && 'border-amber-500/20 bg-amber-500/5',
      )}
    >
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
          {icon}
          <span>{title}</span>
        </div>
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

function AlertList({ alerts }: { alerts: AlertItem[] }) {
  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span>Aktuelle Prioritäten</span>
          <Badge variant="outline" className="text-[11px]">
            {alerts.length} live
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.length === 0 ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-600">
            Keine akuten Probleme. Leitstelle ist aktuell sauber.
          </div>
        ) : (
          alerts.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                'rounded-xl border p-3',
                alert.kind === 'critical' && 'border-destructive/30 bg-destructive/5',
                alert.kind === 'warning' && 'border-amber-500/30 bg-amber-500/5',
                alert.kind === 'info' && 'border-border bg-background/60',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium leading-tight">{alert.title}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{alert.detail}</div>
                </div>
                <div className={cn('shrink-0 text-[11px]', freshnessTone(alert.ageMin))}>
                  {alert.ageMin} min
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ActionStrip({
  onOpenBottlenecks,
  onOpenPackages,
  onRefresh,
}: {
  onOpenBottlenecks: () => void;
  onOpenPackages: () => void;
  onRefresh: () => void;
}) {
  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Schnellaktionen</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button variant="outline" className="justify-between" onClick={onOpenBottlenecks}>
          Bottlenecks prüfen
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" className="justify-between" onClick={onOpenPackages}>
          Build-Pakete öffnen
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" className="justify-between" onClick={onRefresh}>
          Neu laden
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

function BuildPackageCard({ pkg }: { pkg: PipelinePackage }) {
  const stepStatuses = (pkg.step_status_json || {}) as Record<string, string>;
  const { progress, currentLabel, isActive } = deriveStepProgress(stepStatuses);
  const oral = getStepOk(stepStatuses, 'generate_oral_exam', 'validate_oral_exam');
  const tutor = getStepOk(stepStatuses, 'build_ai_tutor_index', 'validate_tutor_index');
  const handbook = getStepOk(stepStatuses, 'generate_handbook', 'validate_handbook');
  const hasFailed = Object.values(stepStatuses).some((s) => s === 'failed');

  return (
    <div
      className={cn(
        'rounded-2xl border p-4',
        hasFailed && 'border-destructive/30 bg-destructive/5',
        isActive && 'border-primary/30 bg-primary/5',
        !hasFailed && !isActive && 'border-border/70 bg-card/50',
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{pkg.name}</div>
          <div className="mt-1 text-xs text-muted-foreground">{currentLabel}</div>
        </div>
        <Badge variant={isActive ? 'default' : 'outline'}>{progress}%</Badge>
      </div>

      <Progress value={progress} className="h-2" />

      <div className="mt-4 grid grid-cols-3 gap-3 text-center text-[11px] text-muted-foreground">
        <div className="rounded-lg border border-border/60 p-2">
          <div className="mb-1 flex justify-center">
            <ContentIcon done={oral.done} partial={oral.partial} />
          </div>
          Oral
        </div>
        <div className="rounded-lg border border-border/60 p-2">
          <div className="mb-1 flex justify-center">
            <ContentIcon done={tutor.done} partial={tutor.partial} />
          </div>
          Tutor
        </div>
        <div className="rounded-lg border border-border/60 p-2">
          <div className="mb-1 flex justify-center">
            <ContentIcon done={handbook.done} partial={handbook.partial} />
          </div>
          Handbuch
        </div>
      </div>
    </div>
  );
}

export default function Leitstelle() {
  const { packages, kpis, loading, lastRefresh, refetch } = useCommandData();
  const [focus, setFocus] = useState<FocusMode>('priorities');
  const [sheet, setSheet] = useState<'bottlenecks' | 'packages' | null>(null);

  const { data: failedJobs = [] } = useQuery({
    queryKey: ['leitstelle-failed-jobs-live'],
    queryFn: async () => {
      const sb = supabase as any;
      const since = new Date(Date.now() - 90 * 60 * 1000).toISOString();
      const { data, error } = await sb
        .from('job_queue')
        .select('id, job_type, package_id, last_error, updated_at, created_at, status')
        .eq('status', 'failed')
        .gte('updated_at', since)
        .order('updated_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as JsonRow[];
    },
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const { data: stuckRows = [] } = useQuery({
    queryKey: ['leitstelle-stuck-live'],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb.from('ops_package_steps_stuck').select('*').limit(20);
      if (error) return [] as JsonRow[];
      return (data ?? []) as JsonRow[];
    },
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const { data: zombieRows = [] } = useQuery({
    queryKey: ['leitstelle-zombies-live'],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb.from('ops_building_without_job_or_lease').select('*').limit(50);
      if (error) return [] as JsonRow[];
      return (data ?? []) as JsonRow[];
    },
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const alerts = useMemo<AlertItem[]>(() => {
    const now = Date.now();

    const fromFailed = failedJobs.map((row, i) => {
      const ts = String(row.updated_at || row.created_at || new Date().toISOString());
      const ageMin = Math.max(0, Math.round((now - new Date(ts).getTime()) / 60000));
      const errorText = String(row.last_error || 'Unbekannter Fehler');
      return {
        id: `job-${row.id ?? i}`,
        kind: (errorText.includes('STEP_EXHAUSTED') ? 'critical' : 'warning') as AlertItem['kind'],
        title: `${String(row.job_type || 'Job')} fehlgeschlagen`,
        detail: `${errorText.slice(0, 120)}${errorText.length > 120 ? '…' : ''}`,
        ageMin,
        source: 'job_queue' as const,
        packageId: row.package_id ? String(row.package_id) : null,
      };
    });

    const fromStuck = stuckRows.map((row, i) => {
      const ageMin =
        typeof row.minutes_stuck === 'number'
          ? Math.round(row.minutes_stuck)
          : typeof row.stall_minutes === 'number'
            ? Math.round(row.stall_minutes)
            : 0;
      return {
        id: `stuck-${row.package_id ?? i}`,
        kind: (ageMin > 60 ? 'critical' : 'warning') as AlertItem['kind'],
        title: `Step blockiert: ${String(row.step_key || 'unbekannt')}`,
        detail: `${String(row.package_id || 'ohne Paket')} · ${String(row.reason || 'ohne Grund')}`,
        ageMin,
        source: 'stuck' as const,
        packageId: row.package_id ? String(row.package_id) : null,
      };
    });

    const runnerIdleAlert: AlertItem[] =
      kpis && kpis.building_metrics.active_by_leases > 0 && kpis.building_metrics.active_by_jobs === 0
        ? [
            {
              id: 'runner-idle',
              kind: 'critical',
              title: 'Runner idle trotz aktiver Leases',
              detail: `${kpis.building_metrics.active_by_leases} Leases aktiv, aber 0 Jobs laufen.`,
              ageMin: 0,
              source: 'runner',
            },
          ]
        : [];

    return [...runnerIdleAlert, ...fromFailed, ...fromStuck]
      .filter((a) => a.ageMin <= 180)
      .sort((a, b) => {
        const prio = { critical: 3, warning: 2, info: 1 };
        return prio[b.kind] - prio[a.kind] || a.ageMin - b.ageMin;
      })
      .slice(0, 8);
  }, [failedJobs, stuckRows, kpis]);

  const visiblePackages = useMemo(() => {
    const rows = [...packages];
    rows.sort((a, b) => {
      const sa = deriveStepProgress((a.step_status_json || {}) as Record<string, string>);
      const sB = deriveStepProgress((b.step_status_json || {}) as Record<string, string>);
      const activeBoostA = sa.isActive ? 1 : 0;
      const activeBoostB = sB.isActive ? 1 : 0;
      return activeBoostB - activeBoostA || a.build_progress - b.build_progress || Date.parse(a.updated_at) - Date.parse(b.updated_at);
    });
    return rows.slice(0, 6);
  }, [packages]);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!kpis) return null;

  const runnerIdle = kpis.building_metrics.active_by_leases > 0 && kpis.building_metrics.active_by_jobs === 0;
  const bottleneckCount = alerts.filter((a) => a.kind === 'critical' || a.kind === 'warning').length;
  const throughputPerHour = kpis.jobs_completed_today / Math.max(new Date().getHours(), 1);
  const etaHours = throughputPerHour > 0 ? Math.round((kpis.queued / throughputPerHour) * 10) / 10 : 0;

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leitstelle</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Eine verdichtete Startseite für aktuelle Risiken, aktive Builds und die nächsten Entscheidungen.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-muted-foreground">aktualisiert</div>
          <div className="text-sm font-medium">{lastRefresh.toLocaleTimeString('de-DE')}</div>
        </div>
      </div>

      <Tabs value={focus} onValueChange={(v) => setFocus(v as FocusMode)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="priorities">Prioritäten</TabsTrigger>
          <TabsTrigger value="build">Build</TabsTrigger>
          <TabsTrigger value="bottlenecks">Bottlenecks</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          title="Aktive Risiken"
          value={bottleneckCount}
          hint={runnerIdle ? 'Runner braucht Eingriff' : 'nur frische Signale'}
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          tone={bottleneckCount > 0 ? 'danger' : 'success'}
        />
        <KpiTile
          title="Build aktiv"
          value={kpis.building_metrics.active_by_jobs}
          hint={`${kpis.building_metrics.active_by_leases} Leases · ${kpis.building} Pakete im Build`}
          icon={<Server className="h-3.5 w-3.5" />}
          tone={runnerIdle ? 'warning' : 'default'}
        />
        <KpiTile
          title="Queue"
          value={kpis.queued}
          hint={etaHours > 0 ? `ETA Backlog ca. ${etaHours} h` : 'keine ETA verfügbar'}
          icon={<Package className="h-3.5 w-3.5" />}
        />
        <KpiTile
          title="KI-Kosten heute"
          value={fmtEur(kpis.cost_today_eur)}
          hint={`MTD ${fmtEur(kpis.cost_mtd_eur)}`}
          icon={<DollarSign className="h-3.5 w-3.5" />}
        />
      </div>

      {focus === 'priorities' && (
        <>
          <AlertList alerts={alerts} />
          <ActionStrip
            onOpenBottlenecks={() => setSheet('bottlenecks')}
            onOpenPackages={() => setSheet('packages')}
            onRefresh={refetch}
          />
        </>
      )}

      {focus === 'build' && (
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Pakete im Build</span>
              <Badge variant="outline">{packages.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visiblePackages.length === 0 ? (
              <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
                Aktuell keine Build-Pakete.
              </div>
            ) : (
              visiblePackages.map((pkg) => <BuildPackageCard key={pkg.id} pkg={pkg} />)
            )}
          </CardContent>
        </Card>
      )}

      {focus === 'bottlenecks' && (
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Engpässe auf einen Blick</span>
              <Button variant="outline" size="sm" onClick={() => setSheet('bottlenecks')}>
                <Filter className="mr-2 h-4 w-4" />
                Details
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-border p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Wrench className="h-4 w-4 text-destructive" />
                Stuck Steps
              </div>
              <div className="text-3xl font-semibold">{stuckRows.length}</div>
              <div className="mt-1 text-xs text-muted-foreground">nur frische Blocker statt historischer Alert-Müll</div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Zap className="h-4 w-4 text-amber-500" />
                Failed Jobs
              </div>
              <div className="text-3xl font-semibold">{failedJobs.length}</div>
              <div className="mt-1 text-xs text-muted-foreground">letzte 90 Minuten</div>
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                Zombies
              </div>
              <div className="text-3xl font-semibold">{zombieRows.length}</div>
              <div className="mt-1 text-xs text-muted-foreground">Build ohne Job oder Lease</div>
            </div>
          </CardContent>
        </Card>
      )}

      <Sheet open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
        <SheetContent side="right" className="w-[96vw] overflow-y-auto sm:w-[560px]">
          <SheetHeader>
            <SheetTitle>{sheet === 'bottlenecks' ? 'Bottlenecks & Live-Probleme' : 'Build-Pakete'}</SheetTitle>
          </SheetHeader>

          {sheet === 'bottlenecks' ? (
            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-2 text-sm font-semibold">Frische Alerts</div>
                <div className="space-y-2">
                  {alerts.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Keine akuten Alerts.</div>
                  ) : (
                    alerts.map((alert) => (
                      <div key={alert.id} className="rounded-xl border border-border p-3">
                        <div className="font-medium">{alert.title}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{alert.detail}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-semibold">Zombie-Pakete</div>
                <div className="space-y-2">
                  {zombieRows.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Keine Zombies gefunden.</div>
                  ) : (
                    zombieRows.map((row, i) => (
                      <div key={`zombie-${row.package_id ?? i}`} className="rounded-xl border border-border p-3 text-sm">
                        <div className="font-medium">{String(row.title || row.package_id || `Paket ${i + 1}`)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Step: {String(row.current_step || '–')} · Status: {String(row.status || '–')}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {packages.length === 0 ? (
                <div className="text-sm text-muted-foreground">Keine Build-Pakete vorhanden.</div>
              ) : (
                packages.map((pkg) => <BuildPackageCard key={pkg.id} pkg={pkg} />)
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}