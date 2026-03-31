import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminPackagesSSOT, AdminPackageSSOT } from '@/hooks/useAdminPackagesSSOT';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { useToast } from '@/hooks/use-toast';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, ArrowRight, RotateCcw, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';

function PublishedItem({ pkg, onAction, busy }: {
  pkg: AdminPackageSSOT;
  onAction: (id: string, action: string, stepKey?: string) => void;
  busy: boolean;
}) {
  const publishedDate = pkg.published_at
    ? new Date(pkg.published_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : '—';

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
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
            {pkg.package_id.slice(0, 8)} · Veröffentlicht: {publishedDate}
          </div>
        </div>
        <Badge variant="outline" className="text-[9px] border-success/40 text-success bg-success/5 shrink-0">
          Published
        </Badge>
      </div>

      {/* Status details */}
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <span className="text-muted-foreground">
          Integrity: {pkg.integrity_passed ? '✅' : '❌'}
        </span>
        <span className="text-muted-foreground">
          Council: {pkg.council_approved ? '✅' : '❌'}
        </span>
        {pkg.total_questions > 0 && (
          <span className="text-muted-foreground">
            Fragen: {pkg.approved_questions}/{pkg.total_questions}
          </span>
        )}
      </div>

      {/* Re-check action */}
      <Button
        size="sm" variant="outline" disabled={busy}
        className="text-xs h-7"
        onClick={() => onAction(pkg.package_id, 'retry_stalled_step', 'run_integrity_check')}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <RotateCcw className="h-3 w-3 mr-1.5" />}
        Integrity neu prüfen
      </Button>
    </div>
  );
}

export function PublishedPackagesSheet({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: packages } = useAdminPackagesSSOT();

  const publishedPkgs = (packages || [])
    .filter(p => p.status === 'published' || p.is_published)
    .sort((a, b) => {
      const aDate = a.published_at ? new Date(a.published_at).getTime() : 0;
      const bDate = b.published_at ? new Date(b.published_at).getTime() : 0;
      return bDate - aDate;
    });

  const healMutation = useMutation({
    mutationFn: async ({ id, stepKey }: { id: string; stepKey?: string }) => {
      return runAdminOpsAction('retry_package_step', { package_id: id, step_key: stepKey || 'run_integrity_check' });
    },
    onSuccess: () => {
      toast({ title: 'Integrity-Check gestartet' });
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
            <CheckCircle2 className="h-5 w-5 text-success" />
            Veröffentlichte Pakete ({publishedPkgs.length})
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {publishedPkgs.length === 0 && (
            <div className="rounded-xl border border-muted bg-muted/30 p-4 text-sm text-muted-foreground">
              Keine veröffentlichten Pakete.
            </div>
          )}
          {publishedPkgs.map(pkg => (
            <PublishedItem
              key={pkg.package_id}
              pkg={pkg}
              onAction={(id, _action, stepKey) => healMutation.mutate({ id, stepKey })}
              busy={healMutation.isPending}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
