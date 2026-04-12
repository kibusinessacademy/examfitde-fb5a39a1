import { useState, useMemo, lazy, Suspense } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminQueueSSOT, useAdminQueueCounts, AdminQueueJob } from '@/hooks/useAdminQueueSSOT';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'react-router-dom';
import {
  Search, Clock, AlertTriangle, XCircle, Zap,
  CheckCircle2, ListChecks, Skull, Play, Trash2,
  RotateCcw, Loader2, ArrowRight, ChevronDown
} from 'lucide-react';
import { cn } from '@/lib/utils';

function stripPrefix(title: string | null | undefined): string {
  return (title || '').replace(/^ExamFit\s*–\s*/i, '');
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

function healthBadge(signal: string) {
  const map: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    zombie: { label: 'Zombie', className: 'bg-destructive/10 text-destructive border-destructive/30', icon: <Skull className="h-3 w-3" /> },
    stale_lock: { label: 'Stale Lock', className: 'bg-warning/10 text-warning border-warning/30', icon: <AlertTriangle className="h-3 w-3" /> },
    exhausted: { label: 'Erschöpft', className: 'bg-destructive/10 text-destructive border-destructive/30', icon: <XCircle className="h-3 w-3" /> },
    retriable: { label: 'Wiederholbar', className: 'bg-warning/10 text-warning border-warning/30', icon: <AlertTriangle className="h-3 w-3" /> },
    aging: { label: 'Alternder Job', className: 'bg-warning/10 text-warning border-warning/30', icon: <Clock className="h-3 w-3" /> },
    normal: { label: '', className: '', icon: null },
  };
  return map[signal] || map.normal;
}

