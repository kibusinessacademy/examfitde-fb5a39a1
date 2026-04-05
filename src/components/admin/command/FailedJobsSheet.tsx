import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminQueueSSOT, AdminQueueJob } from '@/hooks/useAdminQueueSSOT';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  AdminSheet as Sheet, AdminSheetContent as SheetContent,
  AdminSheetHeader as SheetHeader, AdminSheetTitle as SheetTitle,
} from '@/components/admin/AdminSheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, XCircle, ArrowRight, Play, Trash2, CheckCircle2, AlertTriangle, Skull } from 'lucide-react';
import { Link } from 'react-router-dom';

type SheetMode = 'failed' | 'zombie';

function healthBadge(signal: string) {
  switch (signal) {
    case 'zombie': return { label: 'Zombie', cls: 'border-destructive/40 text-destructive bg-destructive/5' };
    case 'exhausted': return { label: 'Max Retries', cls: 'border-destructive/40 text-destructive bg-destructive/5' };
    case 'retriable': return { label: 'Retriable', cls: 'border-warning/40 text-warning bg-warning/5' };
    case 'stale_lock': return { label: 'Stale Lock', cls: 'border-warning/40 text-warning bg-warning/5' };
    default: return { label: signal, cls: 'border-muted-foreground/40 text-muted-foreground' };
  }
}

function formatAge(minutes: number) {
  if (minutes > 1440) return `${Math.round(minutes / 1440)}d`;
  if (minutes > 60) return `${Math.round(minutes / 60)}h`;
  return `${minutes}min`;
}

function JobItem({ job, onAction, busy }: {
  job: AdminQueueJob;
  onAction: (jobId: string, action: string) => void;
  busy: boolean;
}) {
  const badge = healthBadge(job.health_signal);
  const isZombie = job.health_signal === 'zombie';
  const isExhausted = job.health_signal === 'exhausted';

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{job.job_type.replace(/_/g, ' ')}</div>
          <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
            {job.job_id.slice(0, 8)} · {formatAge(job.age_minutes)} alt · {job.attempts}/{job.max_attempts} Versuche
          </div>
          {job.package_title && (
            <Link
              to={`/admin/studio/${job.package_id}`}
              className="text-[10px] text-primary hover:underline flex items-center gap-0.5 mt-0.5"
            >
              {(job.package_title || '').replace(/^ExamFit\s*–\s*/i, '')} <ArrowRight className="h-2.5 w-2.5" />
            </Link>
          )}
        </div>
        <Badge variant="outline" className={cn("text-[9px] shrink-0", badge.cls)}>
          {badge.label}
        </Badge>
      </div>

      {/* Error */}
      {job.last_error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2">
          <div className="text-[11px] font-semibold text-destructive flex items-center gap-1 mb-0.5">
            <AlertTriangle className="h-3 w-3" /> Fehler
          </div>
          <div className="text-[10px] text-foreground break-words line-clamp-3">{job.last_error}</div>
        </div>
      )}

      {/* Diagnosis */}
      {isZombie && (
        <div className="rounded-lg border border-warning/20 bg-warning/5 p-2 text-xs text-foreground">
          Job hängt im Status „processing" ohne Fortschritt. Lock vermutlich verloren.
        </div>
      )}
      {isExhausted && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2 text-xs text-foreground">
          Maximale Wiederholungsversuche erreicht ({job.max_attempts}). Manuelles Eingreifen nötig.
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {(job.health_signal === 'retriable' || isExhausted) && (
          <Button
            size="sm" variant="outline" disabled={busy}
            className="text-xs h-8"
            onClick={() => onAction(job.job_id, 'retry')}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Play className="h-3 w-3 mr-1.5" />}
            Erneut versuchen
          </Button>
        )}
        {isZombie && (
          <Button
            size="sm" variant="outline" disabled={busy}
            className="text-xs h-8"
            onClick={() => onAction(job.job_id, 'kill_zombie')}
          >
            <Skull className="h-3 w-3 mr-1.5" />
            Zombie killen
          </Button>
        )}
        <Button
          size="sm" variant="outline" disabled={busy}
          className="text-xs h-8 border-destructive/30 text-destructive hover:bg-destructive/10"
          onClick={() => onAction(job.job_id, 'cancel')}
        >
          <Trash2 className="h-3 w-3 mr-1.5" />
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

export function FailedJobsSheet({ open, onOpenChange, mode = 'failed' }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: SheetMode;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: jobs } = useAdminQueueSSOT();

  const filtered = (jobs || []).filter(j => {
    if (mode === 'zombie') return j.health_signal === 'zombie';
    return j.job_status === 'failed';
  }).sort((a, b) => b.age_minutes - a.age_minutes);

  const isZombieMode = mode === 'zombie';

  const actionMutation = useMutation({
    mutationFn: async ({ jobId, action }: { jobId: string; action: string }) => {
      if (action === 'retry') {
        return runAdminOpsAction('requeue_failed_jobs', { job_ids: [jobId] });
      }
      if (action === 'kill_zombie') {
        return runAdminOpsAction('kill_stale_processing_jobs', { job_ids: [jobId] });
      }
      if (action === 'cancel') {
        return runAdminOpsAction('cancel_zombie_packages', { job_ids: [jobId] });
      }
      return null;
    },
    onSuccess: (_, vars) => {
      toast({ title: 'Aktion ausgeführt', description: `Job ${vars.jobId.slice(0, 8)} wurde ${vars.action === 'cancel' ? 'abgebrochen' : 'neu gestartet'}.` });
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    },
  });

  // Batch actions
  const batchMutation = useMutation({
    mutationFn: async () => {
      if (isZombieMode) {
        return runAdminOpsAction('kill_stale_processing_jobs', { limit: 50 });
      }
      return runAdminOpsAction('requeue_failed_jobs', { limit: 50 });
    },
    onSuccess: () => {
      toast({ title: 'Batch-Aktion', description: isZombieMode ? 'Alle Zombies gekillt.' : 'Alle failed Jobs requeued.' });
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg ">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {isZombieMode
              ? <><Skull className="h-5 w-5 text-destructive" /> Zombie Jobs ({filtered.length})</>
              : <><XCircle className="h-5 w-5 text-destructive" /> Failed Jobs ({filtered.length})</>
            }
          </SheetTitle>
        </SheetHeader>

        {/* Batch action */}
        {filtered.length > 1 && (
          <div className="mt-3">
            <Button
              size="sm" variant="outline" disabled={batchMutation.isPending}
              className="text-xs w-full"
              onClick={() => batchMutation.mutate()}
            >
              {batchMutation.isPending
                ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                : isZombieMode ? <Skull className="h-3 w-3 mr-1.5" /> : <Play className="h-3 w-3 mr-1.5" />
              }
              {isZombieMode ? `Alle ${filtered.length} Zombies killen` : `Alle ${filtered.length} Jobs neu starten`}
            </Button>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {filtered.length === 0 && (
            <div className="rounded-xl border border-success/20 bg-success/5 p-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <div className="text-sm text-foreground">
                {isZombieMode ? 'Keine Zombie-Jobs.' : 'Keine fehlgeschlagenen Jobs.'}
              </div>
            </div>
          )}
          {filtered.slice(0, 30).map(job => (
            <JobItem
              key={job.job_id}
              job={job}
              onAction={(jobId, action) => actionMutation.mutate({ jobId, action })}
              busy={actionMutation.isPending}
            />
          ))}
          {filtered.length > 30 && (
            <div className="text-[11px] text-muted-foreground text-center py-2">
              +{filtered.length - 30} weitere Jobs
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
