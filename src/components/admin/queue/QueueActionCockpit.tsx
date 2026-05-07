import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Activity, AlertTriangle, ShieldCheck, Shield, ShieldAlert, Sparkles,
  Loader2, ChevronRight, CheckCircle2, Zap, Eye,
} from 'lucide-react';
import { QueueValidationWarnings } from './QueueValidationWarnings';
import { QueueHealthcheckBanner } from './QueueHealthcheckBanner';
import { parseHealError } from './healErrorParser';
import { useRealtimeQueueRefresh } from '@/hooks/useRealtimeQueueRefresh';
import { RefreshCw, Radio } from 'lucide-react';

type RiskLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH';

interface HealthcheckResponse {
  status: 'ok' | 'warn' | 'fail' | string;
  view_clusters?: string[];
  heal_clusters?: string[];
}

interface RecommendedAction {
  action_key: string;
  cluster: string;
  priority: number;
  risk_level: RiskLevel;
  is_safe: boolean;
  /** Server-Whitelist-Flag aus heal_action_registry (Phase 1). */
  is_executable?: boolean;
  job_count: number;
  package_count: number;
  title: string;
  description: string;
  recommended_strategy: string;
  why_recommended: string;
  oldest_job_at: string | null;
}

interface HealthScore {
  score: number;
  status: 'healthy' | 'attention' | 'degraded' | 'critical';
  failed: number;
  processing: number;
  pending: number;
  total_active: number;
  critical_clusters: number;
  terminal_count: number;
  weighted_breakdown?: {
    hard_fail_clusters: number;
    stale_lock: number;
    transient: number;
    structural: number;
    requeue_loop: number;
    terminal: number;
    backlog_pressure: number;
  };
}

interface ExecuteResult {
  ok: boolean;
  action_key: string;
  cluster: string;
  dry_run: boolean;
  result: {
    ok: boolean;
    cluster: string;
    dry_run: boolean;
    processed: number;
    skipped: number;
    errors: number;
    details: Array<{ job_id: string; action: string; strategy?: string; reason?: string }>;
  };
}

const RISK_META: Record<RiskLevel, { label: string; icon: typeof Shield; cls: string; iconCls: string }> = {
  SAFE:   { label: 'SAFE',   icon: ShieldCheck, cls: 'bg-success-bg-subtle text-success border-success/30',     iconCls: 'text-success' },
  LOW:    { label: 'LOW',    icon: Shield,      cls: 'bg-primary/10 text-primary border-primary/30',     iconCls: 'text-primary' },
  MEDIUM: { label: 'MEDIUM', icon: Shield,      cls: 'bg-warning-bg-subtle text-warning border-warning/30',     iconCls: 'text-warning' },
  HIGH:   { label: 'HIGH',   icon: ShieldAlert, cls: 'bg-destructive-bg-subtle text-destructive border-destructive/30', iconCls: 'text-destructive' },
};

const STATUS_META: Record<HealthScore['status'], { label: string; cls: string; dot: string }> = {
  healthy:   { label: 'Stabil',         cls: 'text-success',     dot: 'bg-success' },
  attention: { label: 'Aufmerksamkeit', cls: 'text-primary',     dot: 'bg-primary' },
  degraded:  { label: 'Verschlechtert', cls: 'text-warning',     dot: 'bg-warning' },
  critical:  { label: 'Kritisch',       cls: 'text-destructive', dot: 'bg-destructive animate-pulse' },
};