function statusColor(status: string): string {
  switch (status) {
    case 'pending': case 'queued': return 'bg-muted text-muted-foreground border-border';
    case 'processing': return 'bg-primary/10 text-primary border-primary/30';
    case 'failed': return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'completed': return 'bg-success/10 text-success border-success/30';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

function diagnoseJob(job: AdminQueueJob): { text: string; severity: 'info' | 'warning' | 'error' } | null {
  if (job.health_signal === 'zombie') {
    return { text: `Job hängt seit ${formatAge(job.age_minutes * 60)} im Status „processing" ohne Fortschritt.`, severity: 'error' };
  }
  if (job.health_signal === 'exhausted') {
    return { text: `Alle ${job.max_attempts} Versuche aufgebraucht. Fehler: ${job.last_error?.slice(0, 120) || 'unbekannt'}`, severity: 'error' };
  }
  if (job.health_signal === 'stale_lock') {
    return { text: 'Lock ist veraltet – Worker wurde möglicherweise unterbrochen.', severity: 'warning' };
  }
  if (job.health_signal === 'retriable' && job.last_error) {
    return { text: `Fehlgeschlagen: ${job.attempts}/${job.max_attempts} Versuche. ${job.last_error.slice(0, 120)}`, severity: 'warning' };
  }
  if (job.health_signal === 'aging') {
    return { text: `Job wartet seit ${formatAge(job.age_minutes * 60)}.`, severity: 'info' };
  }
  return null;
}

function JobRow({ job, onAction, actionPending }: {
  job: AdminQueueJob;
  onAction: (jobId: string, action: string) => void;
  actionPending: boolean;
}) {
  const hb = healthBadge(job.health_signal);
  const [expanded, setExpanded] = useState(false);
  const diagnosis = diagnoseJob(job);

  const isFailed = job.job_status === 'failed';
  const isZombie = job.health_signal === 'zombie';
  const isExhausted = job.health_signal === 'exhausted';
  const isRetriable = job.health_signal === 'retriable' || isExhausted;
  const isStaleLock = job.health_signal === 'stale_lock';

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        className="w-full p-3 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground">{job.job_type.replace(/_/g, ' ')}</span>
              <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4", statusColor(job.job_status))}>
                {job.job_status}
              </Badge>
              {hb.label && (
                <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4 gap-0.5", hb.className)}>
                  {hb.icon}{hb.label}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-[10px] text-muted-foreground font-mono">{job.job_id.slice(0, 8)}</span>
              <span className="text-[10px] text-muted-foreground">⏱ {formatAge(job.age_minutes * 60)}</span>
              <span className="text-[10px] text-muted-foreground">{job.attempts}/{job.max_attempts}</span>
              {job.package_title && (
                <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">📦 {stripPrefix(job.package_title)}</span>
              )}
            </div>
          </div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform mt-1", expanded && "rotate-180")} />
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-border pt-2.5">
          {diagnosis && (
            <div className={cn(
              "rounded-lg border p-2 text-xs",
              diagnosis.severity === 'error' ? "border-destructive/20 bg-destructive/5 text-foreground" :
              diagnosis.severity === 'warning' ? "border-warning/20 bg-warning/5 text-foreground" :
              "border-border bg-muted/30 text-foreground"
            )}>
              <div className="font-semibold flex items-center gap-1 mb-0.5" style={{
                color: diagnosis.severity === 'error' ? 'hsl(var(--destructive))' :
                       diagnosis.severity === 'warning' ? 'hsl(var(--warning))' :
                       'hsl(var(--muted-foreground))'
              }}>
                <AlertTriangle className="h-3 w-3" /> Diagnose
              </div>
              {diagnosis.text}
            </div>
          )}

          <div className="space-y-1 text-xs text-muted-foreground">
            {job.package_id && (
              <div className="flex items-center gap-1">
                <span className="font-medium text-foreground">Paket:</span>
                <Link to={`/admin/studio/${job.package_id}`} className="text-primary hover:underline flex items-center gap-0.5">
                  {stripPrefix(job.package_title) || job.package_id.slice(0, 8)} <ArrowRight className="h-2.5 w-2.5" />
                </Link>
              </div>
            )}
            {job.package_status && <div><span className="font-medium text-foreground">Paket-Status:</span> {job.package_status}</div>}
            {job.locked_by && <div><span className="font-medium text-foreground">Locked by:</span> {job.locked_by}</div>}
            {(job.meta as any)?.last_error_code && <div><span className="font-medium text-foreground">Error Code:</span> {(job.meta as any).last_error_code}</div>}
            {(job.meta as any)?.worker_pool && <div><span className="font-medium text-foreground">Worker Pool:</span> {(job.meta as any).worker_pool}</div>}
          </div>

          {job.last_error && (
            <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-2 text-destructive text-[11px] font-mono break-all line-clamp-4">
              {job.last_error}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {/* Force Run — always available for pending/processing jobs */}
            {(job.job_status === 'pending' || job.job_status === 'processing') && (
              <Button size="sm" variant="outline" disabled={actionPending}
                className="text-xs h-8 border-primary/30 text-primary hover:bg-primary/10"
                onClick={(e) => { e.stopPropagation(); onAction(job.job_id, 'force_run'); }}>
                {actionPending ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Zap className="h-3 w-3 mr-1.5" />}
                Force Run
              </Button>
            )}
            {(isRetriable || isFailed) && (
              <Button size="sm" variant="outline" disabled={actionPending} className="text-xs h-8"
                onClick={(e) => { e.stopPropagation(); onAction(job.job_id, 'retry'); }}>
                {actionPending ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Play className="h-3 w-3 mr-1.5" />}
                Erneut versuchen
              </Button>
            )}
            {isZombie && (
              <Button size="sm" variant="outline" disabled={actionPending} className="text-xs h-8"
                onClick={(e) => { e.stopPropagation(); onAction(job.job_id, 'kill_zombie'); }}>
                <Skull className="h-3 w-3 mr-1.5" />
                Zombie killen
              </Button>
            )}
            {isStaleLock && (
              <Button size="sm" variant="outline" disabled={actionPending} className="text-xs h-8"
                onClick={(e) => { e.stopPropagation(); onAction(job.job_id, 'release_lock'); }}>
                <RotateCcw className="h-3 w-3 mr-1.5" />
                Lock freigeben
              </Button>
            )}
            {(isFailed || isZombie || job.job_status === 'processing' || job.job_status === 'pending') && (
              <Button size="sm" variant="outline" disabled={actionPending}
                className="text-xs h-8 border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={(e) => { e.stopPropagation(); onAction(job.job_id, 'cancel'); }}>
                <Trash2 className="h-3 w-3 mr-1.5" />
                Abbrechen
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function QueuePage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const { toast } = useToast();
  const qc = useQueryClient();

  // Server-side counts — always accurate
  const { data: counts } = useAdminQueueCounts();
  // Jobs list — filtered by status to avoid truncation
  const { data: jobs, isLoading, error } = useAdminQueueSSOT(statusFilter);

  const actionMutation = useMutation({
    mutationFn: async ({ jobId, action }: { jobId: string; action: string }) => {
      if (action === 'retry') return runAdminOpsAction('requeue_failed_jobs', { job_ids: [jobId] });
      if (action === 'kill_zombie') return runAdminOpsAction('kill_stale_processing_jobs', { job_ids: [jobId] });
      if (action === 'release_lock') return runAdminOpsAction('release_stale_leases', { job_ids: [jobId] });
      if (action === 'cancel') return runAdminOpsAction('cancel_zombie_packages', { job_ids: [jobId] });
      if (action === 'force_run') {
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await supabase.functions.invoke('admin-ops-actions', {
          body: { action: 'force_run_job', job_id: jobId },
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (error) throw error;
        return data;
      }
      return null;
    },
    onSuccess: (_, vars) => {
      toast({ title: 'Aktion ausgeführt', description: `Job ${vars.jobId.slice(0, 8)} → ${vars.action}` });
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    },
  });

  const batchMutation = useMutation({
    mutationFn: async (action: string) => {
      if (action === 'retry_all_failed') return runAdminOpsAction('requeue_failed_jobs', { limit: 50 });
      if (action === 'kill_all_zombies') return runAdminOpsAction('kill_stale_processing_jobs', { limit: 50 });
      if (action === 'full_reset') return runAdminOpsAction('full_queue_reset');
      if (action === 'heal_ghosts') return runAdminOpsAction('heal_ghost_completions');
      if (action === 'reset_stale') return runAdminOpsAction('reset_stale_processing');
      if (action === 'cancel_zombie_noop') return runAdminOpsAction('cancel_zombie_noop_jobs');
      if (action === 'purge_completed') return runAdminOpsAction('purge_completed_jobs', { hours: 24 });
      if (action === 'heal_finalization') return runAdminOpsAction('heal_finalization_stall', { limit: 20 });
      if (action === 'heal_non_building') return runAdminOpsAction('heal_non_building', { limit: 20 });
        const { error } = await supabase.from('job_queue').delete().eq('status', 'failed');
        if (error) throw new Error(error.message);
        return { purged: true };
      }
      if (action === 'purge_cancelled') {
        const { error } = await supabase.from('job_queue').delete().eq('status', 'cancelled');
        if (error) throw new Error(error.message);
        return { purged: true };
      }
      return null;
    },
    onSuccess: (_, action) => {
      toast({ title: 'Aktion ausgeführt', description: action.replace(/_/g, ' ') });
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    },
  });

  // Client-side search filter on already status-filtered jobs
  const filtered = useMemo(() => {
    if (!jobs) return [];
    if (!search.trim()) return jobs;
    const q = search.toLowerCase();
    return jobs.filter(j =>
      j.job_type.toLowerCase().includes(q) ||
      j.job_id.toLowerCase().includes(q) ||
      (j.package_title || '').toLowerCase().includes(q) ||
      (j.last_error || '').toLowerCase().includes(q)
    );
  }, [jobs, search]);

  // Zombies/exhausted from loaded jobs
  const zombieCount = useMemo(() => jobs?.filter(j => j.health_signal === 'zombie').length ?? 0, [jobs]);
  const exhaustedCount = useMemo(() => jobs?.filter(j => j.health_signal === 'exhausted').length ?? 0, [jobs]);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Fehler: {(error as Error).message}
      </div>
    );
  }

  const c = counts ?? { pending: 0, processing: 0, failed: 0, completed_1h: 0, cancelled: 0, total: 0 };

  const StuckJobTypeAlert = lazy(() => import('@/components/admin/queue/StuckJobTypeAlert'));

  return (
    <div className="space-y-4">
      <Suspense fallback={null}><StuckJobTypeAlert /></Suspense>
      <div>
        <h1 className="text-xl font-bold text-foreground">Queue</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Operations Queue · Echtdaten (Server-Counts)</p>
      </div>

      {/* Summary tiles — server-side counts, always accurate */}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => setStatusFilter('pending')} className={cn("rounded-lg border border-border bg-card p-2 text-center transition-colors hover:bg-muted/50", statusFilter === 'pending' && "ring-2 ring-primary")}>
          <div className="text-lg font-bold text-foreground">{c.pending}</div>
          <div className="text-[10px] text-muted-foreground">Pending</div>
        </button>
        <button onClick={() => setStatusFilter('processing')} className={cn("rounded-lg border border-primary/30 bg-primary/5 p-2 text-center transition-colors hover:bg-primary/10", statusFilter === 'processing' && "ring-2 ring-primary")}>
          <div className="text-lg font-bold text-primary">{c.processing}</div>
          <div className="text-[10px] text-muted-foreground">Processing</div>
        </button>
        <button onClick={() => setStatusFilter('failed')} className={cn("rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-center transition-colors hover:bg-destructive/10", statusFilter === 'failed' && "ring-2 ring-primary")}>
          <div className="text-lg font-bold text-destructive">{c.failed}</div>
          <div className="text-[10px] text-muted-foreground">Failed</div>
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => setStatusFilter('completed')} className={cn("rounded-lg border border-success/30 bg-success/5 p-2 text-center transition-colors hover:bg-success/10", statusFilter === 'completed' && "ring-2 ring-primary")}>
          <div className="text-lg font-bold text-success">{c.completed_1h}</div>
          <div className="text-[10px] text-muted-foreground">Done 1h</div>
        </button>
        <button onClick={() => setStatusFilter('cancelled')} className={cn("rounded-lg border border-border bg-card p-2 text-center transition-colors hover:bg-muted/50", statusFilter === 'cancelled' && "ring-2 ring-primary")}>
          <div className="text-lg font-bold text-muted-foreground">{c.cancelled}</div>
          <div className="text-[10px] text-muted-foreground">Cancelled</div>
        </button>
        <button onClick={() => setStatusFilter('all')} className={cn("rounded-lg border border-border bg-card p-2 text-center transition-colors hover:bg-muted/50", statusFilter === 'all' && "ring-2 ring-primary")}>
          <div className="text-lg font-bold text-foreground">{c.total}</div>
          <div className="text-[10px] text-muted-foreground">Aktiv gesamt</div>
        </button>
      </div>

      {/* Batch actions */}
      <div className="flex flex-wrap gap-2">
        {/* Primary ops actions */}
        <Button size="sm" variant="outline" disabled={batchMutation.isPending}
          className="text-xs h-8 border-primary/30 text-primary hover:bg-primary/10"
          onClick={() => {
            if (confirm('Vollständiges Queue-Reset durchführen?\n\n• Stale Processing → Pending\n• Ghost meta.ok bereinigen\n• Zombie-Noop-Jobs stornieren')) {
              batchMutation.mutate('full_reset');
            }
          }}>
          {batchMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Zap className="h-3 w-3 mr-1.5" />}
          Full Reset
        </Button>
        <Button size="sm" variant="outline" disabled={batchMutation.isPending} className="text-xs h-8"
          onClick={() => batchMutation.mutate('reset_stale')}>
          <RotateCcw className="h-3 w-3 mr-1.5" />
          Stale Processing
        </Button>
        <Button size="sm" variant="outline" disabled={batchMutation.isPending} className="text-xs h-8"
          onClick={() => batchMutation.mutate('heal_ghosts')}>
          <CheckCircle2 className="h-3 w-3 mr-1.5" />
          Ghost Heal
        </Button>
        <Button size="sm" variant="outline" disabled={batchMutation.isPending} className="text-xs h-8"
          onClick={() => batchMutation.mutate('cancel_zombie_noop')}>
          <Skull className="h-3 w-3 mr-1.5" />
          Zombie Noop
        </Button>
        <Button size="sm" variant="outline" disabled={batchMutation.isPending} className="text-xs h-8"
          onClick={() => batchMutation.mutate('heal_finalization')}>
          <ListChecks className="h-3 w-3 mr-1.5" />
          Finalization Heal
        </Button>
        <Button size="sm" variant="outline" disabled={batchMutation.isPending} className="text-xs h-8"
          onClick={() => batchMutation.mutate('heal_non_building')}>
          <AlertTriangle className="h-3 w-3 mr-1.5" />
          Non-Building Heal
        </Button>
        <Button size="sm" variant="outline" disabled={batchMutation.isPending} className="text-xs h-8"
          onClick={() => {
            if (confirm('Alle abgeschlossenen Jobs älter als 24h endgültig löschen?')) {
              batchMutation.mutate('purge_completed');
            }
          }}>
          <Trash2 className="h-3 w-3 mr-1.5" />
          Completed purgen
        </Button>
        {c.failed > 0 && (
          <>
            <Button size="sm" variant="outline" disabled={batchMutation.isPending} className="text-xs h-8"
              onClick={() => batchMutation.mutate('retry_all_failed')}>
              {batchMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Play className="h-3 w-3 mr-1.5" />}
              Failed requeuen (max 50)
            </Button>
            <Button size="sm" variant="outline" disabled={batchMutation.isPending}
              className="text-xs h-8 border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={() => {
                if (confirm(`Alle ${c.failed} fehlgeschlagenen Jobs endgültig löschen?`)) {
                  batchMutation.mutate('purge_failed');
                }
              }}>
              <Trash2 className="h-3 w-3 mr-1.5" />
              {c.failed} Failed löschen
            </Button>
          </>
        )}
        {c.cancelled > 0 && (
          <Button size="sm" variant="outline" disabled={batchMutation.isPending}
            className="text-xs h-8 border-muted-foreground/30 text-muted-foreground hover:bg-muted/30"
            onClick={() => {
              if (confirm(`Alle ${c.cancelled} abgebrochenen Jobs löschen?`)) {
                batchMutation.mutate('purge_cancelled');
              }
            }}>
            <Trash2 className="h-3 w-3 mr-1.5" />
            Cancelled löschen
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Suchen nach Job-Typ, ID, Paket oder Fehler…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 h-10 bg-card border-border"
        />
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { key: 'all', label: 'Alle' },
          { key: 'pending', label: `Pending ${c.pending}` },
          { key: 'processing', label: `Processing ${c.processing}` },
          { key: 'failed', label: `Failed ${c.failed}` },
          { key: 'completed', label: `Completed ${c.completed_1h}` },
          { key: 'cancelled', label: `Cancelled ${c.cancelled}` },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              statusFilter === f.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:bg-muted/50"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Job list */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {search ? 'Keine Jobs gefunden für diese Suche.' : 'Keine Jobs in dieser Kategorie.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((job) => (
            <JobRow
              key={job.job_id}
              job={job}
              onAction={(jobId, action) => actionMutation.mutate({ jobId, action })}
              actionPending={actionMutation.isPending}
            />
          ))}
          {filtered.length >= 200 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              Zeige max. 200 Jobs. Verwende Filter oder Suche für mehr Präzision.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
