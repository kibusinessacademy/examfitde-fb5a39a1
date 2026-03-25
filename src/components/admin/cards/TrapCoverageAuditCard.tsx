import { useQuery } from '@tanstack/react-query';
import { adminRpc } from '@/integrations/supabase/admin-rpc';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { ShieldCheck, AlertTriangle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const riskConfig = {
  critical: { label: 'Kritisch', cls: 'border-destructive/40 text-destructive bg-destructive/5' },
  high: { label: 'Hoch', cls: 'border-warning/40 text-warning bg-warning/5' },
  medium: { label: 'Mittel', cls: 'border-primary/40 text-primary bg-primary/5' },
  ok: { label: 'OK', cls: 'border-success/40 text-success bg-success/5' },
};

export default function TrapCoverageAuditCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'trap-coverage-audit'],
    queryFn: () => adminRpc.trapCoverageAudit(),
    refetchInterval: 60_000,
  });

  if (isLoading) return <Skeleton className="h-24 w-full" />;

  const packages = data?.packages ?? [];
  const global = data?.global;

  if (packages.length === 0 && global && global.missing === 0) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/5 p-3 flex items-center gap-3">
        <ShieldCheck className="h-4 w-4 text-success shrink-0" />
        <div>
          <div className="text-sm font-semibold text-foreground">Trap Coverage 100%</div>
          <div className="text-[11px] text-muted-foreground">
            Alle {global.total} approved Fragen haben trap_type. Guard aktiv.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-3">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
        <span className="text-sm font-semibold text-foreground">
          Trap Coverage Audit
        </span>
        {global && (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-border text-muted-foreground ml-auto">
            Global: {global.coverage_pct}% · {global.missing} fehlend
          </Badge>
        )}
      </div>
      <div className="space-y-1.5">
        {packages.slice(0, 8).map(pkg => {
          const rc = riskConfig[pkg.risk];
          return (
            <Link
              key={pkg.package_id}
              to={`/admin/studio/${pkg.package_id}`}
              className="block rounded-lg border border-border bg-card p-2.5 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground truncate">
                    {pkg.title ?? pkg.package_id.slice(0, 12)}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {pkg.package_id.slice(0, 8)} · {pkg.status}
                  </div>
                </div>
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0 mt-1" />
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4", rc.cls)}>
                  {rc.label}: {pkg.coverage_pct}%
                </Badge>
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-border text-muted-foreground">
                  {pkg.missing_trap}/{pkg.approved_total} fehlend
                </Badge>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
