/**
 * RepairExhaustedAlert — Prominent alert for packages where auto-repair
 * has exhausted its retry limit and requires manual intervention.
 * Shows directly at the top of the Leitstelle when such packages exist.
 */
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertOctagon, ArrowRight, RefreshCw, Loader2, Wrench, ShieldAlert, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExhaustedPackage {
  package_id: string;
  title: string;
  status: string;
  build_progress: number;
  attempts: number;
  consecutive_no_progress: number;
  hard_fail_reasons: string[];
  guard_state: string;
  last_validate_at: string | null;
}

function useRepairExhaustedPackages() {
  return useQuery({
    queryKey: ['admin', 'repair-exhausted'],
    queryFn: async (): Promise<ExhaustedPackage[]> => {
      // Query package_steps for validate_exam_pool with exhausted state
      const { data: steps, error } = await (supabase as any)
        .from('package_steps')
        .select('package_id, meta, attempts')
        .eq('step_key', 'validate_exam_pool')
        .not('meta', 'is', null);

      if (error) throw error;

      // Filter for exhausted packages
      const exhausted = (steps || []).filter((s: any) => {
        const meta = s.meta || {};
        return (
          meta.guard_state === 'hard_stalled' ||
          (meta.reason_codes && (meta.reason_codes as string[]).includes('HARD_FAIL_REPAIR_EXHAUSTED')) ||
          (meta.consecutive_no_progress && meta.consecutive_no_progress >= 10)
        );
      });

      if (exhausted.length === 0) return [];

      // Get package details
      const ids = exhausted.map((s: any) => s.package_id);
      const { data: pkgs } = await (supabase as any)
        .from('v_admin_packages_ssot')
        .select('package_id, canonical_title, raw_title, status, build_progress')
        .in('package_id', ids);

      const pkgMap = new Map<string, any>();
      for (const p of pkgs || []) pkgMap.set(p.package_id, p);

      // Get integrity reports for hard_fail_reasons
      const { data: cpkgs } = await (supabase as any)
        .from('course_packages')
        .select('id, integrity_report')
        .in('id', ids);

      const reportMap = new Map<string, any>();
      for (const c of cpkgs || []) reportMap.set(c.id, c.integrity_report);

      return exhausted.map((s: any) => {
        const pkg = pkgMap.get(s.package_id) || {};
        const report = reportMap.get(s.package_id);
        const summary = report?.v3?.summary || {};

        return {
          package_id: s.package_id,
          title: pkg.canonical_title || pkg.raw_title || 'Unbenannt',
          status: pkg.status || 'unknown',
          build_progress: pkg.build_progress ?? 0,
          attempts: s.attempts || 0,
          consecutive_no_progress: s.meta?.consecutive_no_progress || 0,
          hard_fail_reasons: summary.hard_fail_reasons || [],
          guard_state: s.meta?.guard_state || 'unknown',
          last_validate_at: s.meta?.last_validate_completed_at || null,
        };
      });
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

function ExhaustedPackageRow({ pkg, onRepair, busy }: {
  pkg: ExhaustedPackage;
  onRepair: (packageId: string, action: string) => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={`/admin/studio/${pkg.package_id}`}
            className="text-sm font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1"
          >
            {pkg.title}
            <ArrowRight className="h-3 w-3 shrink-0" />
          </Link>
          <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
            {pkg.package_id.slice(0, 8)} · {pkg.build_progress}% · {pkg.consecutive_no_progress} Versuche ohne Fortschritt
          </div>
        </div>
        <Badge variant="destructive" className="text-[10px] shrink-0">
          Exhausted
        </Badge>
      </div>

      {/* Fail reasons compact */}
      {pkg.hard_fail_reasons.length > 0 && (
        <div className="space-y-1">
          {pkg.hard_fail_reasons.map((reason, i) => {
            const colonIdx = reason.indexOf(':');
            const label = colonIdx > 0 ? reason.slice(0, colonIdx).trim() : reason;
            const detail = colonIdx > 0 ? reason.slice(colonIdx + 1).trim() : '';
            return (
              <div key={i} className="text-[11px] text-destructive/90">
                <span className="font-medium">{label}</span>
                {detail && <span className="text-muted-foreground ml-1">— {detail}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <Button
          size="sm"
          variant="destructive"
          className="h-7 text-[11px] gap-1"
          disabled={busy}
          onClick={() => onRepair(pkg.package_id, 'force_pool_fill')}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          Force Pool-Fill
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] gap-1"
          disabled={busy}
          onClick={() => onRepair(pkg.package_id, 'repair_exam_pool_quality')}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
          Exam-Pool reparieren
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] gap-1"
          disabled={busy}
          onClick={() => onRepair(pkg.package_id, 'retry_validate')}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Validate Reset
        </Button>
      </div>
    </div>
  );
}

export function RepairExhaustedAlert() {
  const { data: exhausted = [] } = useRepairExhaustedPackages();
  const qc = useQueryClient();

  const repairMutation = useMutation({
    mutationFn: async ({ packageId, action }: { packageId: string; action: string }) => {
      if (action === 'force_pool_fill') {
        // Reset the exhaustion guard and re-enqueue pool fill
        await runAdminOpsAction('repair_exam_pool_quality', { package_id: packageId });
        // Also reset the validate step to clear stall counters
        return runAdminOpsAction('retry_package_step', { package_id: packageId, step_key: 'validate_exam_pool' });
      }
      if (action === 'retry_validate') {
        return runAdminOpsAction('retry_package_step', { package_id: packageId, step_key: 'validate_exam_pool' });
      }
      return runAdminOpsAction(action as any, { package_id: packageId });
    },
    onSuccess: (_data, vars) => {
      toast.success(`Reparatur für ${vars.packageId.slice(0, 8)} gestartet`);
      qc.invalidateQueries({ queryKey: ['admin', 'repair-exhausted'] });
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['command-data'] });
    },
    onError: (err: Error) => {
      toast.error(`Fehler: ${err.message}`);
    },
  });

  if (exhausted.length === 0) return null;

  return (
    <div className="rounded-xl border-2 border-destructive/50 bg-destructive/5 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-500">
      <div className="flex items-center gap-2">
        <AlertOctagon className="h-5 w-5 text-destructive shrink-0" />
        <div>
          <div className="text-sm font-bold text-destructive">
            {exhausted.length} Paket{exhausted.length > 1 ? 'e' : ''}: Auto-Repair Limit erreicht
          </div>
          <div className="text-[11px] text-muted-foreground">
            Diese Pakete haben die maximale Anzahl automatischer Reparaturversuche überschritten. Manuelles Eingreifen erforderlich.
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {exhausted.map((pkg) => (
          <ExhaustedPackageRow
            key={pkg.package_id}
            pkg={pkg}
            onRepair={(packageId, action) =>
              repairMutation.mutate({ packageId, action })
            }
            busy={repairMutation.isPending}
          />
        ))}
      </div>
    </div>
  );
}

export default RepairExhaustedAlert;
