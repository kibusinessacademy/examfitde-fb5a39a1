import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminPackagesSSOT, AdminPackageSSOT } from '@/hooks/useAdminPackagesSSOT';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingDown, ArrowRight, RotateCcw, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';

type DriftType = 'publish_drift' | 'stale_publish';

function DriftPackageItem({ pkg, driftType, onAction, busy }: {
  pkg: AdminPackageSSOT;
  driftType: DriftType;
  onAction: (id: string, action: string, stepKey?: string) => void;
  busy: boolean;
}) {
  const isDrift = driftType === 'publish_drift';

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
            {pkg.package_id.slice(0, 8)} · Status: {pkg.status}
          </div>
        </div>
        <Badge variant="outline" className={cn(
          "text-[10px] shrink-0",
          isDrift
            ? "border-destructive/40 text-destructive bg-destructive/5"
            : "border-warning/40 text-warning bg-warning/5"
        )}>
          {isDrift ? 'Publish Drift' : 'Stale Publish'}
        </Badge>
      </div>

      {/* Diagnosis */}
      <div className={cn(
        "rounded-lg border p-2",
        isDrift ? "border-destructive/20 bg-destructive/5" : "border-warning/20 bg-warning/5"
      )}>
        <div className="text-[11px] font-semibold flex items-center gap-1 mb-1" style={{ color: isDrift ? 'hsl(var(--destructive))' : 'hsl(var(--warning))' }}>
          {isDrift ? <TrendingDown className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          {isDrift ? 'Publish Drift' : 'Stale Publish'}
        </div>
        <div className="text-xs text-foreground">
          {isDrift
            ? 'Status ist „published", aber Publish-Gate inhaltlich nicht bestanden. Integrity oder Council fehlgeschlagen.'
            : 'Historischer Publish-Marker vorhanden, aber Paket nicht veröffentlicht. Möglicher Status-Mismatch.'}
        </div>
      </div>

      {/* Details */}
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <span className="text-muted-foreground">
          Integrity: {pkg.integrity_passed ? '✅ Passed' : '❌ Failed'}
        </span>
        <span className="text-muted-foreground">
          Council: {pkg.council_approved ? '✅ Approved' : '❌ Pending'}
        </span>
        <span className="text-muted-foreground">
          Progress: {pkg.build_progress ?? 0}%
        </span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {isDrift && !pkg.integrity_passed && (
          <Button
            size="sm" variant="outline" disabled={busy}
            className="text-xs h-8"
            onClick={() => onAction(pkg.package_id, 'retry_stalled_step', 'run_integrity_check')}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <RotateCcw className="h-3 w-3 mr-1.5" />}
            Integrity neu prüfen
          </Button>
        )}
        {isDrift && !pkg.council_approved && (
          <Button
            size="sm" variant="outline" disabled={busy}
            className="text-xs h-8"
            onClick={() => onAction(pkg.package_id, 'retry_stalled_step', 'quality_council')}
          >
            <RotateCcw className="h-3 w-3 mr-1.5" />
            Council neu starten
          </Button>
        )}
        {!isDrift && (
          <Button
            size="sm" variant="outline" disabled={busy}
            className="text-xs h-8"
            onClick={() => onAction(pkg.package_id, 'retry_stalled_step', 'auto_publish')}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <RotateCcw className="h-3 w-3 mr-1.5" />}
            Publish-Gate erneut prüfen
          </Button>
        )}
      </div>
    </div>
  );
}

export function PublishDriftSheet({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: packages } = useAdminPackagesSSOT();

  const driftPkgs = (packages || []).filter(p => p.has_publish_drift);
  const stalePkgs = (packages || []).filter(p => p.has_stale_publish && !p.has_publish_drift);
  const allPkgs = [...driftPkgs, ...stalePkgs];

  const healMutation = useMutation({
    mutationFn: async ({ id, action, stepKey }: { id: string; action: string; stepKey?: string }) => {
      return runAdminOpsAction('retry_package_step', { package_id: id, step_key: stepKey || 'run_integrity_check' });
    },
    onSuccess: () => {
      toast({ title: 'Aktion ausgeführt', description: 'Step wurde neu angestoßen.' });
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    },
  });

  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-destructive" />
            Publish-Probleme ({allPkgs.length})
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {allPkgs.length === 0 && (
            <div className="rounded-xl border border-success/20 bg-success/5 p-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <div className="text-sm text-foreground">Keine Publish-Probleme.</div>
            </div>
          )}
          {driftPkgs.map(pkg => (
            <DriftPackageItem
              key={pkg.package_id}
              pkg={pkg}
              driftType="publish_drift"
              onAction={(id, action, stepKey) => healMutation.mutate({ id, action, stepKey })}
              busy={healMutation.isPending}
            />
          ))}
          {stalePkgs.map(pkg => (
            <DriftPackageItem
              key={pkg.package_id}
              pkg={pkg}
              driftType="stale_publish"
              onAction={(id, action, stepKey) => healMutation.mutate({ id, action, stepKey })}
              busy={healMutation.isPending}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
