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
import { Loader2, Wrench, AlertTriangle, CheckCircle2, ArrowRight, Play, Eye, RefreshCw, Zap, SkipForward } from 'lucide-react';
import { Link } from 'react-router-dom';
import { RepairToolboxActions } from '@/components/admin/heal/RepairToolboxActions';

type StuckClass = 'active_processing' | 'claim_starvation' | 'no_jobs' | 'failed_jobs' | null;

interface StuckPackage {
  id: string;
  title: string;
  status: string;
  stuck_reason: string;
  stuck_class: StuckClass;
  build_progress: number;
  steps_done: number;
  steps_total: number;
  current_step: string | null;
  jobs_pending: number;
  jobs_processing: number;
  jobs_failed: number;
  stalled_steps: { step_key: string; status: string; attempts: number; last_error: string | null; age_min: number }[];
}

type HealAction = {
  key: string;
  label: string;
  description: string;
  icon: typeof Play;
  variant: 'default' | 'outline' | 'destructive';
  stepKey?: string;
};

/** Derives context-sensitive actions based on stuck_class (A-E classification) */
function deriveHealActions(pkg: StuckPackage): HealAction[] {
  const actions: HealAction[] = [];
  const sc = pkg.stuck_class;

  // ── Class A: Active Processing (false positive) ──
  if (sc === 'active_processing') {
    actions.push({
      key: 'observe',
      label: 'Live-Fortschritt öffnen',
      description: 'Paket wird gerade aktiv verarbeitet',
      icon: Eye,
      variant: 'outline',
    });
    return actions;
  }

  // ── Class B: Claim Starvation ──
  if (sc === 'claim_starvation') {
    actions.push({
      key: 'resume_pipeline',
      label: 'Pipeline fortsetzen',
      description: `${pkg.jobs_pending} Jobs warten auf Dispatch — Materializer anstoßen`,
      icon: Zap,
      variant: 'default',
    });
    return actions;
  }

  // ── Class: No Jobs at all ──
  if (sc === 'no_jobs') {
    actions.push({
      key: 'materialize_jobs',
      label: 'Jobs materialisieren',
      description: 'Keine aktiven Jobs — DAG-ready Steps als Jobs einstellen',
      icon: Zap,
      variant: 'default',
    });
    return actions;
  }

  // ── Class D: Failed Jobs blocking progress ──
  if (sc === 'failed_jobs') {
    actions.push({
      key: 'retry_failed',
      label: 'Fehlgeschlagene Jobs neu starten',
      description: `${pkg.jobs_failed} gescheiterte Jobs zurücksetzen`,
      icon: RefreshCw,
      variant: 'default',
    });
    return actions;
  }

  // ── Fallback: Determine from stalled_steps context ──
  const firstStep = pkg.stalled_steps[0];

  // Check if upstream/gate loop
  if (pkg.stuck_reason?.includes('awaiting upstream') || pkg.stuck_reason?.includes('GATE_FAIL')) {
    actions.push({
      key: 'repair_upstream',
      label: 'Upstream reparieren',
      description: 'Blockierten Upstream-Step zurücksetzen',
      icon: Wrench,
      variant: 'default',
      stepKey: firstStep?.step_key,
    });
    return actions;
  }

  // Check if council is actually the right next step (Class E)
  const isCouncilReady = firstStep?.step_key === 'quality_council' && pkg.build_progress >= 80;
  if (isCouncilReady) {
    actions.push({
      key: 'retry_stalled_step',
      label: 'Council neu anstoßen',
      description: 'Quality Council Step erneut ausführen',
      icon: Play,
      variant: 'default',
      stepKey: 'quality_council',
    });
    return actions;
  }

  // Generic: retry first stalled step
  if (firstStep) {
    actions.push({
      key: 'retry_stalled_step',
      label: `Step "${firstStep.step_key}" neu starten`,
      description: `Festgefahrenen Step zurücksetzen und neu ausführen`,
      icon: RefreshCw,
      variant: 'default',
      stepKey: firstStep.step_key,
    });
  }

  // Offer skip for validation steps with many attempts
  for (const step of pkg.stalled_steps) {
    if (step.step_key.startsWith('validate_') && step.attempts >= 3) {
      actions.push({
        key: 'skip_validation',
        label: `${step.step_key} überspringen`,
        description: `Nach ${step.attempts} Versuchen überspringen`,
        icon: SkipForward,
        variant: 'outline',
        stepKey: step.step_key,
      });
      break;
    }
  }

  if (actions.length === 0) {
    actions.push({
      key: 'retry_stalled_step',
      label: 'Nächsten Step triggern',
      description: 'Festgefahrenen Step zurücksetzen und neu starten',
      icon: Play,
      variant: 'default',
      stepKey: firstStep?.step_key,
    });
  }

  return actions;
}

