import { useState, useMemo } from 'react';
import { useAdminQueueSSOT, AdminQueueJob } from '@/hooks/useAdminQueueSSOT';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Search, Clock, AlertTriangle, XCircle, Zap,
  CheckCircle2, ListChecks, Skull
} from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_FILTERS = [
  { key: 'all', label: 'Alle' },
  { key: 'pending', label: 'Pending' },
  { key: 'processing', label: 'Processing' },
  { key: 'failed', label: 'Failed' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

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

function JobRow({ job }: { job: AdminQueueJob }) {
  const hb = healthBadge(job.health_signal);
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-xl border border-border bg-card p-3 cursor-pointer hover:bg-muted/30 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{job.job_type}</span>
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
              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">📦 {job.package_title}</span>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-border space-y-1.5 text-xs text-muted-foreground">
          {job.package_id && <div><span className="font-medium text-foreground">Paket:</span> {job.package_id}</div>}
          {job.package_status && <div><span className="font-medium text-foreground">Paket-Status:</span> {job.package_status}</div>}
          {job.locked_by && <div><span className="font-medium text-foreground">Locked by:</span> {job.locked_by}</div>}
          {job.last_error && (
            <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-2 text-destructive text-[11px] font-mono break-all">
              {job.last_error}
            </div>
          )}
          {(job.meta as any)?.last_error_code && <div><span className="font-medium text-foreground">Error Code:</span> {(job.meta as any).last_error_code}</div>}
          {(job.meta as any)?.worker_pool && <div><span className="font-medium text-foreground">Worker Pool:</span> {(job.meta as any).worker_pool}</div>}
          {(job.meta as any)?.liveness_status && <div><span className="font-medium text-foreground">Liveness:</span> {(job.meta as any).liveness_status}</div>}
        </div>
      )}
    </div>
  );
}

export default function QueuePage() {
  const { data: jobs, isLoading, error } = useAdminQueueSSOT();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const summary = useMemo(() => {
    if (!jobs) return null;
    return {
      pending: jobs.filter(j => j.job_status === 'pending' || j.job_status === 'queued').length,
      processing: jobs.filter(j => ['processing', 'running', 'batch_pending'].includes(j.job_status)).length,
      failed: jobs.filter(j => j.job_status === 'failed').length,
      completed: jobs.filter(j => j.job_status === 'completed').length,
      zombies: jobs.filter(j => j.health_signal === 'zombie').length,
      exhausted: jobs.filter(j => j.health_signal === 'exhausted').length,
    };
  }, [jobs]);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    let list = jobs;
    if (statusFilter !== 'all') {
      if (statusFilter === 'pending') {
        list = list.filter(j => j.job_status === 'pending' || j.job_status === 'queued');
      } else {
        list = list.filter(j => j.job_status === statusFilter);
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(j =>
        j.job_type.toLowerCase().includes(q) ||
        j.job_id.toLowerCase().includes(q) ||
        (j.package_title || '').toLowerCase().includes(q) ||
        (j.last_error || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [jobs, search, statusFilter]);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Fehler: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Queue</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Operations Queue · Echtdaten</p>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <div className="rounded-lg border border-border bg-card p-2 text-center">
            <div className="text-lg font-bold text-foreground">{summary.pending}</div>
            <div className="text-[10px] text-muted-foreground">Pending</div>
          </div>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 text-center">
            <div className="text-lg font-bold text-primary">{summary.processing}</div>
            <div className="text-[10px] text-muted-foreground">Processing</div>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-center">
            <div className="text-lg font-bold text-destructive">{summary.failed}</div>
            <div className="text-[10px] text-muted-foreground">Failed</div>
          </div>
          <div className="rounded-lg border border-success/30 bg-success/5 p-2 text-center">
            <div className="text-lg font-bold text-success">{summary.completed}</div>
            <div className="text-[10px] text-muted-foreground">Done 1h</div>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-center">
            <div className="text-lg font-bold text-destructive">{summary.zombies}</div>
            <div className="text-[10px] text-muted-foreground">Zombies</div>
          </div>
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-2 text-center">
            <div className="text-lg font-bold text-warning">{summary.exhausted}</div>
            <div className="text-[10px] text-muted-foreground">Erschöpft</div>
          </div>
        </div>
      )}

      {/* Search + Filter */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Suchen nach Job-Typ, ID, Paket oder Fehler…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-10 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors",
                statusFilter === f.key
                  ? "bg-primary/10 text-primary"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              )}
            >
              {f.label}
              {f.key !== 'all' && summary && (
                <span className="ml-1 text-[10px] opacity-60">
                  {f.key === 'pending' ? summary.pending : 
                   f.key === 'processing' ? summary.processing :
                   f.key === 'failed' ? summary.failed :
                   summary.completed}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Job List */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          <ListChecks className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Keine Jobs gefunden.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(job => (
            <JobRow key={job.job_id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
