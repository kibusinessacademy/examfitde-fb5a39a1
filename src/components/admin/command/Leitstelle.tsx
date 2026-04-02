import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { useToast } from '@/hooks/use-toast';
import { useCommandData, type PipelinePackage, type TransientOps } from '@/hooks/useCommandData';
import { deriveStepProgress } from '@/lib/pipeline-steps';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  Clock3,
  Package,
  RefreshCw,
  RotateCcw,
  Server,
  Sparkles,
  Wrench,
  XCircle,
  Zap,
  DollarSign,
  Filter,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { RootCausePanel } from './RootCausePanel';
import { PolicyCenter } from './PolicyCenter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminSheet as Sheet, AdminSheetContent as SheetContent, AdminSheetHeader as SheetHeader, AdminSheetTitle as SheetTitle } from '@/components/admin/AdminSheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type JsonRow = Record<string, unknown>;
type FocusMode = 'priorities' | 'build' | 'bottlenecks' | 'policies';

type AlertItem = {
  id: string;
  kind: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  ageMin: number;
  source: 'job_queue' | 'stuck' | 'runner' | 'ops';
  packageId?: string | null;
  jobId?: string | null;
  stepKey?: string | null;
};

const LIVE_ALERT_MAX_AGE_MIN = 180;

function isStepStillProblematic(stepStatus?: string | null): boolean {
  return ['failed', 'blocked', 'pending', 'queued', 'processing', 'running'].includes(String(stepStatus || ''));
}

function extractPkgIdFromDetail(detail?: string | null): string | null {
  if (!detail) return null;
  const m = String(detail).match(/\bpkg\s+([a-f0-9-]{6,})\b/i)
    || String(detail).match(/([a-f0-9]{8,})/i);
  return m?.[1] || null;
}

function extractStepKeyFromDetail(detail?: string | null): string | null {
  if (!detail) return null;
  const m = String(detail).match(/STEP_EXHAUSTED:\s*([a-zA-Z0-9_:-]+)/);
  return m?.[1] || null;
}

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
  onRequeueFailed,
  onReleaseCooldowns,
  onResetStuck,
  busy,
}: {
  onOpenBottlenecks: () => void;
  onOpenPackages: () => void;
  onRefresh: () => void;
  onRequeueFailed: () => void;
  onReleaseCooldowns: () => void;
  onResetStuck: () => void;
  busy?: boolean;
}) {
  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Schnellaktionen</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
        <Button variant="outline" className="justify-between" onClick={onRequeueFailed} disabled={busy}>
          Failed Jobs requeue
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        </Button>
        <Button variant="outline" className="justify-between" onClick={onReleaseCooldowns} disabled={busy}>
          Cooldowns freigeben
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        </Button>
        <Button variant="outline" className="justify-between" onClick={onResetStuck} disabled={busy}>
          Stuck Steps reset
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        </Button>
      </CardContent>
    </Card>
  );
}