function stuckClassLabel(sc: StuckClass): { text: string; className: string } {
  switch (sc) {
    case 'active_processing':
      return { text: 'Aktiv — kein Eingriff nötig', className: 'border-success/40 text-success bg-success/5' };
    case 'claim_starvation':
      return { text: 'Dispatch-Starvation', className: 'border-warning/40 text-warning bg-warning/5' };
    case 'no_jobs':
      return { text: 'Keine Jobs', className: 'border-destructive/40 text-destructive bg-destructive/5' };
    case 'failed_jobs':
      return { text: 'Fehlgeschlagene Jobs', className: 'border-destructive/40 text-destructive bg-destructive/5' };
    default:
      return { text: 'Unbekannt', className: 'border-muted-foreground/40 text-muted-foreground' };
  }
}

function StuckPackageItem({ pkg, onHeal, busy }: {
  pkg: StuckPackage;
  onHeal: (packageId: string, action: string, stepKey?: string) => void;
  busy: boolean;
}) {
  const healActions = deriveHealActions(pkg);
  const classInfo = stuckClassLabel(pkg.stuck_class);

  return (
    <div className={cn(
      "rounded-xl border bg-card p-4 space-y-3",
      pkg.stuck_class === 'active_processing' ? 'border-success/30' : 'border-border'
    )}>
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
            {pkg.id.slice(0, 8)} · {pkg.status} · Step: {pkg.current_step || '—'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-foreground">{pkg.build_progress}%</div>
          <div className="text-[10px] text-muted-foreground">{pkg.steps_done}/{pkg.steps_total} Steps</div>
        </div>
      </div>

      {/* Stuck Class Badge */}
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className={cn("text-[10px]", classInfo.className)}>
          {classInfo.text}
        </Badge>
        {pkg.jobs_pending > 0 && (
          <Badge variant="outline" className="text-[9px] border-muted-foreground/40 text-muted-foreground">
            {pkg.jobs_pending} pending
          </Badge>
        )}
        {pkg.jobs_processing > 0 && (
          <Badge variant="outline" className="text-[9px] border-primary/40 text-primary bg-primary/5">
            {pkg.jobs_processing} aktiv
          </Badge>
        )}
        {pkg.jobs_failed > 0 && (
          <Badge variant="outline" className="text-[9px] border-destructive/40 text-destructive bg-destructive/5">
            {pkg.jobs_failed} fehlgeschlagen
          </Badge>
        )}
      </div>

      {/* Stuck Reason (if present) */}
      {pkg.stuck_reason && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2">
          <div className="text-[11px] font-semibold text-destructive flex items-center gap-1 mb-0.5">
            <AlertTriangle className="h-3 w-3" />
            Festgefahren-Grund
          </div>
          <div className="text-xs text-foreground">{pkg.stuck_reason}</div>
        </div>
      )}

      {/* Stalled Steps (collapsed, max 3) */}
      {pkg.stalled_steps.length > 0 && pkg.stuck_class !== 'active_processing' && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold text-muted-foreground">
            Offene Steps ({pkg.stalled_steps.length})
          </div>
          {pkg.stalled_steps.slice(0, 3).map((step) => (
            <div key={step.step_key} className="rounded-lg border border-border bg-muted/30 p-1.5 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-foreground">{step.step_key}</div>
                <div className="text-[9px] text-muted-foreground">
                  {step.status} · {step.attempts} Vers. · {step.age_min > 1440 ? `${Math.round(step.age_min / 1440)}d` : `${step.age_min}min`}
                </div>
              </div>
              <Badge variant="outline" className={cn(
                "text-[9px] px-1.5 shrink-0 ml-2",
                step.status === 'queued' ? 'border-warning/40 text-warning' : 'border-muted-foreground/40 text-muted-foreground'
              )}>
                {step.status}
              </Badge>
            </div>
          ))}
          {pkg.stalled_steps.length > 3 && (
            <div className="text-[9px] text-muted-foreground pl-1">+{pkg.stalled_steps.length - 3} weitere</div>
          )}
        </div>
      )}

      {/* Context-Sensitive Actions */}
      <div className="grid gap-1.5">
        {healActions.map((action, i) => {
          const Icon = action.icon;
          return (
            <Button
              key={`${action.key}-${action.stepKey || i}`}
              size="sm"
              variant={action.variant}
              className={cn(
                "justify-start h-auto py-2 px-3 text-left",
                action.key === 'observe' && 'border-success/30 text-success hover:bg-success/10'
              )}
              disabled={busy}
              onClick={() => {
                if (action.key === 'observe') {
                  // Navigate instead of mutating
                  window.location.href = `/admin/studio/${pkg.id}`;
                  return;
                }
                onHeal(pkg.id, action.key, action.stepKey);
              }}
            >
              {busy && action.key !== 'observe' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2 shrink-0" />
              ) : (
                <Icon className="h-3.5 w-3.5 mr-2 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-medium">{action.label}</div>
                <div className="text-[10px] text-muted-foreground">{action.description}</div>
              </div>
            </Button>
          );
        })}
      </div>

      {/* v8 Repair Toolbox: Reset Exhaustion / content_gap / Hard Rebuild */}
      <div className="pt-2 border-t border-border">
        <div className="text-[10px] font-semibold text-muted-foreground mb-1.5">Heavy-Duty Reparatur</div>
        <RepairToolboxActions packageId={pkg.id} packageTitle={pkg.title} size="sm" variant="inline" />
      </div>
    </div>
  );
}

