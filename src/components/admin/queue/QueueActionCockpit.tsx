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

type RiskLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH';

interface RecommendedAction {
  action_key: string;
  cluster: string;
  priority: number;
  risk_level: RiskLevel;
  is_safe: boolean;
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
  SAFE:   { label: 'SAFE',   icon: ShieldCheck, cls: 'bg-success/10 text-success border-success/30',     iconCls: 'text-success' },
  LOW:    { label: 'LOW',    icon: Shield,      cls: 'bg-primary/10 text-primary border-primary/30',     iconCls: 'text-primary' },
  MEDIUM: { label: 'MEDIUM', icon: Shield,      cls: 'bg-warning/10 text-warning border-warning/30',     iconCls: 'text-warning' },
  HIGH:   { label: 'HIGH',   icon: ShieldAlert, cls: 'bg-destructive/10 text-destructive border-destructive/30', iconCls: 'text-destructive' },
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
  const [dryRunResult, setDryRunResult] = useState<ExecuteResult | null>(null);

  const health = useQuery({
    queryKey: ['queue-health-score'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_queue_health_score' as any);
      if (error) throw error;
      return data as unknown as HealthScore;
    },
    refetchInterval: 15_000,
  });

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
      const r = res.result;
      toast({
        title: res.ok ? 'Heilung ausgeführt' : 'Aktion fehlgeschlagen',
        description: res.ok
          ? `Cluster ${res.cluster}: ${r.processed} verarbeitet, ${r.skipped} übersprungen, ${r.errors} Fehler.`
          : `Aktion ${vars.action.action_key} konnte nicht ausgeführt werden.`,
        variant: res.ok ? 'default' : 'destructive',
      });
      qc.invalidateQueries({ queryKey: ['queue-health-score'] });
      qc.invalidateQueries({ queryKey: ['queue-recommended-actions'] });
      qc.invalidateQueries({ queryKey: ['queue-health'] });
      qc.invalidateQueries({ queryKey: ['queue-counts'] });
      setConfirmAction(null);
    },
    onError: (e: Error) => {
      toast({ title: 'Fehler', description: e.message, variant: 'destructive' });
    },
  });

  const score = health.data?.score ?? null;
  const status = health.data?.status ?? 'attention';
  const statusMeta = STATUS_META[status];
  const recommended = useMemo(() => actions.data ?? [], [actions.data]);

  return (
    <div className="space-y-3">
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

      {/* === EMPFOHLENE AKTIONEN === */}
      <Card className="border-primary/30 bg-card">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
                Empfohlene Aktionen
              </h3>
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {recommended.length} Cluster
            </span>
          </div>

          {actions.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}

          {!actions.isLoading && recommended.length === 0 && (
            <div className="flex items-center gap-2 rounded-md border border-success/20 bg-success/5 p-3 text-xs">
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
                        disabled={execute.isPending}
                        onClick={() => execute.mutate({ action: a, dryRun: true })}
                        className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        Dry Run
                      </Button>
                      <Button
                        size="sm"
                        variant={isPrimary ? 'default' : 'outline'}
                        disabled={execute.isPending}
                        onClick={() => {
                          setConfirmAction(a);
                          if (a.is_safe) {
                            execute.mutate({ action: a, dryRun: false });
                          }
                        }}
                        className="h-7 px-3 text-[11px] font-semibold"
                      >
                        {isExecutingThis ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                        ) : a.is_safe ? (
                          <Zap className="h-3 w-3 mr-1.5" />
                        ) : (
                          <AlertTriangle className="h-3 w-3 mr-1.5" />
                        )}
                        {a.is_safe ? 'Jetzt heilen' : 'Bestätigen'}
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
                <div className="rounded-md border border-warning/30 bg-warning/5 p-2 text-warning space-y-1">
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
            <AlertDialogCancel onClick={() => setDryRunResult(null)}>Schließen</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default QueueActionCockpit;
