import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminRpc } from '@/integrations/supabase/admin-rpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import {
  BarChart3, AlertTriangle, ChevronDown, ChevronRight,
  ArrowRight, RefreshCw, ShieldAlert, Info, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const signalStyle = {
  ok: 'border-success/40 text-success bg-success/5',
  warn: 'border-warning/40 text-warning bg-warning/5',
  hard_fail: 'border-destructive/40 text-destructive bg-destructive/5',
  insufficient_sample: 'border-muted-foreground/30 text-muted-foreground bg-muted/30',
} as const;

const signalLabel = {
  ok: 'OK',
  warn: 'Warnung',
  hard_fail: 'Hard Fail',
  insufficient_sample: 'Zu wenig Daten',
} as const;

const anomalyLabels: Record<string, { label: string; tone: 'red' | 'yellow' }> = {
  NO_CALCULATION_TRAP: { label: 'Kein Calc-Trap', tone: 'red' },
  NO_TYPICAL_ERROR: { label: 'Kein Typical-Error', tone: 'red' },
  NO_MISCONCEPTION: { label: 'Kein Misconception', tone: 'red' },
  OVERWEIGHT_MISCONCEPTION: { label: 'Zu viel Misconception', tone: 'yellow' },
  OVERWEIGHT_TYPICAL_ERROR: { label: 'Zu viel Typical-Error', tone: 'yellow' },
  OVERWEIGHT_CALCULATION_TRAP: { label: 'Zu viel Calc-Trap', tone: 'yellow' },
  MULTI_WARN: { label: 'Multi-Warn', tone: 'red' },
  HARD_FAIL_PRESENT: { label: 'Hard-Fail', tone: 'red' },
  PROFILE_MISMATCH_SUSPECTED: { label: 'Profil-Mismatch', tone: 'red' },
  INSUFFICIENT_SAMPLE: { label: 'Kleiner Pool', tone: 'yellow' },
};

type AuditPackage = {
  package_id: string;
  title: string | null;
  curriculum_id: string;
  track: string;
  profile: string;
  resolved_from: string;
  approved_total: number;
  actual_counts: Record<string, number>;
  actual_pct: Record<string, number>;
  details: Array<{
    trap_type: string;
    actual_pct: number;
    target_pct: number;
    signal: 'ok' | 'warn' | 'hard_fail';
    reason?: string;
  }>;
  anomaly_flags: string[];
  overall: 'ok' | 'warn' | 'hard_fail' | 'insufficient_sample';
  rebalance_recommended: boolean;
  recommended_focus: string[];
};

function FallbackWarning({ resolvedFrom }: { resolvedFrom: string }) {
  if (!resolvedFrom.includes('fallback')) return null;
  return (
    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-destructive/50 text-destructive bg-destructive/5">
      ⚠ Fallback-Regeln
    </Badge>
  );
}

function DistributionBar({ details }: { details: AuditPackage['details'] }) {
  const types = ['misconception', 'typical_error', 'calculation_trap'];
  const colors: Record<string, string> = {
    misconception: 'bg-primary',
    typical_error: 'bg-warning',
    calculation_trap: 'bg-accent',
  };

  return (
    <div className="flex h-2 rounded-full overflow-hidden bg-muted gap-px">
      {types.map(t => {
        const d = details.find(dd => dd.trap_type === t);
        if (!d || d.actual_pct === 0) return null;
        return (
          <div
            key={t}
            className={cn('h-full rounded-sm', colors[t] || 'bg-muted-foreground')}
            style={{ width: `${d.actual_pct}%` }}
            title={`${t}: ${d.actual_pct}%`}
          />
        );
      })}
    </div>
  );
}

