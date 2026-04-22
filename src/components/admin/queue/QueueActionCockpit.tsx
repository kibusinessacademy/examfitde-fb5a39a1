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
  Loader2, ChevronRight, CheckCircle2, Zap,
} from 'lucide-react';

type RiskLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH';

interface RecommendedAction {
  action_key: string;
  priority: number;
  risk_level: RiskLevel;
  cluster: string;
  job_count: number;
  affected_packages: number;
  title: string;
  description: string;
  recommended_strategy: string;
  is_safe: boolean;
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
}

const RISK_META: Record<RiskLevel, { label: string; icon: typeof Shield; cls: string; ring: string }> = {
  SAFE:   { label: 'SAFE',   icon: ShieldCheck, cls: 'bg-success/10 text-success border-success/30',     ring: 'ring-success/40' },
  LOW:    { label: 'LOW',    icon: Shield,      cls: 'bg-primary/10 text-primary border-primary/30',     ring: 'ring-primary/40' },
  MEDIUM: { label: 'MEDIUM', icon: Shield,      cls: 'bg-warning/10 text-warning border-warning/30',     ring: 'ring-warning/40' },
  HIGH:   { label: 'HIGH',   icon: ShieldAlert, cls: 'bg-destructive/10 text-destructive border-destructive/30', ring: 'ring-destructive/40' },
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
    mutationFn: async (action: RecommendedAction) => {
      const { data, error } = await supabase.rpc('admin_execute_recommended_action' as any, {
        _action_key: action.action_key,
        _max_jobs: 50,
      });
      if (error) throw error;
      return data as { ok: boolean; cluster: string; healed: number };
    },
    onSuccess: (res, action) => {
      toast({
        title: res.ok ? 'Heilung gestartet' : 'Aktion fehlgeschlagen',
        description: res.ok
          ? `${res.healed ?? 0} Job(s) im Cluster ${res.cluster} verarbeitet.`
          : `Aktion ${action.action_key} konnte nicht ausgeführt werden.`,
        variant: res.ok ? 'default' : 'destructive',
      });
      qc.invalidateQueries({ queryKey: ['queue-health-score'] });
      qc.invalidateQueries({ queryKey: ['queue-recommended-actions'] });
      qc.invalidateQueries({ queryKey: ['queue-health'] });
      qc.invalidateQueries({ queryKey: ['queue-counts'] });
    },
    onError: (e: Error) => {
      toast({ title: 'Fehler', description: e.message, variant: 'destructive' });
    },
    onSettled: () => setConfirmAction(null),
  });

  const score = health.data?.score ?? null;
  const status = health.data?.status ?? 'attention';
  const statusMeta = STATUS_META[status];
  const recommended = useMemo(() => actions.data ?? [], [actions.data]);
  const topAction = recommended[0];

  return (
    <div className="space-y-3">
      {/* === KONTEXT-HEADER (kompakt, nicht dominant) === */}
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
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Queue Health
                </div>
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

      {/* === EMPFOHLENE AKTIONEN (Primary Interface) === */}
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
              {recommended.length} {recommended.length === 1 ? 'Cluster' : 'Cluster'}
            </span>
          </div>

          {actions.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
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
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <div className="flex shrink-0 items-center gap-1 mt-0.5">
                      <span className="text-[10px] font-bold text-muted-foreground tabular-nums w-4">
                        {idx + 1}.
                      </span>
                      <Icon className={cn('h-3.5 w-3.5', meta.cls.split(' ')[1])} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-foreground">{a.title}</span>
                        <Badge
                          variant="outline"
                          className={cn('h-4 px-1.5 text-[9px] font-bold border', meta.cls)}
                        >
                          {meta.label}
                        </Badge>
                        {isPrimary && (
                          <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-primary/40 text-primary bg-primary/10">
                            <Zap className="h-2 w-2 mr-0.5" />
                            Empfohlen
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
                        {a.description}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-[9px] text-muted-foreground">
                        <span className="font-mono">{a.cluster}</span>
                        <span>·</span>
                        <span>{a.job_count} Job{a.job_count !== 1 && 's'}</span>
                        {a.affected_packages > 0 && (
                          <>
                            <span>·</span>
                            <span>{a.affected_packages} Paket{a.affected_packages !== 1 && 'e'}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-end">
                  {isManual ? (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Manueller Review nötig
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant={isPrimary ? 'default' : 'outline'}
                      disabled={execute.isPending}
                      onClick={() => {
                        if (a.is_safe) {
                          // 1-Klick: direkt ausführen
                          setConfirmAction(a);
                          execute.mutate(a);
                        } else {
                          // Bestätigung nötig
                          setConfirmAction(a);
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
                      {a.is_safe ? '1-Klick heilen' : 'Mit Bestätigung'}
                      <ChevronRight className="h-3 w-3 ml-0.5" />
                    </Button>
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
            <AlertDialogDescription className="space-y-2 text-xs">
              <span className="block">{confirmAction?.description}</span>
              <span className="block rounded-md border border-warning/30 bg-warning/5 p-2 text-warning">
                <strong>Risiko-Level: {confirmAction?.risk_level}</strong>
                <br />
                Strategie: <code className="text-[10px]">{confirmAction?.recommended_strategy}</code>
                <br />
                Betrifft: {confirmAction?.job_count} Job(s) in {confirmAction?.affected_packages} Paket(en).
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmAction(null)}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAction && execute.mutate(confirmAction)}
              className="bg-warning hover:bg-warning/90 text-warning-foreground"
            >
              Trotzdem ausführen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default QueueActionCockpit;