export function StuckPackagesSheet({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: stuckPackages = [], isLoading } = useQuery({
    queryKey: ['stuck-packages-detail'],
    queryFn: async () => {
      const sb = supabase as any;

      const { data: pkgs, error } = await sb
        .from('v_admin_packages_ssot')
        .select('package_id, canonical_title, raw_title, status, stuck_reason, stuck_class, build_progress, steps_done, steps_functional, jobs_pending, jobs_processing, jobs_failed, last_progress_at, updated_at, last_job_error')
        .eq('is_stuck', true)
        .order('last_progress_at', { ascending: true, nullsFirst: true });

      if (error) throw error;
      if (!pkgs || pkgs.length === 0) return [];

      const ids = pkgs.map((p: any) => p.package_id);

      const { data: steps } = await sb
        .from('package_steps')
        .select('package_id, step_key, status, attempts, last_error, updated_at, started_at')
        .in('package_id', ids)
        .not('status', 'in', '("done","skipped","blocked")');

      const stepMap = new Map<string, any[]>();
      for (const s of steps || []) {
        if (!stepMap.has(s.package_id)) stepMap.set(s.package_id, []);
        stepMap.get(s.package_id)!.push(s);
      }

      return pkgs.map((p: any) => {
        const pSteps = stepMap.get(p.package_id) || [];
        const stalledSteps = pSteps
          .map((s: any) => ({
            step_key: s.step_key,
            status: s.status,
            attempts: s.attempts || 0,
            last_error: s.last_error,
            age_min: Math.round((Date.now() - new Date(s.updated_at).getTime()) / 60000),
          }))
          .sort((a: any, b: any) => b.age_min - a.age_min);

        return {
          id: p.package_id,
          title: p.canonical_title || p.raw_title || 'Unbenannt',
          status: p.status,
          stuck_reason: p.stuck_reason || null,
          stuck_class: (p.stuck_class || null) as StuckClass,
          build_progress: p.build_progress || 0,
          steps_done: p.steps_done || 0,
          steps_total: p.steps_functional || 0,
          current_step: stalledSteps[0]?.step_key || null,
          jobs_pending: p.jobs_pending || 0,
          jobs_processing: p.jobs_processing || 0,
          jobs_failed: p.jobs_failed || 0,
          stalled_steps: stalledSteps,
        } as StuckPackage;
      });
    },
    enabled: open,
    staleTime: 15_000,
  });

  const healMutation = useMutation({
    mutationFn: async ({ packageId, action, stepKey }: { packageId: string; action: string; stepKey?: string }) => {
      // Find the actual first stalled step for this package
      const pkg = stuckPackages.find(p => p.id === packageId);
      const firstStalledStep = pkg?.stalled_steps?.[0]?.step_key;

      if (action === 'resume_pipeline') {
        const targetStep = stepKey || firstStalledStep || 'generate_learning_content';
        return runAdminOpsAction('retry_stalled_step', { package_id: packageId, step_key: targetStep });
      }
      if (action === 'materialize_jobs') {
        // Enqueue all DAG-ready steps sequentially
        const stalledSteps = pkg?.stalled_steps || [];
        const dagReady = stalledSteps.filter(s => s.status === 'queued').slice(0, 5);
        if (dagReady.length === 0) {
          const targetStep = firstStalledStep || 'generate_learning_content';
          return runAdminOpsAction('enqueue_single_step', { package_id: packageId, step_key: targetStep });
        }
        let lastResult: any;
        for (const step of dagReady) {
          try {
            lastResult = await runAdminOpsAction('enqueue_single_step', { package_id: packageId, step_key: step.step_key });
          } catch (e) {
            console.warn(`[materialize] failed for step ${step.step_key}:`, e);
          }
        }
        return lastResult ?? { ok: true, action: 'materialize_jobs', materialized: dagReady.length };
      }
      if (action === 'retry_failed') {
        return runAdminOpsAction('requeue_failed_jobs', { package_id: packageId });
      }
      if (action === 'repair_upstream') {
        const targetStep = stepKey || firstStalledStep || 'generate_learning_content';
        return runAdminOpsAction('retry_stalled_step', { package_id: packageId, step_key: targetStep });
      }
      if (action === 'skip_validation') {
        return runAdminOpsAction('approve_step_exception', {
          package_id: packageId,
          step_key: stepKey || '',
          reason: 'Manuell übersprungen via Leitstelle (Stuck-Heal)',
        });
      }
      if (action === 'retry_stalled_step') {
        const targetStep = stepKey || firstStalledStep || 'run_integrity_check';
        return runAdminOpsAction('retry_stalled_step', { package_id: packageId, step_key: targetStep });
      }
      return runAdminOpsAction(action as any, { package_id: packageId });
    },
    onSuccess: (_data, vars) => {
      toast({ title: 'Reparatur gestartet', description: `Aktion "${vars.action}" für Paket wurde eingeplant.` });
      qc.invalidateQueries({ queryKey: ['stuck-packages-detail'] });
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
            <AlertTriangle className="h-5 w-5 text-warning" />
            Festgefahrene Pakete ({stuckPackages.length})
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {isLoading && (
            <div className="text-sm text-muted-foreground">Lade festgefahrene Pakete…</div>
          )}

          {!isLoading && stuckPackages.length === 0 && (
            <div className="rounded-xl border border-success/20 bg-success/5 p-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <div className="text-sm text-foreground">Keine festgefahrenen Pakete.</div>
            </div>
          )}

          {stuckPackages.map((pkg) => (
            <StuckPackageItem
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