function BuildPackageCard({ pkg }: { pkg: PipelinePackage }) {
  const stepStatuses = (pkg.step_status_json || {}) as Record<string, string>;
  const { progress, currentLabel, isActive, isFanoutActive, doneCount, total } = deriveStepProgress(stepStatuses);
  const oral = getStepOk(stepStatuses, 'generate_oral_exam', 'validate_oral_exam');
  const tutor = getStepOk(stepStatuses, 'build_ai_tutor_index', 'validate_tutor_index');
  const handbook = getStepOk(stepStatuses, 'generate_handbook', 'validate_handbook');
  const hasFailed = Object.values(stepStatuses).some((s) => s === 'failed');
  const track = (pkg as any).track || 'AUSBILDUNG_VOLL';
  const isFullTrack = track === 'AUSBILDUNG_VOLL';

  // Fanout-aware label: use content_meta when child jobs are running
  const cm = pkg.content_meta;
  const fanoutLabel = isFanoutActive && cm
    ? cm.generated != null && cm.remaining != null
      ? `${cm.generated}/${cm.generated + cm.remaining} Lektionen`
      : cm.active_lesson_jobs != null && cm.active_lesson_jobs > 0
        ? `${cm.active_lesson_jobs} Jobs aktiv`
        : null
    : null;
  const displayLabel = fanoutLabel || currentLabel;

  return (
    <Link
      to={`/admin/studio/${pkg.id}`}
      className={cn(
        'rounded-2xl border p-4 block transition-all hover:ring-2 hover:ring-primary/30 hover:scale-[1.01] cursor-pointer',
        hasFailed && 'border-destructive/30 bg-destructive/5',
        isActive && 'border-primary/30 bg-primary/5',
        !hasFailed && !isActive && 'border-border/70 bg-card/50',
      )}
      role="button"
      tabIndex={0}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{pkg.name}</span>
            <Badge variant="outline" className={cn(
              'text-[9px] px-1 py-0 shrink-0',
              isFullTrack ? 'bg-primary/10 text-primary border-primary/30' : 'bg-accent/20 text-accent-foreground border-accent/40'
            )}>
              {isFullTrack ? 'Voll' : 'Exam'}
            </Badge>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={isFanoutActive ? 'text-primary font-medium' : ''}>{displayLabel}</span>
            <span className="text-muted-foreground/50">·</span>
            <span>{doneCount}/{total} Steps</span>
          </div>
        </div>
        <Badge variant={isActive ? 'default' : 'outline'}>{progress}%</Badge>
      </div>

      {/* Content generation progress indicator */}
      {pkg.content_meta && (pkg.content_meta.remaining != null || pkg.content_meta.generated != null || pkg.content_meta.needs_regen != null) && (
        <div className="mb-2 space-y-0.5">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary/70" />
            <span>Content:</span>
            {pkg.content_meta.generated != null && pkg.content_meta.remaining != null ? (
              <span className="font-medium text-foreground">
                {pkg.content_meta.generated}/{pkg.content_meta.generated + pkg.content_meta.remaining} Lektionen
              </span>
            ) : pkg.content_meta.needs_regen != null ? (
              <span className="text-yellow-500 font-medium">{pkg.content_meta.needs_regen} offen</span>
            ) : pkg.content_meta.remaining != null ? (
              <span className="text-yellow-500 font-medium">{pkg.content_meta.remaining} verbleibend</span>
            ) : null}
            {pkg.content_meta.active_lesson_jobs != null && pkg.content_meta.active_lesson_jobs > 0 && (
              <span className="text-primary/70">· {pkg.content_meta.active_lesson_jobs} Jobs</span>
            )}
          </div>
          {pkg.content_meta.dispatch_blocked_reason && (
            <div className="flex items-center gap-1 text-[10px] text-yellow-600 dark:text-yellow-400">
              <Clock3 className="h-2.5 w-2.5" />
              <span>{pkg.content_meta.dispatch_blocked_reason.replace(/_/g, ' ')}</span>
            </div>
          )}
        </div>
      )}

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
    </Link>
  );
}

