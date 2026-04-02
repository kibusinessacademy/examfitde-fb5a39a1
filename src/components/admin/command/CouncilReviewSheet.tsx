import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminPackagesSSOT, AdminPackageSSOT } from '@/hooks/useAdminPackagesSSOT';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  AdminSheet as Sheet, AdminSheetContent as SheetContent,
  AdminSheetHeader as SheetHeader, AdminSheetTitle as SheetTitle,
} from '@/components/admin/AdminSheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Shield, ArrowRight, Play, CheckCircle2, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';

function CouncilPackageItem({ pkg, onAction, busy }: {
  pkg: AdminPackageSSOT;
  onAction: (id: string, action: string, stepKey?: string) => void;
  busy: boolean;
}) {
  const progress = pkg.build_progress ?? 0;
  const sessionsInfo = `${pkg.council_sessions_approved}/${pkg.council_sessions_total} approved`;
  const isCompleteNotApproved = pkg.council_complete && !pkg.council_approved;

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
            {pkg.package_id.slice(0, 8)} · {progress}% gebaut
          </div>
        </div>
        <Badge variant="outline" className={cn(
          "text-[10px] shrink-0",
          isCompleteNotApproved
            ? "border-warning/40 text-warning bg-warning/5"
            : pkg.council_approved
              ? "border-success/40 text-success bg-success/5"
              : "border-primary/40 text-primary bg-primary/5"
        )}>
          {isCompleteNotApproved ? 'Nicht approved' : pkg.council_approved ? 'Approved' : 'In Review'}
        </Badge>
      </div>

      {/* Council Sessions */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <div>
          <div className="text-sm font-bold text-foreground">{pkg.council_sessions_total}</div>
          <div className="text-[9px] text-muted-foreground">Gesamt</div>
        </div>
        <div>
          <div className="text-sm font-bold text-warning">{pkg.council_sessions_pending}</div>
          <div className="text-[9px] text-muted-foreground">Pending</div>
        </div>
        <div>
          <div className="text-sm font-bold text-primary">{pkg.council_sessions_processing}</div>
          <div className="text-[9px] text-muted-foreground">Laufend</div>
        </div>
        <div>
          <div className="text-sm font-bold text-success">{pkg.council_sessions_approved}</div>
          <div className="text-[9px] text-muted-foreground">Approved</div>
        </div>
      </div>

      {/* Exam questions info */}
      {pkg.total_questions > 0 && (
        <div className="text-[11px] text-muted-foreground">
          Fragen: {pkg.approved_questions}/{pkg.total_questions} approved ({Math.round(pkg.approved_questions / pkg.total_questions * 100)}%)
        </div>
      )}

      {/* Diagnosis */}
      {isCompleteNotApproved && (
        <div className="rounded-lg border border-warning/20 bg-warning/5 p-2">
          <div className="text-xs font-medium text-foreground">Council abgeschlossen, aber nicht approved</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Möglicherweise fehlt die automatische Approval-Logik oder Sessions wurden abgelehnt.
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {pkg.council_sessions_pending > 0 && (
          <Button
            size="sm" variant="outline" disabled={busy}
            className="text-xs h-8"
            onClick={() => onAction(pkg.package_id, 'retry_stalled_step', 'quality_council')}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Play className="h-3 w-3 mr-1.5" />}
            Council neu anstoßen
          </Button>
        )}
        {isCompleteNotApproved && (
          <Button
            size="sm" variant="outline" disabled={busy}
            className="text-xs h-8"
            onClick={() => onAction(pkg.package_id, 'retry_stalled_step', 'run_integrity_check')}
          >
            <RotateCcw className="h-3 w-3 mr-1.5" />
            Integrity prüfen
          </Button>
        )}
      </div>
    </div>
  );
}

export function CouncilReviewSheet({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: packages } = useAdminPackagesSSOT();

  const councilPkgs = (packages || [])
    .filter(p => p.status === 'council_review' || (p.council_complete && !p.council_approved))
    .sort((a, b) => {
      // Sort: not-approved first, then by pending sessions
      const aUrgent = a.council_complete && !a.council_approved ? 1 : 0;
      const bUrgent = b.council_complete && !b.council_approved ? 1 : 0;
      if (aUrgent !== bUrgent) return bUrgent - aUrgent;
      return b.council_sessions_pending - a.council_sessions_pending;
    });

  const healMutation = useMutation({
    mutationFn: async ({ id, action, stepKey }: { id: string; action: string; stepKey?: string }) => {
      return runAdminOpsAction('retry_package_step', { package_id: id, step_key: stepKey || 'quality_council' });
    },
    onSuccess: () => {
      toast({ title: 'Aktion ausgeführt', description: 'Council-Step wurde neu angestoßen.' });
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
            <Shield className="h-5 w-5 text-warning" />
            Council Review ({councilPkgs.length})
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {councilPkgs.length === 0 && (
            <div className="rounded-xl border border-muted bg-muted/30 p-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
              <div className="text-sm text-muted-foreground">Keine Pakete in Council Review.</div>
            </div>
          )}
          {councilPkgs.map(pkg => (
            <CouncilPackageItem
              key={pkg.package_id}
              pkg={pkg}
              onAction={(id, action, stepKey) => healMutation.mutate({ id, action, stepKey })}
              busy={healMutation.isPending}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
