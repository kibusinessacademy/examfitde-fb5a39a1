import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Play, XCircle, Skull, ChevronRight, Shield, GitBranch, Eye, Search, ShieldAlert, CheckCircle2,
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

interface GuardPreview {
  has_package_id: boolean;
  pkg_status_ok: boolean;
  pkg_status: string | null;
  no_active_duplicate: boolean;
  not_admin_terminal: boolean;
  no_newer_completed: boolean;
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

const BULK_PAGE_SIZE = 50;

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
  const [search, setSearch] = useState('');
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; ok: number; err: number } | null>(null);

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
        .limit(300);
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

  // Search-filtered transition list (job_id, package_id, error class, job_type)
  const filteredTransitions = useMemo(() => {
    const all = transitions.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all.slice(0, 60);
    return all.filter((t) =>
      t.job_id?.toLowerCase().includes(q) ||
      t.package_id?.toLowerCase().includes(q) ||
      t.error_class?.toLowerCase().includes(q) ||
      t.job_type?.toLowerCase().includes(q) ||
      t.last_error?.toLowerCase().includes(q)
    ).slice(0, 100);
  }, [transitions.data, search]);

  // Guard preview for the active force_pending job (single-job dialog only)
  const guardPreview = useQuery({
    queryKey: ['queue-health', 'guard-preview', actionDialog?.jobIds[0]],
    queryFn: async (): Promise<GuardPreview | null> => {
      const id = actionDialog?.jobIds[0];
      if (!id) return null;
      const { data: job, error: e1 } = await supabase
        .from('job_queue').select('id, job_type, package_id, status, updated_at, meta')
        .eq('id', id).maybeSingle();
      if (e1 || !job) return null;
      const j = job as any;

      let pkgStatus: string | null = null;
      if (j.package_id) {
        const { data: pkg } = await supabase
          .from('course_packages').select('status').eq('id', j.package_id).maybeSingle();
        pkgStatus = (pkg as any)?.status ?? null;
      }
      const allowed = ['building','queued','blocked','pending','draft'];

      const { data: dups } = await supabase
        .from('job_queue').select('id', { count: 'exact', head: false })
        .eq('job_type', j.job_type)
        .neq('id', j.id)
        .in('status', ['pending','queued','processing','running','batch_pending'])
        .limit(1);

      const { data: newer } = await supabase
        .from('job_queue').select('id, updated_at')
        .eq('job_type', j.job_type)
        .eq('status', 'completed')
        .neq('id', j.id)
        .gt('updated_at', j.updated_at)
        .limit(1);

      const dupActive = dups && dups.length > 0
        && (j.package_id ? dups.some((d: any) => true) : true);

      return {
        has_package_id: !j.job_type?.startsWith('package_') || !!j.package_id,
        pkg_status_ok: !pkgStatus || allowed.includes(pkgStatus),
        pkg_status: pkgStatus,
        no_active_duplicate: !dupActive,
        not_admin_terminal: (j.meta?.admin_terminal !== true),
        no_newer_completed: !newer || newer.length === 0,
      };
    },
    enabled: !!actionDialog && actionDialog.action === 'force_pending' && !actionDialog.bulk,
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

  // Single action
  const singleAction = useMutation({
    mutationFn: async (vars: { jobId: string; action: JobAction; reason: string; force: boolean }) => {
      const { data, error } = await supabase.rpc('admin_job_action' as any, {
        _job_id: vars.jobId, _action: vars.action, _reason: vars.reason, _force: vars.force,
      });
      if (error) throw error;
      return data;
    },
  });

  // Paginated bulk: chunk into BULK_PAGE_SIZE pages, sequential RPC calls
  const bulkAction = useMutation({
    mutationFn: async (vars: { jobIds: string[]; action: JobAction; reason: string; force: boolean }) => {
      const chunks: string[][] = [];
      for (let i = 0; i < vars.jobIds.length; i += BULK_PAGE_SIZE) {
        chunks.push(vars.jobIds.slice(i, i + BULK_PAGE_SIZE));
      }
      let totalOk = 0, totalErr = 0;
      const allErrors: any[] = [];
      setBulkProgress({ done: 0, total: vars.jobIds.length, ok: 0, err: 0 });
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const { data, error } = await supabase.rpc('admin_job_action_bulk' as any, {
          _job_ids: chunk, _action: vars.action, _reason: vars.reason, _force: vars.force,
        });
        if (error) {
          // Surface throttle / cap errors directly
          throw new Error(`Chunk ${i+1}/${chunks.length}: ${error.message}`);
        }
        const d = data as any;
        totalOk += d?.ok ?? 0;
        totalErr += d?.err ?? 0;
        if (Array.isArray(d?.errors)) allErrors.push(...d.errors);
        setBulkProgress({
          done: Math.min((i + 1) * BULK_PAGE_SIZE, vars.jobIds.length),
          total: vars.jobIds.length, ok: totalOk, err: totalErr,
        });
      }
      return { ok: totalOk, err: totalErr, total: vars.jobIds.length, errors: allErrors, pages: chunks.length };
    },
    onSuccess: (data) => {
      toast({
        title: `Bulk in ${data.pages} Welle(n) abgeschlossen`,
        description: `${data.ok} ok · ${data.err} err · ${data.total} gesamt`,
      });
      setActionDialog(null);
      setReason(''); setUnsafeOverride(false); setSelectedIds(new Set());
      setBulkProgress(null);
      qc.invalidateQueries({ queryKey: ['queue-health'] });
      qc.invalidateQueries({ queryKey: ['admin', 'ops-queue'] });
    },
    onError: (e: Error) => {
      toast({ title: 'Bulk fehlgeschlagen', description: e.message, variant: 'destructive' });
      setBulkProgress(null);
    },
  });

  const submitAction = () => {
    if (!actionDialog) return;
    if (actionDialog.bulk) {
      bulkAction.mutate({
        jobIds: actionDialog.jobIds, action: actionDialog.action,
        reason: reason.trim(), force: unsafeOverride,
      });
    } else {
      singleAction.mutate(
        { jobId: actionDialog.jobIds[0], action: actionDialog.action, reason: reason.trim(), force: unsafeOverride },
        {
          onSuccess: (data: any) => {
            toast({ title: 'Aktion ausgeführt', description: `${data?.old_status} → ${data?.new_status}` });
            setActionDialog(null); setReason(''); setUnsafeOverride(false);
            qc.invalidateQueries({ queryKey: ['queue-health'] });
            qc.invalidateQueries({ queryKey: ['admin', 'ops-queue'] });
          },
          onError: (e: Error) => toast({ title: 'Aktion fehlgeschlagen', description: e.message, variant: 'destructive' }),
        },
      );
    }
  };

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

  // Select-all of currently visible (filtered) failed transitions
  const selectAllVisible = () => {
    const failedIds = filteredTransitions.filter(t => t.new_status === 'failed').map(t => t.job_id);
    setSelectedIds(new Set(failedIds));
  };

  const selectedArray = Array.from(selectedIds);
  const isSubmitting = singleAction.isPending || bulkAction.isPending;
  const guards = guardPreview.data;
  const guardsAllPass = guards
    ? guards.has_package_id && guards.pkg_status_ok && guards.no_active_duplicate
      && guards.not_admin_terminal && guards.no_newer_completed
    : true;

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
            <Badge variant="outline" className="h-8 px-2 text-xs">
              {selectedArray.length} ausgewählt
              {selectedArray.length > BULK_PAGE_SIZE && ` (${Math.ceil(selectedArray.length / BULK_PAGE_SIZE)} Wellen)`}
            </Badge>
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
              <div key={i} className="rounded-lg border border-border/60 px-3 py-2 cursor-pointer hover:bg-muted/30"
                onClick={() => setSearch(r.error_class)}>
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

      {/* Audit log with search, diff, decision trace, bulk select */}
      <Card className="border-border/70 bg-card/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-primary" />
            Status-Transition Audit Log
            <Badge variant="outline" className="ml-auto text-[10px]">
              live · {filteredTransitions.length}/{transitions.data?.length ?? 0}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[12rem]">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Suche: job_id, package_id, error class, job_type…"
                className="h-8 pl-7 text-xs font-mono"
              />
            </div>
            {search && (
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSearch('')}>
                Reset
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={selectAllVisible}>
              Alle sichtbaren Failed wählen
            </Button>
          </div>

          <div className="max-h-[36rem] space-y-1.5 overflow-y-auto">
            {transitions.isLoading && <div className="text-xs text-muted-foreground">Lade…</div>}
            {filteredTransitions.map((t) => {
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
            {!transitions.isLoading && filteredTransitions.length === 0 && (
              <div className="text-xs text-muted-foreground">
                {search ? 'Keine Treffer für aktuelle Suche.' : 'Noch keine Transitions geloggt'}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Confirmation dialog (single + bulk) with guard preview */}
      <Dialog open={!!actionDialog} onOpenChange={(o) => !o && !isSubmitting && setActionDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actionDialog && ACTION_LABELS[actionDialog.action]}
              {actionDialog?.bulk && <Badge variant="outline" className="ml-2">Bulk · {actionDialog.jobIds.length}</Badge>}
            </DialogTitle>
            <DialogDescription className="text-xs">
              <span className="font-mono">{actionDialog?.label}</span>
              <br />
              {actionDialog?.action === 'force_pending' &&
                'Job wird auf pending gesetzt. SSOT-Guards prüfen Status, Duplikate, Admin-Terminal & neuere Erfolge.'}
              {actionDialog?.action === 'cancel' && 'Job wird storniert. Nicht reversibel ohne Re-Queue.'}
              {actionDialog?.action === 'mark_terminal' && 'Job wird als terminal failed markiert (kein Auto-Retry mehr).'}
            </DialogDescription>
          </DialogHeader>

          {/* Guard preview for force_pending single-job */}
          {actionDialog?.action === 'force_pending' && !actionDialog.bulk && (
            <div className="space-y-1 rounded border border-border/60 bg-muted/30 p-2">
              <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                <Shield className="h-3 w-3" /> Guards Status
                {guardPreview.isLoading && <Loader2 className="ml-1 h-3 w-3 animate-spin" />}
              </div>
              {guards && (
                <div className="space-y-0.5 text-[10px]">
                  {[
                    ['has_package_id', guards.has_package_id, 'Package-Bound Job hat package_id'],
                    ['pkg_status_ok', guards.pkg_status_ok, `Package-Status erlaubt${guards.pkg_status ? ` (${guards.pkg_status})` : ''}`],
                    ['no_active_duplicate', guards.no_active_duplicate, 'Kein aktiver Duplikat-Job'],
                    ['not_admin_terminal', guards.not_admin_terminal, 'Nicht admin_terminal'],
                    ['no_newer_completed', guards.no_newer_completed, 'Kein neuerer completed Job (obsolet?)'],
                  ].map(([k, ok, label]) => (
                    <div key={k as string} className="flex items-center gap-1.5">
                      {ok ? <CheckCircle2 className="h-3 w-3 text-success shrink-0" /> : <ShieldAlert className="h-3 w-3 text-destructive shrink-0" />}
                      <span className={cn('font-mono', ok ? 'text-foreground' : 'text-destructive')}>{label as string}</span>
                    </div>
                  ))}
                </div>
              )}
              {guards && !guardsAllPass && !unsafeOverride && (
                <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 p-1.5 text-[10px] text-destructive">
                  ⚠ Mindestens ein Guard schlägt fehl. Aktiviere „Unsafe Override" um diese Checks zu umgehen.
                </div>
              )}
              {guards && !guardsAllPass && unsafeOverride && (
                <div className="mt-2 rounded border border-warning/40 bg-warning/10 p-1.5 text-[10px] text-warning">
                  ⚠ Unsafe Override aktiv: SSOT-Schutz wird ignoriert. Risiko: obsoleter/doppelter Job wird scharf gemacht.
                </div>
              )}
            </div>
          )}

          <Textarea
            placeholder="Begründung (Pflicht, min 3 Zeichen)…"
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

          {/* Bulk pagination preview */}
          {actionDialog?.bulk && (
            <div className="rounded border border-primary/30 bg-primary/5 p-2 text-[10px]">
              <div className="font-semibold">Pagination</div>
              <p className="mt-0.5 text-muted-foreground">
                {actionDialog.jobIds.length} Jobs werden in {Math.ceil(actionDialog.jobIds.length / BULK_PAGE_SIZE)} Welle(n)
                à max. {BULK_PAGE_SIZE} Jobs verarbeitet (Server-Cap). Per-Job-Throttle wird umgangen, Bulk-Limit 10/min greift weiterhin.
              </p>
              {bulkProgress && (
                <div className="mt-1.5 space-y-0.5">
                  <div className="flex justify-between font-mono">
                    <span>Fortschritt {bulkProgress.done}/{bulkProgress.total}</span>
                    <span className="text-success">✓{bulkProgress.ok}</span>
                    <span className="text-destructive">✗{bulkProgress.err}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary"
                      style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setActionDialog(null)} disabled={isSubmitting}>
              Abbrechen
            </Button>
            <Button
              size="sm"
              variant={actionDialog?.action === 'mark_terminal' ? 'destructive' : 'default'}
              disabled={!reason.trim() || reason.trim().length < 3 || isSubmitting}
              onClick={submitAction}
            >
              {isSubmitting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              {actionDialog?.action === 'force_pending' && !guardsAllPass && unsafeOverride
                ? 'Trotzdem ausführen (Unsafe)' : 'Bestätigen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
