import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  AdminSheet as Sheet, AdminSheetContent as SheetContent,
  AdminSheetHeader as SheetHeader, AdminSheetTitle as SheetTitle,
} from '@/components/admin/AdminSheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Wrench, RotateCcw, AlertTriangle, CheckCircle2, ArrowRight, ShieldOff, Hammer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePackageHealAction } from '@/lib/admin/heal/usePackageHealAction';
import { recommendHeal } from '@/lib/admin/heal/healService';

interface BlockedPackage {
  id: string;
  title: string;
  score: number;
  status: string;
  block_reason: string;
  build_progress: number;
  hard_fail_reasons: string[];
  warnings: string[];
  readiness_score: number;
  qc_approved_pct: number;
  blocker_count: number;
}

// Legacy mapHardFailsToHealActions removed in v9 — replaced by recommendHeal() (SSOT).

function formatReasonCode(reason: string): { label: string; detail: string } {
  const colonIdx = reason.indexOf(':');
  if (colonIdx > 0) {
    return {
      label: reason.slice(0, colonIdx).trim(),
      detail: reason.slice(colonIdx + 1).trim(),
    };
  }
  return { label: reason, detail: '' };
}

function BlockedPackageItem({ pkg, onSoftReentry, onHardHeal, onUnblock, onContentGap, busy }: {
  pkg: BlockedPackage;
  onSoftReentry: (pkg: BlockedPackage) => void;
  onHardHeal: (pkg: BlockedPackage) => void;
  onUnblock: (packageId: string) => void;
  onContentGap: (packageId: string) => void;
  busy: boolean;
}) {
  const scoreTone = pkg.score >= 90 ? 'text-amber-500' : pkg.score >= 70 ? 'text-orange-500' : 'text-destructive';
  const isAdminHold = pkg.block_reason.startsWith('admin_hold');
  const recommendation = recommendHeal({
    hardFailReasons: pkg.hard_fail_reasons,
    blockReason: pkg.block_reason,
    isStuck: pkg.block_reason.includes('pipeline_repair_required') || pkg.block_reason.includes('repair_no_effect'),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/admin/studio/${pkg.id}`}
            className="text-sm font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1.5"
          >
            {pkg.title}
            <ArrowRight className="h-3 w-3 shrink-0" />
          </Link>
          <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
            {pkg.id.slice(0, 8)} · {pkg.build_progress}%
          </div>
        </div>
        <div className="text-right shrink-0">
          {isAdminHold ? (
            <Badge variant="outline" className="text-[10px] border-warning/50 text-warning">Hold</Badge>
          ) : (
            <>
              <div className={cn("text-lg font-bold", scoreTone)}>{pkg.score}</div>
              <div className="text-[10px] text-muted-foreground">Score</div>
            </>
          )}
        </div>
      </div>

      {isAdminHold ? (
        <div className="rounded-lg border border-warning/20 bg-warning/5 p-2">
          <div className="text-xs font-medium text-foreground">Admin Hold</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {pkg.block_reason.replace('admin_hold:', '').trim() || 'Manuell blockiert'}
          </div>
        </div>
      ) : (
        <>
          {pkg.hard_fail_reasons.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Blockadegründe
              </div>
              {pkg.hard_fail_reasons.map((reason, i) => {
                const { label, detail } = formatReasonCode(reason);
                return (
                  <div key={i} className="rounded-lg border border-destructive/20 bg-destructive/5 p-2">
                    <div className="text-xs font-medium text-foreground">{label}</div>
                    {detail && <div className="text-[11px] text-muted-foreground mt-0.5">{detail}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {pkg.warnings.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-warning flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Warnungen ({pkg.warnings.length})
              </div>
              {pkg.warnings.slice(0, 2).map((w, i) => {
                const { label, detail } = formatReasonCode(w);
                return (
                  <div key={i} className="rounded-lg border border-warning/20 bg-warning/5 p-2">
                    <div className="text-[11px] font-medium text-foreground">{label}</div>
                    {detail && <div className="text-[10px] text-muted-foreground mt-0.5">{detail}</div>}
                  </div>
                );
              })}
              {pkg.warnings.length > 2 && (
                <div className="text-[10px] text-muted-foreground pl-2">+{pkg.warnings.length - 2} weitere</div>
              )}
            </div>
          )}
        </>
      )}

      {/* SSOT Heal Actions */}
      <div className="space-y-1.5 pt-1 border-t border-border">
        <div className="text-[11px] font-semibold text-foreground flex items-center gap-1">
          <Wrench className="h-3 w-3" />
          Heal-Aktion (Empfehlung: {recommendation.mode === 'hard' ? 'Hard Heal' : 'Soft Reentry'})
        </div>
        <div className="text-[10px] text-muted-foreground italic">{recommendation.rationale}</div>

        {isAdminHold ? (
          <Button size="sm" variant="default" disabled={busy} onClick={() => onUnblock(pkg.id)} className="w-full">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
            Admin-Hold aufheben
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              size="sm"
              variant={recommendation.mode === 'soft' ? 'default' : 'outline'}
              disabled={busy}
              onClick={() => onSoftReentry(pkg)}
              title="reset_to_step ohne Job-Cancel"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Soft Reentry
            </Button>
            <Button
              size="sm"
              variant={recommendation.mode === 'hard' ? 'default' : 'outline'}
              disabled={busy}
              onClick={() => onHardHeal(pkg)}
              title="admin_manual_heal_package: Cancel Jobs + Reset + Clear blocked"
            >
              <Hammer className="h-3.5 w-3.5 mr-1.5" />
              Hard Heal
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onContentGap(pkg.id)}
              className="col-span-2 border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              Mark content_gap
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function BlockedPackagesSheet({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAdminHolds, setShowAdminHolds] = useState(false);

  const { data: blockedPackages = [], isLoading } = useQuery({
    queryKey: ['blocked-packages-detail'],
    queryFn: async () => {
      const sb = supabase as any;

      const { data: pkgs, error } = await sb
        .from('ops_blocked_packages')
        .select('package_id, title, integrity_report, status, block_reason, block_priority, build_progress');

      if (error) throw error;

      const ids = (pkgs || []).map((p: any) => p.package_id);
      const { data: blockers } = ids.length > 0
        ? await sb.from('ops_package_blockers').select('*').in('package_id', ids)
        : { data: [] };

      const blockerMap = new Map<string, any>();
      for (const b of blockers || []) {
        blockerMap.set(b.package_id, b);
      }

      return (pkgs || []).map((p: any) => {
        const report = p.integrity_report?.v3 || {};
        const summary = report.summary || {};
        const blocker = blockerMap.get(p.package_id);

        return {
          id: p.package_id,
          title: p.title || 'Unbenannt',
          status: p.status,
          block_reason: p.block_reason || 'unknown',
          build_progress: p.build_progress ?? 0,
          score: p.integrity_report?.score ?? 0,
          hard_fail_reasons: summary.hard_fail_reasons || [],
          warnings: report.warnings || [],
          readiness_score: blocker?.readiness_score ?? 0,
          qc_approved_pct: blocker?.qc_approved_pct ?? 0,
          blocker_count: blocker?.blocker_count ?? 0,
        } as BlockedPackage;
      }).sort((a: BlockedPackage, b: BlockedPackage) => {
        // Admin holds last
        const aHold = a.block_reason.startsWith('admin_hold') ? 1 : 0;
        const bHold = b.block_reason.startsWith('admin_hold') ? 1 : 0;
        if (aHold !== bHold) return aHold - bHold;
        return b.score - a.score;
      });
    },
    enabled: open,
    staleTime: 15_000,
  });

  const nonHoldPackages = blockedPackages.filter(p => !p.block_reason.startsWith('admin_hold'));
  const holdPackages = blockedPackages.filter(p => p.block_reason.startsWith('admin_hold'));
  const displayPackages = showAdminHolds ? holdPackages : nonHoldPackages;

  const heal = usePackageHealAction();

  const utilityMutation = useMutation({
    mutationFn: async ({ packageId, action }: { packageId: string; action: 'unblock_package' | 'mark_content_gap' }) => {
      if (action === 'mark_content_gap') {
        const reason = window.prompt('Begründung für content_gap (optional)') || 'manual_review_content_insufficient';
        return runAdminOpsAction('mark_content_gap', { package_id: packageId, reason });
      }
      return runAdminOpsAction('unblock_package', { package_id: packageId });
    },
    onSuccess: (_data, vars) => {
      toast({ title: vars.action === 'mark_content_gap' ? 'content_gap markiert' : 'Hold aufgehoben' });
      qc.invalidateQueries({ queryKey: ['blocked-packages-detail'] });
      qc.invalidateQueries({ queryKey: ['command-data'] });
    },
    onError: (err: Error) => toast({ title: 'Fehler', description: err.message, variant: 'destructive' }),
  });

  const triggerHeal = (pkg: BlockedPackage, mode: 'soft' | 'hard') => {
    const rec = recommendHeal({
      hardFailReasons: pkg.hard_fail_reasons,
      blockReason: pkg.block_reason,
      isStuck: pkg.block_reason.includes('pipeline_repair_required') || pkg.block_reason.includes('repair_no_effect'),
    });
    heal.mutate({
      packageId: pkg.id,
      mode,
      resetFromStep: rec.resetFromStep ?? 'run_integrity_check',
      reason: `blocked_packages_sheet:${mode}:${pkg.block_reason}`,
      cancelActiveJobs: mode === 'hard',
      enqueuePlan: mode === 'hard' ? rec.enqueuePlan : undefined,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Blockierte Pakete ({nonHoldPackages.length})
            {holdPackages.length > 0 && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                +{holdPackages.length} Admin-Hold
              </Badge>
            )}
          </SheetTitle>
        </SheetHeader>

        {/* Tab toggle */}
        {holdPackages.length > 0 && (
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant={!showAdminHolds ? 'default' : 'outline'}
              className="text-xs h-7"
              onClick={() => setShowAdminHolds(false)}
            >
              Blockiert ({nonHoldPackages.length})
            </Button>
            <Button
              size="sm"
              variant={showAdminHolds ? 'default' : 'outline'}
              className="text-xs h-7"
              onClick={() => setShowAdminHolds(true)}
            >
              <ShieldOff className="h-3 w-3 mr-1" />
              Admin-Hold ({holdPackages.length})
            </Button>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {isLoading && (
            <div className="text-sm text-muted-foreground">Lade blockierte Pakete…</div>
          )}

          {!isLoading && displayPackages.length === 0 && (
            <div className="rounded-xl border border-success/20 bg-success/5 p-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <div className="text-sm text-foreground">
                {showAdminHolds ? 'Keine Admin-Hold Pakete.' : 'Keine blockierten Pakete.'}
              </div>
            </div>
          )}

          {displayPackages.map((pkg) => (
            <BlockedPackageItem
              key={pkg.id}
              pkg={pkg}
              onSoftReentry={(p) => triggerHeal(p, 'soft')}
              onHardHeal={(p) => triggerHeal(p, 'hard')}
              onUnblock={(id) => utilityMutation.mutate({ packageId: id, action: 'unblock_package' })}
              onContentGap={(id) => utilityMutation.mutate({ packageId: id, action: 'mark_content_gap' })}
              busy={heal.isPending || utilityMutation.isPending}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
