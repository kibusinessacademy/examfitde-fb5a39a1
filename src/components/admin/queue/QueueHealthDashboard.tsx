import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, TrendingDown, RefreshCw, Loader2, Bell, History, Activity,
  Play, XCircle, Skull, ChevronRight, Shield, GitBranch, Eye,
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
  last_error: string | null;
  reason: string | null;
  trigger_source: string;
  attempts: number | null;
  created_at: string;
  meta_diff: Record<string, unknown> | null;
  change_kind: string | null;
}

interface DecisionRow {
  id: number;
  job_id: string;
  decided_at: string;
  decision: string;
  error_class: string | null;
  package_status: string | null;
  attempts: number | null;
  cooldown_seconds: number | null;
  checks: Record<string, boolean>;
  reason: string | null;
}

interface HealthAlert {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  created_at: string;
  is_read: boolean;
}

type JobAction = 'force_pending' | 'cancel' | 'mark_terminal';

const TERMINAL_CLASSES = new Set([
  'HARD_FAIL_NO_CURRICULUM','HARD_FAIL_NO_BLUEPRINTS','HARD_FAIL_REPAIR_EXHAUSTED',
  'HARD_FAIL_BREAKER','REQUEUE_LOOP_KILLED',
]);

const ACTION_LABELS: Record<JobAction, string> = {
  force_pending: 'Force → Pending',
  cancel: 'Cancel',
  mark_terminal: 'Als terminal markieren',
};