function PackageRow({ pkg }: { pkg: AuditPackage }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const rebalanceMutation = useMutation({
    mutationFn: () => adminRpc.triggerExamRebalance(pkg.package_id),
    onSuccess: (data) => {
      toast.success(`Rebalance abgeschlossen: ${data.actions?.length || 0} Aktionen`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'trap-quality-audit'] });
    },
    onError: (err: Error) => toast.error(`Rebalance fehlgeschlagen: ${err.message}`),
  });

  const overall = pkg.overall as keyof typeof signalStyle;
  const isFallback = pkg.resolved_from.includes('fallback');

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full p-2.5 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {expanded
                ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
              }
              <span className="text-xs font-semibold text-foreground truncate">
                {pkg.title ?? pkg.package_id.slice(0, 12)}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground font-mono mt-0.5 ml-4.5">
              {pkg.track} · {pkg.profile} · {pkg.approved_total} Fragen
            </div>
          </div>
          <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4 shrink-0", signalStyle[overall])}>
            {signalLabel[overall]}
          </Badge>
        </div>

        {/* Mini bar */}
        {pkg.details.length > 0 && (
          <div className="mt-1.5 ml-4.5">
            <DistributionBar details={pkg.details} />
          </div>
        )}

        {/* Flags row */}
        {(pkg.anomaly_flags.length > 0 || isFallback) && (
          <div className="flex flex-wrap gap-1 mt-1.5 ml-4.5">
            <FallbackWarning resolvedFrom={pkg.resolved_from} />
            {pkg.anomaly_flags
              .filter(f => f !== 'INSUFFICIENT_SAMPLE')
              .map(flag => {
                const cfg = anomalyLabels[flag];
                if (!cfg) return null;
                return (
                  <Badge
                    key={flag}
                    variant="outline"
                    className={cn(
                      "text-[9px] px-1.5 py-0 h-4",
                      cfg.tone === 'red'
                        ? 'border-destructive/40 text-destructive bg-destructive/5'
                        : 'border-warning/40 text-warning bg-warning/5'
                    )}
                  >
                    {cfg.label}
                  </Badge>
                );
              })}
          </div>
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border p-2.5 space-y-2">
          {/* Resolver info */}
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Info className="h-3 w-3 shrink-0" />
            <span>Regelquelle: <span className={cn("font-mono", isFallback && "text-destructive font-semibold")}>{pkg.resolved_from}</span></span>
          </div>

          {/* Detail table */}
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground">
                  <th className="text-left px-2 py-1 font-medium">Typ</th>
                  <th className="text-right px-2 py-1 font-medium">Ist %</th>
                  <th className="text-right px-2 py-1 font-medium">Ziel %</th>
                  <th className="text-center px-2 py-1 font-medium">Signal</th>
                </tr>
              </thead>
              <tbody>
                {pkg.details.map(d => (
                  <tr key={d.trap_type} className="border-t border-border">
                    <td className="px-2 py-1 font-mono">{d.trap_type}</td>
                    <td className="text-right px-2 py-1 font-mono">{d.actual_pct}%</td>
                    <td className="text-right px-2 py-1 text-muted-foreground">{d.target_pct}%</td>
                    <td className="text-center px-2 py-1">
                      <Badge
                        variant="outline"
                        className={cn("text-[8px] px-1 py-0 h-3.5", signalStyle[d.signal])}
                      >
                        {signalLabel[d.signal]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Reasons */}
          {pkg.details.filter(d => d.reason).map(d => (
            <div key={d.trap_type} className="text-[9px] text-muted-foreground px-2">↳ {d.reason}</div>
          ))}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Link
              to={`/admin/studio/${pkg.package_id}`}
              className="text-[10px] text-primary hover:underline flex items-center gap-1"
            >
              Paket öffnen <ArrowRight className="h-3 w-3" />
            </Link>
            {pkg.rebalance_recommended && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2 gap-1"
                disabled={rebalanceMutation.isPending}
                onClick={(e) => { e.stopPropagation(); rebalanceMutation.mutate(); }}
              >
                {rebalanceMutation.isPending
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <RefreshCw className="h-3 w-3" />
                }
                Rebalance
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TrapDistributionAuditCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'trap-quality-audit'],
    queryFn: () => adminRpc.trapQualityAudit(),
    refetchInterval: 60_000,
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  const packages = data?.packages ?? [];
  const global = data?.global;

  // Only show packages that aren't ok
  const relevantPackages = packages.filter(
    (p: AuditPackage) => p.overall !== 'ok'
  );

  if (relevantPackages.length === 0 && global) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/5 p-3 flex items-center gap-3">
        <BarChart3 className="h-4 w-4 text-success shrink-0" />
        <div>
          <div className="text-sm font-semibold text-foreground">Trap-Verteilung OK</div>
          <div className="text-[11px] text-muted-foreground">
            Alle {global.packages_total} Pakete innerhalb der Zielkorridore.
          </div>
        </div>
      </div>
    );
  }

  const hardFails = relevantPackages.filter((p: AuditPackage) => p.overall === 'hard_fail');
  const warns = relevantPackages.filter((p: AuditPackage) => p.overall === 'warn');
  const insufficient = relevantPackages.filter((p: AuditPackage) => p.overall === 'insufficient_sample');

  // Check for any fallback-resolved packages
  const fallbackCount = packages.filter((p: AuditPackage) => p.resolved_from.includes('fallback')).length;

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground">
          Trap-Verteilung Audit
        </span>
        <div className="flex gap-1.5 ml-auto">
          {global && global.packages_hard_fail > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-destructive/40 text-destructive bg-destructive/5">
              {global.packages_hard_fail} Hard-Fail
            </Badge>
          )}
          {global && global.packages_warn > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-warning/40 text-warning bg-warning/5">
              {global.packages_warn} Warn
            </Badge>
          )}
          {insufficient.length > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-muted-foreground/30 text-muted-foreground">
              {insufficient.length} klein
            </Badge>
          )}
        </div>
      </div>

      {/* Fallback warning */}
      {fallbackCount > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 flex items-start gap-2">
          <ShieldAlert className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <div className="text-[10px] text-foreground">
            <span className="font-semibold">{fallbackCount} Paket(e)</span> nutzen Fallback-Regeln statt SSOT-Konfiguration.
            <span className="text-muted-foreground"> Regelwerk für diese Tracks/Curricula fehlt.</span>
          </div>
        </div>
      )}

      {/* Package list: hard_fail → warn → insufficient */}
      <div className="space-y-1.5">
        {[...hardFails, ...warns, ...insufficient].slice(0, 12).map((pkg: AuditPackage) => (
          <PackageRow key={pkg.package_id} pkg={pkg} />
        ))}
      </div>

      {relevantPackages.length > 12 && (
        <div className="text-[10px] text-muted-foreground text-center">
          + {relevantPackages.length - 12} weitere Pakete
        </div>
      )}
    </div>
  );
}