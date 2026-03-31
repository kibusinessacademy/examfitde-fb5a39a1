import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Wrench, RotateCcw, AlertTriangle, CheckCircle2, ArrowRight, Play } from 'lucide-react';
import { Link } from 'react-router-dom';

interface StuckPackage {
  id: string;
  title: string;
  status: string;
  stuck_reason: string;
  build_progress: number;
  steps_done: number;
  steps_total: number;
  current_step: string | null;
  stalled_steps: { step_key: string; status: string; attempts: number; last_error: string | null; age_min: number }[];
}

type HealAction = {
  key: string;
  label: string;
  description: string;
  stepKey?: string;
};

function deriveHealActions(pkg: StuckPackage): HealAction[] {
  const actions: HealAction[] = [];

  // Analyze stalled steps to suggest targeted heals
  for (const step of pkg.stalled_steps) {
    const sk = step.step_key;

    if (sk === 'generate_learning_content' && step.status === 'queued') {
      actions.push({
        key: 'restart_pipeline',
        label: 'Pipeline neu starten',
        description: `Status auf "building" setzen und ${sk} triggern`,
        stepKey: sk,
      });
    }

    if (sk.startsWith('validate_') && step.attempts >= 3) {
      actions.push({
        key: 'skip_validation',
        label: `${sk} überspringen`,
        description: `Validierung nach ${step.attempts} Versuchen überspringen`,
        stepKey: sk,
      });
    }

    if (sk === 'quality_council' && step.status === 'queued') {
      actions.push({
        key: 'retry_stalled_step',
        label: 'Council neu anstoßen',
        description: 'Quality Council Step erneut ausführen',
        stepKey: 'quality_council',
      });
    }
  }

  // Status mismatch heal
  if (pkg.status === 'council_review' && pkg.build_progress < 50) {
    actions.push({
      key: 'reset_to_building',
      label: 'Zurück auf "Building"',
      description: 'Status-Mismatch beheben: Paket ist nicht fertig für Council Review',
    });
  }

  // Always offer general retry
  if (actions.length === 0) {
    actions.push({
      key: 'retry_stalled_step',
      label: 'Nächsten Step triggern',
      description: 'Festgefahrenen Step zurücksetzen und neu starten',
      stepKey: pkg.stalled_steps[0]?.step_key,
    });
  }

  // Dedupe by key
  const seen = new Set<string>();
  return actions.filter(a => {
    const k = a.key + (a.stepKey || '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function StuckPackageItem({ pkg, onHeal, busy }: {
  pkg: StuckPackage;
  onHeal: (packageId: string, action: string, stepKey?: string) => void;
  busy: boolean;
}) {
  const healActions = deriveHealActions(pkg);

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
            {pkg.id.slice(0, 8)} · {pkg.status}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-foreground">{pkg.build_progress}%</div>
          <div className="text-[10px] text-muted-foreground">{pkg.steps_done}/{pkg.steps_total} Steps</div>
        </div>
      </div>

      {/* Stuck Reason */}
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-2">
        <div className="text-[11px] font-semibold text-destructive flex items-center gap-1 mb-1">
          <AlertTriangle className="h-3 w-3" />
          Festgefahren-Grund
        </div>
        <div className="text-xs text-foreground">{pkg.stuck_reason}</div>
      </div>

      {/* Stalled Steps */}
      {pkg.stalled_steps.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-muted-foreground">
            Wartende Steps ({pkg.stalled_steps.length})
          </div>
          {pkg.stalled_steps.slice(0, 4).map((step) => (
            <div key={step.step_key} className="rounded-lg border border-border bg-muted/30 p-2 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">{step.step_key}</div>
                <div className="text-[10px] text-muted-foreground">
                  {step.status} · {step.attempts} Versuch(e) · {step.age_min > 1440 ? `${Math.round(step.age_min / 1440)}d` : `${step.age_min}min`} alt
                </div>
                {step.last_error && (
                  <div className="text-[10px] text-destructive mt-0.5 truncate max-w-[250px]">{step.last_error}</div>
                )}
              </div>
              <Badge variant="outline" className={cn(
                "text-[9px] px-1.5 shrink-0 ml-2",
                step.status === 'queued' ? 'border-warning/40 text-warning' : 'border-muted-foreground/40 text-muted-foreground'
              )}>
                {step.status}
              </Badge>
            </div>
          ))}
          {pkg.stalled_steps.length > 4 && (
            <div className="text-[10px] text-muted-foreground pl-2">+{pkg.stalled_steps.length - 4} weitere</div>
          )}
        </div>
      )}

      {/* Heal Actions */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-foreground flex items-center gap-1">
          <Wrench className="h-3 w-3" />
          Reparatur-Optionen
        </div>
        <div className="grid gap-1.5">
          {healActions.map((action, i) => (
            <Button
              key={`${action.key}-${action.stepKey || i}`}
              size="sm"
              variant="outline"
              className="justify-start h-auto py-2 px-3 text-left"
              disabled={busy}
              onClick={() => onHeal(pkg.id, action.key, action.stepKey)}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2 shrink-0" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-2 shrink-0" />
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

      // Fetch packages with stuck_reason
      const { data: pkgs, error } = await sb
        .from('course_packages')
        .select('id, title, status, stuck_reason, build_progress')
        .not('stuck_reason', 'is', null)
        .neq('stuck_reason', '');

      if (error) throw error;
      if (!pkgs || pkgs.length === 0) return [];

      const ids = pkgs.map((p: any) => p.id);

      // Fetch all non-done steps for these packages
      const { data: steps } = await sb
        .from('package_steps')
        .select('package_id, step_key, status, attempts, last_error, updated_at, started_at')
        .in('package_id', ids)
        .not('status', 'in', '("done","skipped","blocked")');

      // Group steps by package
      const stepMap = new Map<string, any[]>();
      for (const s of steps || []) {
        if (!stepMap.has(s.package_id)) stepMap.set(s.package_id, []);
        stepMap.get(s.package_id)!.push(s);
      }

      // Fetch done step counts
      const { data: doneSteps } = await sb
        .from('package_steps')
        .select('package_id, step_key')
        .in('package_id', ids)
        .eq('status', 'done');

      const doneMap = new Map<string, number>();
      for (const s of doneSteps || []) {
        doneMap.set(s.package_id, (doneMap.get(s.package_id) || 0) + 1);
      }

      // Total steps per package
      const { data: allSteps } = await sb
        .from('package_steps')
        .select('package_id, step_key')
        .in('package_id', ids)
        .not('status', 'eq', 'skipped');

      const totalMap = new Map<string, number>();
      for (const s of allSteps || []) {
        totalMap.set(s.package_id, (totalMap.get(s.package_id) || 0) + 1);
      }

      return pkgs.map((p: any) => {
        const pSteps = stepMap.get(p.id) || [];
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
          id: p.id,
          title: p.title || 'Unbenannt',
          status: p.status,
          stuck_reason: p.stuck_reason,
          build_progress: p.build_progress || 0,
          steps_done: doneMap.get(p.id) || 0,
          steps_total: totalMap.get(p.id) || 0,
          current_step: stalledSteps[0]?.step_key || null,
          stalled_steps: stalledSteps,
        } as StuckPackage;
      });
    },
    enabled: open,
    staleTime: 15_000,
  });

  const healMutation = useMutation({
    mutationFn: async ({ packageId, action, stepKey }: { packageId: string; action: string; stepKey?: string }) => {
      if (action === 'reset_to_building') {
        // Route through edge function to handle unique constraint safely
        return runAdminOpsAction('retry_stalled_step', { package_id: packageId, step_key: stepKey || 'generate_learning_content' });
      }

      if (action === 'restart_pipeline') {
        // Route through edge function which archives conflicting packages first
        return runAdminOpsAction('retry_stalled_step', { package_id: packageId, step_key: stepKey || 'generate_learning_content' });
      }

      if (action === 'skip_validation') {
        return runAdminOpsAction('approve_step_exception', {
          package_id: packageId,
          step_key: stepKey || '',
          reason: 'Manuell übersprungen via Leitstelle (Stuck-Heal)',
        });
      }

      if (action === 'retry_stalled_step') {
        return runAdminOpsAction('retry_stalled_step', { package_id: packageId, step_key: stepKey || 'run_integrity_check' });
      }

      return runAdminOpsAction(action as any, { package_id: packageId });
    },
    onSuccess: (_data, vars) => {
      toast({ title: 'Reparatur gestartet', description: `Aktion "${vars.action}" für Paket wurde eingeplant.` });
      qc.invalidateQueries({ queryKey: ['stuck-packages-detail'] });
      qc.invalidateQueries({ queryKey: ['command-data'] });
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
