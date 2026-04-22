import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, TrendingDown, RefreshCw, Loader2,
  Bell, History, Activity,
} from 'lucide-react';

interface RootCauseRow {
  error_class: string;
  job_type: string;
  failed_jobs: number;
  affected_packages: number;
  last_run_at: string;
  first_seen_at: string;
  avg_attempts: number;
  max_attempts_seen: number;
  sample_error: string | null;
}

interface TransitionRow {
  id: number;
  job_id: string;
  job_type: string | null;
  package_id: string | null;
  old_status: string | null;
  new_status: string;
  error_class: string | null;
  reason: string | null;
  trigger_source: string;
  attempts: number | null;
  created_at: string;
}

interface HealthAlert {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  created_at: string;
  is_read: boolean;
}

const TERMINAL_CLASSES = new Set([
  'HARD_FAIL_NO_CURRICULUM',
  'HARD_FAIL_NO_BLUEPRINTS',
  'HARD_FAIL_REPAIR_EXHAUSTED',
  'HARD_FAIL_BREAKER',
  'REQUEUE_LOOP_KILLED',
]);

function relTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s`;
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  if (diff < 86400) return `${(diff / 3600).toFixed(1)}h`;
  return `${(diff / 86400).toFixed(1)}d`;
}

function transitionLabel(t: TransitionRow): string {
  const from = t.old_status ?? '—';
  return `${from} → ${t.new_status}`;
}

function severityClass(sev: string): string {
  if (sev === 'critical') return 'bg-destructive/10 text-destructive border-destructive/30';
  if (sev === 'high') return 'bg-warning/10 text-warning border-warning/30';
  return 'bg-muted text-muted-foreground border-border';
}

export function QueueHealthDashboard() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const rootCauses = useQuery({
    queryKey: ['queue-health', 'root-causes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_failed_jobs_root_causes' as any)
        .select('*');
      if (error) throw error;
      return (data ?? []) as unknown as RootCauseRow[];
    },
    refetchInterval: 30_000,
  });

  const transitions = useQuery({
    queryKey: ['queue-health', 'transitions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_status_transitions' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as unknown as TransitionRow[];
    },
    refetchInterval: 20_000,
  });

  const alerts = useQuery({
    queryKey: ['queue-health', 'alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_notifications')
        .select('id, title, body, severity, created_at, is_read')
        .eq('category', 'queue_health')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as HealthAlert[];
    },
    refetchInterval: 30_000,
  });

  const autoRetry = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('fn_auto_retry_failed_jobs' as any, { _limit: 100 });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast({
        title: 'Auto-Retry abgeschlossen',
        description: `${data?.retried ?? 0} Jobs reaktiviert · ${data?.skipped_terminal ?? 0} terminal · ${data?.skipped_duplicate ?? 0} Duplikate.`,
      });
      qc.invalidateQueries({ queryKey: ['queue-health'] });
      qc.invalidateQueries({ queryKey: ['admin', 'ops-queue'] });
    },
    onError: (e: Error) => {
      toast({ title: 'Auto-Retry fehlgeschlagen', description: e.message, variant: 'destructive' });
    },
  });

  const checkHealth = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('fn_check_queue_health_alerts' as any);
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast({
        title: 'Health-Check abgeschlossen',
        description: `Failed: ${data?.failed ?? 0} · Pending: ${data?.pending ?? 0} · Alerts: ${data?.alerts_raised ?? 0}`,
      });
      qc.invalidateQueries({ queryKey: ['queue-health'] });
    },
    onError: (e: Error) => {
      toast({ title: 'Health-Check fehlgeschlagen', description: e.message, variant: 'destructive' });
    },
  });

  const totalFailed = rootCauses.data?.reduce((s, r) => s + r.failed_jobs, 0) ?? 0;
  const openAlerts = alerts.data?.filter((a) => !a.is_read) ?? [];

  return (
    <div className="space-y-3">
      {/* Active alerts */}
      {openAlerts.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Bell className="h-4 w-4 text-destructive" />
              Queue-Health Alerts
              <Badge variant="outline" className="ml-auto text-[10px]">
                {openAlerts.length} offen
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {openAlerts.slice(0, 3).map((a) => (
              <div key={a.id} className={cn('rounded-lg border px-3 py-2 text-xs', severityClass(a.severity))}>
                <div className="font-semibold">{a.title}</div>
                {a.body && <p className="mt-1 opacity-90">{a.body}</p>}
                <div className="mt-1 text-[10px] opacity-70">vor {relTime(a.created_at)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => autoRetry.mutate()}
          disabled={autoRetry.isPending}
        >
          {autoRetry.isPending ? (
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3 w-3" />
          )}
          Auto-Retry ausführen
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => checkHealth.mutate()}
          disabled={checkHealth.isPending}
        >
          {checkHealth.isPending ? (
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
          ) : (
            <Activity className="mr-1.5 h-3 w-3" />
          )}
          Health-Check
        </Button>
      </div>

      {/* Root-cause grouping */}
      <Card className="border-border/70 bg-card/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-destructive" />
              Root Causes (Failed Queue)
            </span>
            <Badge variant="outline" className="text-[10px]">
              {totalFailed} Jobs
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {rootCauses.isLoading && (
            <div className="text-xs text-muted-foreground">Lade…</div>
          )}
          {!rootCauses.isLoading && rootCauses.data?.length === 0 && (
            <div className="text-xs text-success">✅ Keine Failed-Jobs</div>
          )}
          {rootCauses.data?.map((r, i) => {
            const isTerminal = TERMINAL_CLASSES.has(r.error_class);
            const pct = totalFailed > 0 ? Math.round((r.failed_jobs / totalFailed) * 100) : 0;
            return (
              <div key={i} className="rounded-lg border border-border/60 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <AlertTriangle
                        className={cn(
                          'h-3 w-3 shrink-0',
                          isTerminal ? 'text-destructive' : 'text-warning'
                        )}
                      />
                      <span className="truncate font-mono text-xs font-semibold">
                        {r.error_class}
                      </span>
                      {isTerminal && (
                        <Badge variant="outline" className="h-4 border-destructive/30 px-1 text-[9px] text-destructive">
                          terminal
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>{r.job_type.replace(/^package_/, '')}</span>
                      <span>{r.affected_packages} Paket(e)</span>
                      <span>Ø {Number(r.avg_attempts).toFixed(1)} Versuche (max {r.max_attempts_seen})</span>
                      <span>letzter Lauf vor {relTime(r.last_run_at)}</span>
                    </div>
                    {r.sample_error && (
                      <p className="mt-1 truncate text-[10px] text-muted-foreground/80">
                        {r.sample_error}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-bold">{r.failed_jobs}×</div>
                    <div className="text-[10px] text-muted-foreground">{pct}%</div>
                  </div>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      isTerminal ? 'bg-destructive' : pct >= 30 ? 'bg-warning' : 'bg-primary'
                    )}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Audit log */}
      <Card className="border-border/70 bg-card/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-primary" />
            Status-Transition Audit Log
            <Badge variant="outline" className="ml-auto text-[10px]">
              live
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 space-y-1 overflow-y-auto">
            {transitions.isLoading && (
              <div className="text-xs text-muted-foreground">Lade…</div>
            )}
            {transitions.data?.map((t) => (
              <div
                key={t.id}
                className="flex items-start gap-2 rounded-md border border-border/40 px-2 py-1.5 text-[11px]"
              >
                <span className="shrink-0 font-mono text-muted-foreground">
                  {relTime(t.created_at)}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 font-mono text-[10px]',
                    t.new_status === 'failed' && 'bg-destructive/10 text-destructive',
                    t.new_status === 'pending' && 'bg-muted text-muted-foreground',
                    t.new_status === 'processing' && 'bg-primary/10 text-primary',
                    t.new_status === 'completed' && 'bg-success/10 text-success',
                    t.new_status === 'cancelled' && 'bg-muted text-muted-foreground/70',
                  )}
                >
                  {transitionLabel(t)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono text-muted-foreground">
                    {(t.job_type ?? '?').replace(/^package_/, '')}
                  </span>
                  {t.error_class && (
                    <span className="ml-1.5 font-mono text-destructive/80">{t.error_class}</span>
                  )}
                </span>
                <Badge
                  variant="outline"
                  className="h-4 shrink-0 px-1 text-[9px] text-muted-foreground"
                >
                  {t.trigger_source}
                </Badge>
              </div>
            ))}
            {!transitions.isLoading && transitions.data?.length === 0 && (
              <div className="text-xs text-muted-foreground">Noch keine Transitions geloggt</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