export function QueueActionCockpit() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirmAction, setConfirmAction] = useState<RecommendedAction | null>(null);
  const [safeConfirm, setSafeConfirm] = useState<RecommendedAction | null>(null);
  const [dryRunResult, setDryRunResult] = useState<ExecuteResult | null>(null);

  // Live-Refresh (Realtime auf job_queue) verhindert Phantom-Cluster
  // wie UNCLASSIFIED_EMPTY, die durch veraltete React-Query-Caches entstehen.
  useRealtimeQueueRefresh();

  // Live-Indikator: Repair-Jobs aktuell in processing/running.
  // Solange welche laufen, blockieren wir den Heal-Button (verhindert Doppelläufe & Race-Conditions).
  const activeRepairs = useQuery({
    queryKey: ['active-repair-jobs'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('job_queue')
        .select('id', { count: 'exact', head: true })
        .in('status', ['processing', 'running'])
        .like('job_type', 'package_repair_%');
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 5_000,
  });
  const hasActiveRepair = (activeRepairs.data ?? 0) > 0;

  const health = useQuery({
    queryKey: ['queue-health-score'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_queue_health_score' as any);
      if (error) throw error;
      return data as unknown as HealthScore;
    },
    refetchInterval: 15_000,
  });

  // SSOT: Erlaubte Cluster aus dem Backend-Healthcheck holen.
  // Wir rendern NUR Aktionen, deren Cluster die View tatsächlich liefert
  // UND die fn_auto_heal_cluster handhabt — keine hartcodierten Enums.
  const healthcheck = useQuery({
    queryKey: ['queue-system-healthcheck-allowed-clusters'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_queue_system_healthcheck' as any);
      if (error) throw error;
      return data as unknown as HealthcheckResponse;
    },
    refetchInterval: 60_000,
    retry: 1,
  });

  const allowedClusters = useMemo(() => {
    const view = new Set(healthcheck.data?.view_clusters ?? []);
    const heal = new Set(healthcheck.data?.heal_clusters ?? []);
    const intersection = new Set<string>();
    view.forEach((c) => { if (heal.has(c)) intersection.add(c); });
    return intersection;
  }, [healthcheck.data]);

  const actions = useQuery({
    queryKey: ['queue-recommended-actions'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_recommend_queue_actions' as any);
      if (error) throw error;
      return (data ?? []) as unknown as RecommendedAction[];
    },
    refetchInterval: 20_000,
  });

  const execute = useMutation({
    mutationFn: async ({ action, dryRun }: { action: RecommendedAction; dryRun: boolean }) => {
      const { data, error } = await supabase.rpc('admin_execute_recommended_action' as any, {
        _action_key: action.action_key,
        _max_jobs: 50,
        _dry_run: dryRun,
      });
      if (error) throw error;
      return { ...(data as ExecuteResult), _dryRun: dryRun };
    },
    onSuccess: (res, vars) => {
      if (vars.dryRun) {
        setDryRunResult(res as ExecuteResult);
        return;
      }
      const r = res.result ?? ({} as any);
      const toCount = (v: unknown): number => {
        if (typeof v === 'number') return v;
        if (Array.isArray(v)) return v.length;
        if (v && typeof v === 'object') return Object.keys(v as object).length;
        return 0;
      };
      const processedCount = toCount(r.processed);
      const skippedCount = toCount(r.skipped);
      const errorCount = toCount(r.errors);

      // Wenn die RPC zwar HTTP-200 lieferte, aber Jobs Fehler hatten,
      // zeigen wir die parsed-Diagnose statt einer nichtssagenden „0/Fehler"-Meldung.
      if (errorCount > 0 || (!res.ok && processedCount === 0)) {
        const parsed = parseHealError({ result: r });
        toast({
          title: parsed.title,
          description:
            parsed.description +
            (parsed.details && parsed.details.length > 0
              ? `\n• ${parsed.details.slice(0, 3).join('\n• ')}`
              : ''),
          variant: 'destructive',
        });
      } else {
        toast({
          title: res.ok ? 'Heilung ausgeführt' : 'Aktion fehlgeschlagen',
          description: res.ok
            ? `Cluster ${res.cluster}: ${processedCount} verarbeitet, ${skippedCount} übersprungen, ${errorCount} Fehler.`
            : `Aktion ${vars.action.action_key} konnte nicht ausgeführt werden.`,
          variant: res.ok ? 'default' : 'destructive',
        });
      }
      qc.invalidateQueries({ queryKey: ['queue-health-score'] });
      qc.invalidateQueries({ queryKey: ['queue-recommended-actions'] });
      qc.invalidateQueries({ queryKey: ['queue-health'] });
      qc.invalidateQueries({ queryKey: ['queue-counts'] });
      qc.invalidateQueries({ queryKey: ['active-repair-jobs'] });
      setConfirmAction(null);
      setSafeConfirm(null);
    },
    onError: (e: Error) => {
      const parsed = parseHealError(e);
      toast({
        title: parsed.title,
        description: parsed.description,
        variant: 'destructive',
      });
    },
  });

  const score = health.data?.score ?? null;
  const status = health.data?.status ?? 'attention';
  const statusMeta = STATUS_META[status];
  const allActions = useMemo(() => actions.data ?? [], [actions.data]);
  // SSOT-Filter: nur Aktionen für Cluster, die View ∩ fn_auto_heal_cluster wirklich kennt.
  // Solange Healthcheck nicht geladen ist, alles zeigen (kein false-negative blocking).
  // Phantom-Schutz: Aktionen mit job_count<=0 werden ausgefiltert (vermeidet
  // veraltete UI nach Heal-Aktionen, falls Realtime/Refetch noch nicht durchschlug).
  const recommended = useMemo(() => {
    const live = allActions.filter((a) => (a.job_count ?? 0) > 0);
    if (allowedClusters.size === 0) return live;
    return live.filter((a) => allowedClusters.has(a.cluster));
  }, [allActions, allowedClusters]);
  const hiddenByGuard = allActions.filter((a) => (a.job_count ?? 0) > 0).length - recommended.length;
  const phantomFiltered = allActions.length - allActions.filter((a) => (a.job_count ?? 0) > 0).length;

  return (
    <div className="space-y-3">
      {/* Action-First Reihenfolge:
          1. Health-Header · 2. Empfohlene Aktionen · 3. Validation+System-Health-Warnings */}

      {/* === KONTEXT-HEADER === */}
      <Card className="border-border bg-gradient-to-br from-card to-muted/20">
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card">
                {health.isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Activity className={cn('h-4 w-4', statusMeta.cls)} />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className={cn('text-2xl font-bold tabular-nums', statusMeta.cls)}>
                    {score ?? '–'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">/100</span>
                  <Badge variant="outline" className={cn('ml-1 h-4 px-1.5 text-[9px] font-semibold', statusMeta.cls)}>
                    <span className={cn('mr-1 h-1.5 w-1.5 rounded-full', statusMeta.dot)} />
                    {statusMeta.label}
                  </Badge>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Queue Health</div>
              </div>
            </div>
            {health.data && (
              <div className="flex items-center gap-3 text-[10px]">
                <div className="text-center">
                  <div className="text-sm font-bold text-destructive">{health.data.failed}</div>
                  <div className="text-muted-foreground">failed</div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-bold text-primary">{health.data.processing}</div>
                  <div className="text-muted-foreground">aktiv</div>
                </div>
                {health.data.critical_clusters > 0 && (
                  <div className="text-center">
                    <div className="text-sm font-bold text-warning">{health.data.critical_clusters}</div>
                    <div className="text-muted-foreground">krit. Cluster</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* === LIVE-LOCK HINWEIS === */}
      {hasActiveRepair && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-bg-subtle px-3 py-2 text-[11px] text-warning">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>
            <strong>{activeRepairs.data}</strong> Repair-Job{(activeRepairs.data ?? 0) !== 1 && 's'} läuft gerade —
            Heal-Aktionen sind blockiert, bis die laufenden Reparaturen abgeschlossen sind.
          </span>
        </div>
      )}

      {/* === EMPFOHLENE AKTIONEN === */}
      <Card className="border-primary/30 bg-card">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
                Empfohlene Aktionen
              </h3>
              <span
                className="inline-flex items-center gap-1 text-[9px] text-success"
                title="Live-Refresh aktiv (Realtime auf job_queue)"
              >
                <Radio className="h-2.5 w-2.5 animate-pulse" />
                LIVE
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
              <span>{recommended.length} Cluster</span>
              {hiddenByGuard > 0 && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-warning/40 text-warning">
                  {hiddenByGuard} ausgeblendet (SSOT-Guard)
                </Badge>
              )}
              {phantomFiltered > 0 && (
                <Badge
                  variant="outline"
                  className="h-4 px-1.5 text-[9px] border-muted text-muted-foreground"
                  title="Cluster mit job_count=0 wurden als Phantom verworfen"
                >
                  {phantomFiltered} Phantom verworfen
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                title="Sofort neu laden"
                onClick={() => {
                  qc.invalidateQueries({ queryKey: ['queue-recommended-actions'] });
                  qc.invalidateQueries({ queryKey: ['queue-health-score'] });
                  qc.invalidateQueries({ queryKey: ['queue-system-healthcheck-allowed-clusters'] });
                  qc.invalidateQueries({ queryKey: ['active-repair-jobs'] });
                }}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {actions.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}

          {!actions.isLoading && recommended.length === 0 && (
            <div className="flex items-center gap-2 rounded-md border border-success/20 bg-success-bg-subtle p-3 text-xs">
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
              <div>
                <div className="font-semibold text-success">Alles ruhig</div>
                <div className="text-muted-foreground text-[11px]">
                  Keine fehlgeschlagenen Cluster — kein Handlungsbedarf.
                </div>
              </div>
            </div>
          )}

          {recommended.map((a, idx) => {
            const meta = RISK_META[a.risk_level];
            const Icon = meta.icon;
            const isPrimary = idx === 0;
            const isManual = a.recommended_strategy === 'manual_review_required';
            const isExecutingThis = execute.isPending && confirmAction?.action_key === a.action_key;

            return (
              <div
                key={a.cluster + a.action_key}
                className={cn(
                  'rounded-lg border p-2.5 transition-all',
                  isPrimary
                    ? 'border-primary/40 bg-primary/5 shadow-sm'
                    : 'border-border bg-card hover:bg-muted/30'
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="flex shrink-0 items-center gap-1 mt-0.5">
                    <span className="text-[10px] font-bold text-muted-foreground tabular-nums w-4">
                      {idx + 1}.
                    </span>
                    <Icon className={cn('h-3.5 w-3.5', meta.iconCls)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-foreground">{a.title}</span>
                      <Badge variant="outline" className={cn('h-4 px-1.5 text-[9px] font-bold border', meta.cls)}>
                        {meta.label}
                      </Badge>
                      {isPrimary && (
                        <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-primary/40 text-primary bg-primary/10">
                          <Zap className="h-2 w-2 mr-0.5" />
                          Empfohlen
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
                      {a.description}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 text-[9px] text-muted-foreground flex-wrap">
                      <span className="font-mono px-1 py-0.5 rounded bg-muted/50">{a.cluster}</span>
                      <span>·</span>
                      <span><strong className="text-foreground">{a.job_count}</strong> Job{a.job_count !== 1 && 's'}</span>
                      {a.package_count > 0 && (
                        <>
                          <span>·</span>
                          <span><strong className="text-foreground">{a.package_count}</strong> Paket{a.package_count !== 1 && 'e'}</span>
                        </>
                      )}
                      <span>·</span>
                      <span className="font-mono">{a.recommended_strategy}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-end gap-1.5">
                  {isManual ? (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Manueller Review nötig
                    </span>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={execute.isPending || hasActiveRepair}
                        onClick={() => execute.mutate({ action: a, dryRun: true })}
                        className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        Dry Run
                      </Button>
                      <Button
                        size="sm"
                        variant={isPrimary ? 'default' : 'outline'}
                        disabled={execute.isPending || hasActiveRepair}
                        title={
                          hasActiveRepair
                            ? `Blockiert — ${activeRepairs.data} Repair-Job(s) laufen noch`
                            : undefined
                        }
                        onClick={() => {
                          // Beide Pfade verlangen jetzt einen Bestätigungs-Schritt:
                          // SAFE → kurzer Confirm-Dialog (safeConfirm)
                          // MEDIUM/HIGH → Dry-Run-First, dann „Trotzdem ausführen" im Result-Dialog
                          if (a.is_safe) {
                            setSafeConfirm(a);
                          } else {
                            setConfirmAction(a);
                            execute.mutate({ action: a, dryRun: true });
                          }
                        }}
                        className="h-7 px-3 text-[11px] font-semibold"
                      >
                        {isExecutingThis ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                        ) : a.is_safe ? (
                          <Zap className="h-3 w-3 mr-1.5" />
                        ) : (
                          <Eye className="h-3 w-3 mr-1.5" />
                        )}
                        {a.is_safe ? 'Jetzt heilen' : 'Vorschau & Bestätigen'}
                        <ChevronRight className="h-3 w-3 ml-0.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* === VALIDATION + SYSTEM-HEALTH WARNINGS (nach Aktionen, Action-First Layout) === */}
      <QueueValidationWarnings />
      <QueueHealthcheckBanner />

      {/* Bestätigungs-Dialog für nicht-safe Aktionen */}
      <AlertDialog
        open={!!confirmAction && !confirmAction.is_safe && !execute.isPending}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              {confirmAction?.title}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs">
                <p>{confirmAction?.description}</p>
                <div className="rounded-md border border-warning/30 bg-warning-bg-subtle p-2 text-warning space-y-1">
                  <div><strong>Risiko-Level: {confirmAction?.risk_level}</strong></div>
                  <div>Strategie: <code className="text-[10px]">{confirmAction?.recommended_strategy}</code></div>
                  <div>Cluster: <code className="text-[10px]">{confirmAction?.cluster}</code></div>
                  <div>Betrifft: {confirmAction?.job_count} Job(s) in {confirmAction?.package_count} Paket(en)</div>
                </div>
                <p className="text-[10px] text-muted-foreground">{confirmAction?.why_recommended}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmAction(null)}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAction && execute.mutate({ action: confirmAction, dryRun: false })}
              className="bg-warning hover:bg-warning/90 text-warning-foreground"
            >
              Trotzdem ausführen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dry-Run-Ergebnis-Dialog */}
      <AlertDialog open={!!dryRunResult} onOpenChange={(open) => !open && setDryRunResult(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              Dry Run · {dryRunResult?.cluster}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs">
                <p>So würde die Heilung ablaufen — es wurde nichts verändert.</p>
                <div className="rounded-md border border-primary/30 bg-primary/5 p-2 space-y-1 text-foreground">
                  <div>Verarbeitet: <strong>{dryRunResult?.result.processed}</strong></div>
                  <div>Übersprungen: <strong>{dryRunResult?.result.skipped}</strong></div>
                  <div>Fehler: <strong>{dryRunResult?.result.errors}</strong></div>
                </div>
                {dryRunResult?.result.details && dryRunResult.result.details.length > 0 && (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 space-y-1">
                    {dryRunResult.result.details.slice(0, 20).map((d, i) => (
                      <div key={i} className="font-mono text-[10px]">
                        <span className="text-muted-foreground">{d.action}</span>
                        {d.strategy && <span className="text-primary"> → {d.strategy}</span>}
                        {d.reason && <span className="text-warning"> ({d.reason})</span>}
                      </div>
                    ))}
                    {dryRunResult.result.details.length > 20 && (
                      <div className="text-[10px] text-muted-foreground">
                        … +{dryRunResult.result.details.length - 20} weitere
                      </div>
                    )}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDryRunResult(null); setConfirmAction(null); }}>
              Schließen
            </AlertDialogCancel>
            {confirmAction && !confirmAction.is_safe && dryRunResult?.ok && (
              <AlertDialogAction
                onClick={() => {
                  const a = confirmAction;
                  setDryRunResult(null);
                  execute.mutate({ action: a, dryRun: false });
                }}
                className="bg-warning hover:bg-warning/90 text-warning-foreground"
              >
                Trotzdem jetzt ausführen
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* SAFE-Confirm — zweiter Schritt für „Jetzt heilen" auf SAFE-Aktionen.
          Verhindert versehentliche Klicks; blockiert zusätzlich, falls noch Repair-Jobs laufen. */}
      <AlertDialog
        open={!!safeConfirm}
        onOpenChange={(open) => !open && setSafeConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-success" />
              Heilung bestätigen
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs">
                <p>{safeConfirm?.title}</p>
                <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1">
                  <div>Cluster: <code className="text-[10px]">{safeConfirm?.cluster}</code></div>
                  <div>Strategie: <code className="text-[10px]">{safeConfirm?.recommended_strategy}</code></div>
                  <div>Betrifft: {safeConfirm?.job_count} Job(s) in {safeConfirm?.package_count} Paket(en)</div>
                </div>
                {hasActiveRepair && (
                  <div className="rounded-md border border-warning/40 bg-warning-bg-subtle p-2 text-warning">
                    ⚠️ {activeRepairs.data} Repair-Job(s) laufen aktuell — die Aktion ist gesperrt.
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSafeConfirm(null)}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={hasActiveRepair || execute.isPending}
              onClick={() => {
                if (safeConfirm) {
                  const a = safeConfirm;
                  setConfirmAction(a);
                  execute.mutate({ action: a, dryRun: false });
                }
              }}
            >
              Jetzt heilen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default QueueActionCockpit;
