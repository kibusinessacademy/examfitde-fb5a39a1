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
import { Loader2, Wrench, RotateCcw, AlertTriangle, CheckCircle2, ArrowRight, ShieldOff } from 'lucide-react';
import { Link } from 'react-router-dom';

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

type HealAction = {
  key: string;
  label: string;
  description: string;
};

function mapHardFailsToHealActions(hardFails: string[], blockReason: string): HealAction[] {
  const actions: HealAction[] = [];
  const seen = new Set<string>();

  // For admin_hold, offer unblock
  if (blockReason.startsWith('admin_hold')) {
    actions.push({ key: 'unblock', label: 'Admin-Hold aufheben', description: 'Paket zurück in die Pipeline freigeben' });
    return actions;
  }

  for (const reason of hardFails) {
    const upper = reason.toUpperCase();

    if (upper.includes('MINICHECK_UNPARSED') || upper.includes('MINICHECK_EMPTY')) {
      if (!seen.has('repair_minichecks')) {
        actions.push({ key: 'repair_minichecks', label: 'MiniChecks reparieren', description: 'Leere/unparsed MiniChecks neu generieren' });
        seen.add('repair_minichecks');
      }
    }

    if (upper.includes('EASY_TOO_HIGH') || upper.includes('BLOOM_GATE') || upper.includes('TRAP_COVERAGE')) {
      if (!seen.has('repair_exam_pool_quality')) {
        actions.push({ key: 'repair_exam_pool_quality', label: 'Exam-Pool reparieren', description: 'Schwierigkeitsverteilung, Bloom-Level und Trap-Coverage korrigieren' });
        seen.add('repair_exam_pool_quality');
      }
    }

    if (upper.includes('HANDBOOK') || upper.includes('HANDBOOK_DEPTH')) {
      if (!seen.has('repair_handbook')) {
        actions.push({ key: 'repair_handbook', label: 'Handbuch reparieren', description: 'Handbuch-Tiefe auf Mindeststandard bringen' });
        seen.add('repair_handbook');
      }
    }

    if (upper.includes('ORAL_EXAM')) {
      if (!seen.has('repair_oral_exam')) {
        actions.push({ key: 'repair_oral_exam', label: 'Mündliche Prüfung reparieren', description: 'Oral-Exam-Blueprints neu generieren' });
        seen.add('repair_oral_exam');
      }
    }

    if (upper.includes('LESSON') || upper.includes('PLACEHOLDER') || upper.includes('TIER1_FAILED')) {
      if (!seen.has('repair_lessons')) {
        actions.push({ key: 'repair_lessons', label: 'Lektionen reparieren', description: 'Fehlende oder fehlerhafte Lektionen regenerieren' });
        seen.add('repair_lessons');
      }
    }
  }

  // Always offer rerun integrity as fallback
  if (actions.length === 0) {
    actions.push({ key: 'retry_stalled_step', label: 'Integrity neu prüfen', description: 'run_integrity_check erneut ausführen' });
  }

  return actions;
}

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

function BlockedPackageItem({ pkg, onHeal, busy }: {
  pkg: BlockedPackage;
  onHeal: (packageId: string, action: string, stepKey?: string) => void;
  busy: boolean;
}) {
  const healActions = mapHardFailsToHealActions(pkg.hard_fail_reasons, pkg.block_reason);
  const scoreTone = pkg.score >= 90 ? 'text-amber-500' : pkg.score >= 70 ? 'text-orange-500' : 'text-destructive';
  const isAdminHold = pkg.block_reason.startsWith('admin_hold');

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {/* Header */}
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

      {/* Block Reason */}
      {isAdminHold ? (
        <div className="rounded-lg border border-warning/20 bg-warning/5 p-2">
          <div className="text-xs font-medium text-foreground">Admin Hold</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {pkg.block_reason.replace('admin_hold:', '').trim() || 'Manuell blockiert'}
          </div>
        </div>
      ) : (
        <>
          {/* Hard Fail Reasons */}
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

          {/* Warnings (collapsed) */}
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

      {/* Heal Actions */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-foreground flex items-center gap-1">
          <Wrench className="h-3 w-3" />
          Reparatur-Optionen
        </div>
        <div className="grid gap-1.5">
          {healActions.map((action) => (
            <Button
              key={action.key}
              size="sm"
              variant="outline"
              className="justify-start h-auto py-2 px-3 text-left"
              disabled={busy}
              onClick={() => {
                if (action.key === 'retry_stalled_step') {
                  onHeal(pkg.id, action.key, 'run_integrity_check');
                } else if (action.key === 'unblock') {
                  onHeal(pkg.id, 'unblock_package');
                } else {
                  onHeal(pkg.id, action.key);
                }
              }}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2 shrink-0" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 mr-2 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-medium">{action.label}</div>
                <div className="text-[10px] text-muted-foreground">{action.description}</div>
              </div>
            </Button>
          ))}
        </div>
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

  const healMutation = useMutation({
    mutationFn: async ({ packageId, action, stepKey }: { packageId: string; action: string; stepKey?: string }) => {
      if (action === 'retry_stalled_step') {
        return runAdminOpsAction('retry_package_step', { package_id: packageId, step_key: stepKey || 'run_integrity_check' });
      }
      if (action === 'unblock_package') {
        return runAdminOpsAction('unblock_package' as any, { package_id: packageId });
      }
      return runAdminOpsAction(action as any, { package_id: packageId });
    },
    onSuccess: (_data, vars) => {
      toast({ title: 'Aktion gestartet', description: `Aktion "${vars.action}" für Paket wurde eingeplant.` });
      qc.invalidateQueries({ queryKey: ['blocked-packages-detail'] });
      qc.invalidateQueries({ queryKey: ['command-data'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    },
  });

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
              onHeal={(packageId, action, stepKey) =>
                healMutation.mutate({ packageId, action, stepKey })
              }
              busy={healMutation.isPending}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