function relTime(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.round(d)}s`;
  if (d < 3600) return `${Math.round(d / 60)}m`;
  if (d < 86400) return `${(d / 3600).toFixed(1)}h`;
  return `${(d / 86400).toFixed(1)}d`;
}

function severityClass(sev: string): string {
  if (sev === 'critical') return 'bg-destructive/10 text-destructive border-destructive/30';
  if (sev === 'high') return 'bg-warning/10 text-warning border-warning/30';
  return 'bg-muted text-muted-foreground border-border';
}

function diffField(label: string, oldV: unknown, newV: unknown) {
  const o = String(oldV ?? '—');
  const n = String(newV ?? '—');
  if (o === n) return null;
  return (
    <div key={label} className="flex flex-wrap items-baseline gap-1 text-[10px]">
      <span className="font-mono text-muted-foreground">{label}:</span>
      <span className="line-through opacity-60">{o.slice(0, 80)}</span>
      <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
      <span className="font-semibold text-foreground">{n.slice(0, 80)}</span>
    </div>
  );
}

export function QueueHealthDashboard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [actionDialog, setActionDialog] = useState<{
    jobIds: string[]; action: JobAction; label: string; bulk: boolean;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [unsafeOverride, setUnsafeOverride] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openDecision, setOpenDecision] = useState<string | null>(null);
  const [openDiff, setOpenDiff] = useState<number | null>(null);

  const rootCauses = useQuery({
    queryKey: ['queue-health', 'root-causes'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_failed_root_causes' as any);
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
        .limit(60);
      if (error) throw error;
      return (data ?? []) as unknown as TransitionRow[];
    },
    refetchInterval: 20_000,
  });

  const decisions = useQuery({
    queryKey: ['queue-health', 'decisions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_retry_decisions' as any)
        .select('*')
        .order('decided_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as DecisionRow[];
    },
    refetchInterval: 30_000,
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

  const decisionsByJob = useMemo(() => {
    const m = new Map<string, DecisionRow[]>();
    decisions.data?.forEach((d) => {
      const arr = m.get(d.job_id) ?? [];
      arr.push(d);
      m.set(d.job_id, arr);
    });
    return m;
  }, [decisions.data]);

  const autoRetry = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('fn_auto_retry_failed_jobs' as any, { _limit: 100 });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast({
        title: 'Auto-Retry abgeschlossen',
        description: `${data?.retried ?? 0} ↻ · ${data?.skipped_terminal ?? 0} terminal · ${data?.skipped_duplicate ?? 0} dup · ${data?.skipped_obsolete ?? 0} obsolet · ${data?.row_errors ?? 0} fehler`,
      });
      qc.invalidateQueries({ queryKey: ['queue-health'] });
      qc.invalidateQueries({ queryKey: ['admin', 'ops-queue'] });
    },
    onError: (e: Error) => toast({ title: 'Auto-Retry fehlgeschlagen', description: e.message, variant: 'destructive' }),
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
        description: `Failed: ${data?.failed ?? 0} · Stale: ${data?.stale_failed ?? 0} · Overlap: ${data?.snapshot_overlap ?? 0}`,
      });
      qc.invalidateQueries({ queryKey: ['queue-health'] });
    },
    onError: (e: Error) => toast({ title: 'Health-Check fehlgeschlagen', description: e.message, variant: 'destructive' }),
  });

  const jobAction = useMutation({
    mutationFn: async (vars: { jobIds: string[]; action: JobAction; reason: string; bulk: boolean; force: boolean }) => {
      if (vars.bulk || vars.jobIds.length > 1) {
        const { data, error } = await supabase.rpc('admin_job_action_bulk' as any, {
          _job_ids: vars.jobIds, _action: vars.action, _reason: vars.reason, _force: vars.force,
        });
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase.rpc('admin_job_action' as any, {
        _job_id: vars.jobIds[0], _action: vars.action, _reason: vars.reason, _force: vars.force,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      const isBulk = !!data?.total;
      toast({
        title: isBulk ? `Bulk-Aktion: ${data.ok} ok / ${data.err} err` : 'Aktion ausgeführt',
        description: isBulk ? `${data.total} Jobs verarbeitet` : `${data?.old_status} → ${data?.new_status}`,
      });
      setActionDialog(null);
      setReason('');
      setUnsafeOverride(false);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ['queue-health'] });
      qc.invalidateQueries({ queryKey: ['admin', 'ops-queue'] });
    },
    onError: (e: Error) => toast({ title: 'Aktion fehlgeschlagen', description: e.message, variant: 'destructive' }),
  });

  const totalFailed = rootCauses.data?.reduce((s, r) => s + r.failed_jobs, 0) ?? 0;
  const openAlerts = alerts.data?.filter((a) => !a.is_read) ?? [];

  const openAction = (jobIds: string[], action: JobAction, label: string, bulk = false) => {
    setActionDialog({ jobIds, action, label, bulk });
    setReason(''); setUnsafeOverride(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectedArray = Array.from(selectedIds);

  return (
    <div className="space-y-3">
      {openAlerts.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Bell className="h-4 w-4 text-destructive" />
              Queue-Health Alerts
              <Badge variant="outline" className="ml-auto text-[10px]">{openAlerts.length} offen</Badge>
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

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-8 text-xs"
          onClick={() => autoRetry.mutate()} disabled={autoRetry.isPending}>
          {autoRetry.isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1.5 h-3 w-3" />}
          Auto-Retry
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs"
          onClick={() => checkHealth.mutate()} disabled={checkHealth.isPending}>
          {checkHealth.isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Activity className="mr-1.5 h-3 w-3" />}
          Health-Check
        </Button>
        {selectedArray.length > 0 && (
          <>
            <Badge variant="outline" className="h-8 px-2 text-xs">{selectedArray.length} ausgewählt</Badge>
            <Button size="sm" variant="outline" className="h-8 text-xs"
              onClick={() => openAction(selectedArray, 'force_pending', `${selectedArray.length} Jobs`, true)}>
              <Play className="mr-1.5 h-3 w-3" /> Bulk → Pending
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs"
              onClick={() => openAction(selectedArray, 'cancel', `${selectedArray.length} Jobs`, true)}>
              <XCircle className="mr-1.5 h-3 w-3" /> Bulk Cancel
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs text-destructive"
              onClick={() => openAction(selectedArray, 'mark_terminal', `${selectedArray.length} Jobs`, true)}>
              <Skull className="mr-1.5 h-3 w-3" /> Bulk Terminal
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSelectedIds(new Set())}>
              Auswahl löschen
            </Button>
          </>
        )}
      </div>

      {/* Root causes */}
      <Card className="border-border/70 bg-card/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-destructive" />
              Root Causes (Failed Queue)
            </span>
            <Badge variant="outline" className="text-[10px]">{totalFailed} Jobs</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {rootCauses.isLoading && <div className="text-xs text-muted-foreground">Lade…</div>}
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
                      <AlertTriangle className={cn('h-3 w-3 shrink-0', isTerminal ? 'text-destructive' : 'text-warning')} />
                      <span className="truncate font-mono text-xs font-semibold">{r.error_class}</span>
                      {isTerminal && (
                        <Badge variant="outline" className="h-4 border-destructive/30 px-1 text-[9px] text-destructive">terminal</Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>{r.job_type.replace(/^package_/, '')}</span>
                      <span>{r.affected_packages} Paket(e)</span>
                      <span>Ø {Number(r.avg_attempts).toFixed(1)} Versuche</span>
                      <span>vor {relTime(r.last_run_at)}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-bold">{r.failed_jobs}×</div>
                    <div className="text-[10px] text-muted-foreground">{pct}%</div>
                  </div>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                  <div className={cn('h-full rounded-full', isTerminal ? 'bg-destructive' : pct >= 30 ? 'bg-warning' : 'bg-primary')}
                    style={{ width: `${Math.max(pct, 2)}%` }} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Audit log with diff, decision trace, bulk select */}
      <Card className="border-border/70 bg-card/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-primary" />
            Status-Transition Audit Log
            <Badge variant="outline" className="ml-auto text-[10px]">live · {transitions.data?.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[36rem] space-y-1.5 overflow-y-auto">
            {transitions.isLoading && <div className="text-xs text-muted-foreground">Lade…</div>}
            {transitions.data?.map((t) => {
              const label = `${(t.job_type ?? '?').replace(/^package_/, '')} (${t.job_id.slice(0, 8)})`;
              const isSelected = selectedIds.has(t.job_id);
              const decisionsForJob = decisionsByJob.get(t.job_id) ?? [];
              const diff = t.meta_diff as any;
              const hasDiff = diff && (
                diff.old_last_error !== diff.new_last_error ||
                diff.old_error !== diff.new_error ||
                JSON.stringify(diff.old_meta) !== JSON.stringify(diff.new_meta)
              );

              return (
                <div key={t.id} className={cn('rounded-md border px-2 py-1.5 text-[11px]',
                  isSelected ? 'border-primary/60 bg-primary/5' : 'border-border/40')}>
                  <div className="flex items-start gap-2">
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(t.job_id)}
                      className="mt-0.5 h-3.5 w-3.5" />
                    <span className="shrink-0 font-mono text-muted-foreground">{relTime(t.created_at)}</span>
                    <span className={cn('shrink-0 rounded px-1.5 font-mono text-[10px]',
                      t.new_status === 'failed' && 'bg-destructive/10 text-destructive',
                      t.new_status === 'pending' && 'bg-muted text-muted-foreground',
                      t.new_status === 'processing' && 'bg-primary/10 text-primary',
                      t.new_status === 'completed' && 'bg-success/10 text-success',
                      t.new_status === 'cancelled' && 'bg-muted text-muted-foreground/70')}>
                      {t.old_status ?? '—'} → {t.new_status}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-mono text-muted-foreground">{(t.job_type ?? '?').replace(/^package_/, '')}</span>
                      {t.error_class && <span className="ml-1.5 font-mono text-destructive/80">{t.error_class}</span>}
                    </span>
                    <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px] text-muted-foreground">
                      {t.trigger_source}
                    </Badge>
                    {t.change_kind && (
                      <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px]">{t.change_kind}</Badge>
                    )}
                  </div>

                  {/* Inline diff */}
                  {hasDiff && (
                    <Collapsible open={openDiff === t.id} onOpenChange={(o) => setOpenDiff(o ? t.id : null)}>
                      <CollapsibleTrigger className="mt-1 flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground">
                        <GitBranch className="h-2.5 w-2.5" /> Diff anzeigen
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-1 space-y-0.5 rounded border border-border/40 bg-muted/30 p-1.5">
                        {diffField('last_error', diff.old_last_error, diff.new_last_error)}
                        {diffField('error', diff.old_error, diff.new_error)}
                        {diff.old_meta && diff.new_meta && JSON.stringify(diff.old_meta) !== JSON.stringify(diff.new_meta) && (
                          <div className="text-[10px]">
                            <span className="font-mono text-muted-foreground">meta:</span>
                            <pre className="mt-0.5 max-h-32 overflow-auto rounded bg-background/60 p-1 text-[9px]">
{JSON.stringify(diff.new_meta, null, 1)}
                            </pre>
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {/* Decision trace */}
                  {decisionsForJob.length > 0 && (
                    <Collapsible open={openDecision === t.job_id+'-'+t.id} onOpenChange={(o) => setOpenDecision(o ? t.job_id+'-'+t.id : null)}>
                      <CollapsibleTrigger className="mt-1 flex items-center gap-1 text-[9px] text-accent-foreground hover:text-foreground">
                        <Shield className="h-2.5 w-2.5" /> Retry-Decisions ({decisionsForJob.length})
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-1 space-y-1 rounded border border-accent/30 bg-accent/5 p-1.5">
                        {decisionsForJob.slice(0, 5).map((d) => (
                          <div key={d.id} className="text-[10px]">
                            <div className="flex items-center gap-1">
                              <span className={cn('font-mono font-semibold',
                                d.decision === 'retry' ? 'text-success' :
                                d.decision.startsWith('skip_') ? 'text-warning' : 'text-muted-foreground')}>
                                {d.decision}
                              </span>
                              <span className="text-muted-foreground">vor {relTime(d.decided_at)}</span>
                              {d.cooldown_seconds && <span className="text-muted-foreground">cd {d.cooldown_seconds}s</span>}
                            </div>
                            {d.reason && <p className="italic text-muted-foreground">„{d.reason}"</p>}
                            {d.checks && Object.keys(d.checks).length > 0 && (
                              <div className="mt-0.5 flex flex-wrap gap-0.5">
                                {Object.entries(d.checks).map(([k, v]) => (
                                  <Badge key={k} variant="outline" className={cn('h-3.5 px-1 text-[8px]',
                                    v ? 'border-success/30 text-success' : 'border-destructive/30 text-destructive')}>
                                    {v ? '✓' : '✗'} {k}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  <div className="mt-1 flex items-center gap-1">
                    <span className="font-mono text-[9px] text-muted-foreground/60">{t.job_id.slice(0, 8)}</span>
                    <div className="ml-auto flex gap-1">
                      <Link to={`/admin/jobs/timeline?job_id=${t.job_id}`}
                        className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Eye className="h-2.5 w-2.5" /> Timeline
                      </Link>
                      <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]"
                        onClick={() => openAction([t.job_id], 'force_pending', label)}>
                        <Play className="mr-0.5 h-2.5 w-2.5" /> Pending
                      </Button>
                      <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-muted-foreground"
                        onClick={() => openAction([t.job_id], 'cancel', label)}>
                        <XCircle className="mr-0.5 h-2.5 w-2.5" /> Cancel
                      </Button>
                      <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] text-destructive"
                        onClick={() => openAction([t.job_id], 'mark_terminal', label)}>
                        <Skull className="mr-0.5 h-2.5 w-2.5" /> Terminal
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
            {!transitions.isLoading && transitions.data?.length === 0 && (
              <div className="text-xs text-muted-foreground">Noch keine Transitions geloggt</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Confirmation dialog (single + bulk) */}
      <Dialog open={!!actionDialog} onOpenChange={(o) => !o && setActionDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actionDialog && ACTION_LABELS[actionDialog.action]}
              {actionDialog?.bulk && <Badge variant="outline" className="ml-2">Bulk</Badge>}
            </DialogTitle>
            <DialogDescription className="text-xs">
              <span className="font-mono">{actionDialog?.label}</span>
              <br />
              {actionDialog?.action === 'force_pending' &&
                'Job wird auf pending gesetzt. SSOT-Guards prüfen Status, Duplikate und Admin-Terminal-Marker.'}
              {actionDialog?.action === 'cancel' && 'Job wird storniert. Nicht reversibel ohne Re-Queue.'}
              {actionDialog?.action === 'mark_terminal' && 'Job wird als terminal failed markiert (kein Auto-Retry mehr).'}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Begründung (Pflicht)…"
            value={reason} onChange={(e) => setReason(e.target.value)}
            className="text-sm" rows={3}
          />
          {actionDialog?.action === 'force_pending' && (
            <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning/5 p-2">
              <Switch id="unsafe" checked={unsafeOverride} onCheckedChange={setUnsafeOverride} />
              <div className="flex-1">
                <Label htmlFor="unsafe" className="text-xs font-semibold text-warning">
                  Unsafe Override
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  SSOT/Causality-Guards umgehen. Nur bei Notfall — kann obsolete oder doppelte Jobs reaktivieren.
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setActionDialog(null)}>Abbrechen</Button>
            <Button
              size="sm"
              variant={actionDialog?.action === 'mark_terminal' ? 'destructive' : 'default'}
              disabled={!reason.trim() || reason.trim().length < 3 || jobAction.isPending}
              onClick={() => actionDialog && jobAction.mutate({
                jobIds: actionDialog.jobIds, action: actionDialog.action,
                reason: reason.trim(), bulk: actionDialog.bulk, force: unsafeOverride,
              })}
            >
              {jobAction.isPending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Bestätigen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