export default function Leitstelle() {
  const { packages, kpis, transientOps, loading, lastRefresh, refetch } = useCommandData();
  const [focus, setFocus] = useState<FocusMode>('priorities');
  const [sheet, setSheet] = useState<'bottlenecks' | 'packages' | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: string; payload?: Record<string, unknown>; label?: string } | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['leitstelle-failed-jobs-live'] }),
      qc.invalidateQueries({ queryKey: ['leitstelle-stuck-live'] }),
      qc.invalidateQueries({ queryKey: ['leitstelle-zombies-live'] }),
      qc.invalidateQueries({ queryKey: ['leitstelle-liveness-live'] }),
      qc.invalidateQueries({ queryKey: ['leitstelle-recent-actions'] }),
      qc.invalidateQueries({ queryKey: ['leitstelle-root-causes'] }),
      qc.invalidateQueries({ queryKey: ['command-data'] }),
    ]);
    refetch();
  };

  const onMutationError = (err: Error) => {
    toast({ title: 'Aktion fehlgeschlagen', description: err.message || 'Unbekannter Fehler', variant: 'destructive' });
  };

  const scopedMutation = useMutation({
    mutationFn: (args: { action: string; payload?: Record<string, unknown> }) =>
      runAdminOpsAction(args.action as any, args.payload),
    onSuccess: async (res: any, vars) => {
      const labels: Record<string, string> = {
        requeue_failed_jobs: 'Jobs neu eingeplant',
        release_provider_cooldowns: 'Cooldowns freigegeben',
        reset_stalled_steps: 'Steps zurückgesetzt',
        cancel_zombie_packages: 'Pakete blockiert',
      };
      toast({
        title: labels[vars.action] || vars.action,
        description: `${res?.updated ?? 0} betroffen${res?.scope ? ` (${res.scope})` : ''}.`,
      });
      await invalidateAll();
    },
    onError: onMutationError,
  });

  const doAction = (type: string, payload?: Record<string, unknown>) => {
    scopedMutation.mutate({ action: type, payload });
  };

  const confirmLabels: Record<string, { title: string; desc: string }> = {
    cancel_zombie_packages: { title: 'Zombie-Pakete blockieren?', desc: 'Betroffene Pakete werden auf "blocked" gesetzt.' },
    requeue_failed_jobs: { title: 'Failed Jobs requeue?', desc: 'Fehlgeschlagene Jobs werden auf "pending" zurückgesetzt.' },
    reset_stalled_steps: { title: 'Stuck Steps zurücksetzen?', desc: 'Hängende Pipeline-Steps werden auf "queued" zurückgesetzt.' },
    cancel_zombie_single: { title: 'Dieses Paket blockieren?', desc: 'Nur dieses einzelne Paket wird auf "blocked" gesetzt.' },
    reset_step_single: { title: 'Diesen Step zurücksetzen?', desc: 'Nur dieser einzelne Step wird auf "queued" zurückgesetzt.' },
    requeue_single: { title: 'Diesen Job requeue?', desc: 'Nur dieser einzelne Job wird auf "pending" zurückgesetzt.' },
  };

  const executeConfirmedAction = () => {
    if (!confirmAction) return;
    const { type, payload } = confirmAction;
    const actionMap: Record<string, string> = {
      cancel_zombie_single: 'cancel_zombie_packages',
      reset_step_single: 'reset_stalled_steps',
      requeue_single: 'requeue_failed_jobs',
    };
    doAction(actionMap[type] || type, payload);
    setConfirmAction(null);
  };

  const anyBusy = scopedMutation.isPending;

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

  const { data: livenessRows = [] } = useQuery({
    queryKey: ['leitstelle-liveness-live'],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb
        .from('ops_build_activity_truth')
        .select('package_id, title, status, fresh_active_jobs, zombie_jobs, running_steps, has_lease, liveness_verdict, last_pipeline_event_at, last_step_transition_at')
        .limit(100);
      if (error) return [] as JsonRow[];
      return (data ?? []) as JsonRow[];
    },
    refetchInterval: 30000,
    staleTime: 10000,
  });

  const { data: recentActions = [] } = useQuery({
    queryKey: ['leitstelle-recent-actions'],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb
        .from('admin_actions')
        .select('id, action, payload, user_id, created_at')
        .order('created_at', { ascending: false })
        .limit(8);
      if (error) return [] as JsonRow[];
      return (data ?? []) as JsonRow[];
    },
    refetchInterval: 15000,
    staleTime: 5000,
  });

  const packageById = useMemo(() => {
    const m = new Map<string, PipelinePackage>();
    for (const p of packages || []) {
      if (p?.id) m.set(String(p.id), p);
    }
    return m;
  }, [packages]);

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
        jobId: row.id ? String(row.id) : null,
        stepKey: extractStepKeyFromDetail(errorText),
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
        stepKey: row.step_key ? String(row.step_key) : null,
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

    const transientAlert: AlertItem[] =
      transientOps && transientOps.exhausted24h >= 5
        ? [
            {
              id: 'transient-exhaustion',
              kind: transientOps.exhausted24h >= 10 ? 'critical' : 'warning',
              title: `${transientOps.exhausted24h} transient erschöpfte Jobs (24h)`,
              detail: transientOps.exhaustedByJobType.slice(0, 3).map(r => `${r.job_type}: ${r.cnt}`).join(', '),
              ageMin: 0,
              source: 'ops',
            },
          ]
        : [];

    const raw = [...runnerIdleAlert, ...transientAlert, ...fromFailed, ...fromStuck];

    // Smart filtering: remove stale/resolved STEP_EXHAUSTED alerts
    return raw
      .filter((a) => {
        // 1) Only fresh alerts
        if (a.ageMin > LIVE_ALERT_MAX_AGE_MIN) return false;

        const combined = `${a.title} ${a.detail}`;

        // 2) Smart STEP_EXHAUSTED filtering
        if (combined.includes('STEP_EXHAUSTED')) {
          const pkgId = a.packageId || extractPkgIdFromDetail(a.detail);
          const stepKey = a.stepKey || extractStepKeyFromDetail(a.detail);

          if (pkgId && stepKey) {
            const pkg = packageById.get(pkgId);
            if (pkg) {
              const stepStatuses = (pkg.step_status_json || {}) as Record<string, string>;
              const current = stepStatuses[stepKey];
              // Step already progressed past the problem → hide alert
              if (!isStepStillProblematic(current)) return false;
            }
          } else {
            // Can't resolve context → only show very fresh ones
            if (a.ageMin > 60) return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const prio = { critical: 3, warning: 2, info: 1 };
        return prio[b.kind] - prio[a.kind] || a.ageMin - b.ageMin;
      })
      .slice(0, 8);
  }, [failedJobs, stuckRows, kpis, transientOps, packageById]);

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
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="priorities">Prioritäten</TabsTrigger>
          <TabsTrigger value="build">Build</TabsTrigger>
          <TabsTrigger value="bottlenecks">Bottlenecks</TabsTrigger>
          <TabsTrigger value="policies">Auto-Heal</TabsTrigger>
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
            onRequeueFailed={() => setConfirmAction({ type: 'requeue_failed_jobs', payload: { limit: 20 } })}
            onReleaseCooldowns={() => doAction('release_provider_cooldowns')}
            onResetStuck={() => setConfirmAction({ type: 'reset_stalled_steps', payload: { limit: 20 } })}
            busy={anyBusy}
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
          <CardContent className="grid gap-3 md:grid-cols-4">
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
            {/* ── Liveness Verdict Card ── */}
            {(() => {
              const alive = livenessRows.filter((r: any) => r.liveness_verdict === 'alive').length;
              const falseActive = livenessRows.filter((r: any) => r.liveness_verdict === 'false_active').length;
              const noActivity = livenessRows.filter((r: any) => r.liveness_verdict === 'no_activity').length;
              const hasProblem = falseActive > 0 || noActivity > 0;
              return (
                <div className={cn(
                  'rounded-xl border p-4',
                  hasProblem ? 'border-amber-400/40 bg-amber-50/5' : 'border-border',
                )}>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Server className={cn('h-4 w-4', hasProblem ? 'text-amber-500' : 'text-emerald-500')} />
                    Liveness
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold text-emerald-600 dark:text-emerald-400">{alive}</span>
                    {falseActive > 0 && <span className="text-lg font-medium text-destructive">/ {falseActive} ghost</span>}
                    {noActivity > 0 && <span className="text-lg font-medium text-muted-foreground">/ {noActivity} idle</span>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {hasProblem
                      ? `${falseActive} False-Active, ${noActivity} ohne Aktivität`
                      : 'Alle Building-Pakete haben echte Arbeit'}
                  </div>
                </div>
              );
            })()}
          </CardContent>

          {/* Transient Ops Health Monitor */}
          {transientOps && (
            <CardContent className="grid gap-3 border-t border-border/50 pt-4 md:grid-cols-2">
              {/* Transient Exhaustion Card */}
              <div className={cn(
                'rounded-xl border p-4',
                transientOps.exhausted24h >= 10
                  ? 'border-destructive/40 bg-destructive/5'
                  : 'border-border',
              )}>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <ShieldAlert className={cn('h-4 w-4', transientOps.exhausted24h >= 10 ? 'text-destructive' : 'text-muted-foreground')} />
                  Transient Exhaustion (24h)
                </div>
                <div className={cn('text-3xl font-semibold', transientOps.exhausted24h >= 10 && 'text-destructive')}>
                  {transientOps.exhausted24h}
                </div>
                <div className="mt-3 space-y-1 text-sm">
                  {transientOps.exhaustedByJobType.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Keine erschöpften transienten Jobs</div>
                  ) : (
                    transientOps.exhaustedByJobType.slice(0, 5).map((row) => (
                      <div key={row.job_type} className="flex items-center justify-between text-xs">
                        <span className="truncate text-muted-foreground">{row.job_type.replace(/_/g, ' ')}</span>
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{row.cnt}</Badge>
                      </div>
                    ))
                  )}
                </div>
                {transientOps.exhausted24h >= 10 && (
                  <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    ⚠️ Viele transient erschöpfte Jobs. Provider-Stabilität und Timeouts prüfen.
                  </div>
                )}
              </div>

              {/* Provider Cooldowns Card */}
              <div className={cn(
                'rounded-xl border p-4',
                transientOps.activeCooldowns.length > 3
                  ? 'border-amber-400/40 bg-amber-50/5'
                  : 'border-border',
              )}>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Clock3 className={cn('h-4 w-4', transientOps.activeCooldowns.length > 0 ? 'text-amber-500' : 'text-muted-foreground')} />
                  Provider Cooldowns
                </div>
                <div className={cn('text-3xl font-semibold', transientOps.activeCooldowns.length > 3 && 'text-amber-500')}>
                  {transientOps.activeCooldowns.length}
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  {transientOps.activeCooldowns.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Keine aktiven Cooldowns</div>
                  ) : (
                    transientOps.activeCooldowns.slice(0, 5).map((cd) => (
                      <div key={`${cd.provider}:${cd.model}`} className="rounded-lg border border-border/60 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">{cd.provider} · {cd.model}</span>
                          <span className="text-[10px] text-muted-foreground">
                            bis {new Date(cd.until_at).toLocaleTimeString('de-DE')}
                          </span>
                        </div>
                        {cd.reason && (
                          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{cd.reason}</div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {focus === 'policies' && <PolicyCenter />}

      {/* Root Cause Panel */}
      <RootCausePanel />

      {/* Action Result Panel */}
      {recentActions.length > 0 && (
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span>Letzte Admin-Eingriffe</span>
              <Badge variant="outline" className="text-[11px]">{recentActions.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentActions.map((row: JsonRow, i: number) => {
              const payload = (row.payload || {}) as Record<string, unknown>;
              const updated = typeof payload.result === 'object' && payload.result !== null
                ? (payload.result as Record<string, unknown>).updated
                : undefined;
              const actionLabels: Record<string, string> = {
                requeue_failed_jobs: 'Requeue Failed Jobs',
                release_provider_cooldowns: 'Cooldowns freigegeben',
                reset_stalled_steps: 'Stuck Steps reset',
                cancel_zombie_packages: 'Zombies blockiert',
              };
              const label = actionLabels[String(row.action)] || String(row.action);
              const ts = row.created_at ? new Date(String(row.created_at)) : null;
              return (
                <div key={String(row.id ?? i)} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="font-medium">{label}</span>
                    {typeof updated === 'number' && (
                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{updated} betroffen</Badge>
                    )}
                  </div>
                  {ts && (
                    <span className="text-xs text-muted-foreground">{ts.toLocaleTimeString('de-DE')}</span>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Sheet open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
        <SheetContent side="right" className="w-[96vw] sm:w-[560px]">
          <SheetHeader>
            <SheetTitle>{sheet === 'bottlenecks' ? 'Bottlenecks & Live-Probleme' : 'Build-Pakete'}</SheetTitle>
          </SheetHeader>

          {sheet === 'bottlenecks' ? (
            <div className="mt-4 space-y-4">
              {/* Failed Jobs with inline requeue */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">Failed Jobs (90 Min)</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmAction({ type: 'requeue_failed_jobs', payload: { limit: 20 } })}
                    disabled={anyBusy}
                  >
                    Alle requeue
                  </Button>
                </div>
                <div className="space-y-2">
                  {failedJobs.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Keine Failed Jobs.</div>
                  ) : (
                    failedJobs.slice(0, 15).map((row, i) => (
                      <div key={`fj-${row.id ?? i}`} className="rounded-xl border border-border p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium font-mono truncate">{String(row.job_type || 'Job')}</div>
                            <div className="mt-1 text-xs text-destructive truncate">{String(row.last_error || '–').slice(0, 100)}</div>
                          </div>
                          {row.id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0 h-7 px-2 text-[11px]"
                              onClick={() => setConfirmAction({ type: 'requeue_single', payload: { job_ids: [String(row.id)] } })}
                              disabled={anyBusy}
                            >
                              <RotateCcw className="mr-1 h-3 w-3" /> Retry
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Stuck Steps with inline reset */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">Stuck Steps</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmAction({ type: 'reset_stalled_steps', payload: { limit: 20 } })}
                    disabled={anyBusy}
                  >
                    Alle resetten
                  </Button>
                </div>
                <div className="space-y-2">
                  {stuckRows.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Keine stuck Steps.</div>
                  ) : (
                    stuckRows.map((row, i) => (
                      <div key={`stuck-${row.package_id ?? i}`} className="rounded-xl border border-border p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium font-mono truncate">{String(row.step_key || '–')}</div>
                            <div className="mt-1 text-xs text-muted-foreground truncate">
                              {String(row.package_id || '–').slice(0, 8)} · {String(row.reason || '–')}
                            </div>
                          </div>
                          {row.package_id && row.step_key && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0 h-7 px-2 text-[11px]"
                              onClick={() => setConfirmAction({ type: 'reset_step_single', payload: { package_id: String(row.package_id), step_key: String(row.step_key) } })}
                              disabled={anyBusy}
                            >
                              <RotateCcw className="mr-1 h-3 w-3" /> Reset
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">Zombie-Pakete</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmAction({ type: 'cancel_zombie_packages', payload: { limit: 20 } })}
                    disabled={anyBusy}
                  >
                    {anyBusy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                    Alle blockieren
                  </Button>
                </div>
                <div className="space-y-2">
                  {zombieRows.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Keine Zombies gefunden.</div>
                  ) : (
                    zombieRows.map((row, i) => (
                      <div key={`zombie-${row.package_id ?? i}`} className="rounded-xl border border-border p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{String(row.title || row.package_id || `Paket ${i + 1}`)}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Step: {String(row.current_step || '–')} · Status: {String(row.status || '–')}
                            </div>
                          </div>
                          {row.package_id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0 h-7 px-2 text-[11px]"
                              onClick={() => setConfirmAction({ type: 'cancel_zombie_single', payload: { package_id: String(row.package_id) } })}
                              disabled={anyBusy}
                            >
                              <Ban className="mr-1 h-3 w-3" /> Block
                            </Button>
                          )}
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

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              {confirmAction ? confirmLabels[confirmAction.type]?.title : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction ? confirmLabels[confirmAction.type]?.desc : ''}
              {confirmAction?.label ? ` (${confirmAction.label})` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={executeConfirmedAction}>Ja, ausführen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}