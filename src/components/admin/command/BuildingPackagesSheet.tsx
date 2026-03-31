import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminPackagesSSOT, AdminPackageSSOT } from '@/hooks/useAdminPackagesSSOT';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Activity, ArrowRight, XCircle, Play, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

function progressTone(p: number) {
  if (p >= 80) return 'text-success';
  if (p >= 40) return 'text-primary';
  return 'text-muted-foreground';
}

function BuildingPackageItem({ pkg, onAction, busy }: {
  pkg: AdminPackageSSOT;
  onAction: (id: string, action: string, stepKey?: string) => void;
  busy: boolean;
}) {
  const progress = pkg.build_progress ?? 0;
  const hasFailedJobs = pkg.jobs_failed > 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/admin/studio/${pkg.package_id}`}
            className="text-sm font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1.5"
          >
            {pkg.canonical_title || pkg.raw_title || 'Unbenannt'}
            <ArrowRight className="h-3 w-3 shrink-0" />
          </Link>
          <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
            {pkg.package_id.slice(0, 8)} · Step: {pkg.current_step || '—'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={cn("text-lg font-bold", progressTone(progress))}>{progress}%</div>
          <div className="text-[10px] text-muted-foreground">{pkg.steps_done}/{pkg.steps_functional}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>

      {/* Status badges */}
      <div className="flex flex-wrap gap-1">
        {pkg.jobs_processing > 0 && (
          <Badge variant="outline" className="text-[9px] border-primary/40 text-primary bg-primary/5">
            {pkg.jobs_processing} Jobs aktiv
          </Badge>
        )}
        {pkg.jobs_pending > 0 && (
          <Badge variant="outline" className="text-[9px] border-muted-foreground/40 text-muted-foreground">
            {pkg.jobs_pending} pending
          </Badge>
        )}
        {hasFailedJobs && (
          <Badge variant="outline" className="text-[9px] border-destructive/40 text-destructive bg-destructive/5">
            {pkg.jobs_failed} fehlgeschlagen
          </Badge>
        )}
        {pkg.last_error && (
          <div className="w-full text-[10px] text-destructive mt-1 truncate">{pkg.last_error}</div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {hasFailedJobs && (
          <Button
            size="sm" variant="outline" disabled={busy}
            className="text-xs h-8"
            onClick={() => onAction(pkg.package_id, 'requeue_failed')}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Play className="h-3 w-3 mr-1.5" />}
            Failed Jobs neu starten
          </Button>
        )}
        <Button
          size="sm" variant="outline" disabled={busy}
          className="text-xs h-8 border-destructive/30 text-destructive hover:bg-destructive/10"
          onClick={() => onAction(pkg.package_id, 'cancel_build')}
        >
          <XCircle className="h-3 w-3 mr-1.5" />
          Build abbrechen
        </Button>
      </div>
    </div>
  );
}

export function BuildingPackagesSheet({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: packages } = useAdminPackagesSSOT();

  const buildingPkgs = (packages || [])
    .filter(p => p.status === 'building')
    .sort((a, b) => (b.build_progress ?? 0) - (a.build_progress ?? 0));

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      if (action === 'cancel_build') {
        return runAdminOpsAction('cancel_package_build', { package_id: id });
      }
      if (action === 'requeue_failed') {
        return runAdminOpsAction('requeue_failed_jobs', { package_id: id });
      }
      return runAdminOpsAction(action as any, { package_id: id });
    },
    onSuccess: (_, vars) => {
      toast({ title: 'Aktion ausgeführt', description: `"${vars.action}" für Paket gestartet.` });
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Aktive Builds ({buildingPkgs.length})
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {buildingPkgs.length === 0 && (
            <div className="rounded-xl border border-muted bg-muted/30 p-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
              <div className="text-sm text-muted-foreground">Keine aktiven Builds.</div>
            </div>
          )}
          {buildingPkgs.map(pkg => (
            <BuildingPackageItem
              key={pkg.package_id}
              pkg={pkg}
              onAction={(id, action) => actionMutation.mutate({ id, action })}
              busy={actionMutation.isPending}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
