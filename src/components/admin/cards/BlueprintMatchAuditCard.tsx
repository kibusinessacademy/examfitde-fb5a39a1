import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminRpc } from '@/integrations/supabase/admin-rpc';
import { runAdminOpsAction } from '@/integrations/supabase/admin-ops-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import {
  Target, ChevronDown, ChevronRight, ArrowRight,
  AlertTriangle, CheckCircle2, XCircle, HelpCircle, Loader2, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const signalStyle = {
  ok: 'border-success/40 text-success bg-success/5',
  warn: 'border-warning/40 text-warning bg-warning/5',
  hard_fail: 'border-destructive/40 text-destructive bg-destructive/5',
} as const;

const signalIcon = {
  ok: <CheckCircle2 className="h-3 w-3 text-success" />,
  warn: <AlertTriangle className="h-3 w-3 text-warning" />,
  hard_fail: <XCircle className="h-3 w-3 text-destructive" />,
} as const;

type MatchPackage = {
  package_id: string;
  title: string | null;
  curriculum_id: string;
  approved_total: number;
  matched: number;
  mismatched: number;
  no_blueprint: number;
  no_expectation: number;
  match_pct: number;
  mismatch_pct: number;
  signal: 'ok' | 'warn' | 'hard_fail';
  top_mismatches: Array<{ pattern: string; count: number }>;
};

function MatchBar({ matched, mismatched, noBlueprint, total }: {
  matched: number; mismatched: number; noBlueprint: number; total: number;
}) {
  if (total === 0) return null;
  const mPct = (matched / total) * 100;
  const mmPct = (mismatched / total) * 100;
  const nbPct = (noBlueprint / total) * 100;

  return (
    <div className="flex h-2 rounded-full overflow-hidden bg-muted gap-px">
      {mPct > 0 && (
        <div className="h-full bg-success rounded-sm" style={{ width: `${mPct}%` }} title={`Match: ${matched}`} />
      )}
      {mmPct > 0 && (
        <div className="h-full bg-destructive rounded-sm" style={{ width: `${mmPct}%` }} title={`Mismatch: ${mismatched}`} />
      )}
      {nbPct > 0 && (
        <div className="h-full bg-muted-foreground/30 rounded-sm" style={{ width: `${nbPct}%` }} title={`Kein Blueprint: ${noBlueprint}`} />
      )}
    </div>
  );
}

function PackageRow({ pkg, onRebalance, busy }: { pkg: MatchPackage; onRebalance: (id: string) => void; busy: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
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
              {pkg.approved_total} Fragen · {pkg.match_pct}% Match
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {signalIcon[pkg.signal]}
            <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4", signalStyle[pkg.signal])}>
              {pkg.match_pct}%
            </Badge>
          </div>
        </div>

        <div className="mt-1.5 ml-4.5">
          <MatchBar
            matched={pkg.matched}
            mismatched={pkg.mismatched}
            noBlueprint={pkg.no_blueprint}
            total={pkg.approved_total}
          />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border p-2.5 space-y-2">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: 'Match', value: pkg.matched, cls: 'text-success' },
              { label: 'Mismatch', value: pkg.mismatched, cls: 'text-destructive' },
              { label: 'Kein BP', value: pkg.no_blueprint, cls: 'text-muted-foreground' },
              { label: 'Keine Erw.', value: pkg.no_expectation, cls: 'text-muted-foreground' },
            ].map(s => (
              <div key={s.label} className="rounded-md border border-border p-1.5">
                <div className={cn("text-sm font-bold", s.cls)}>{s.value}</div>
                <div className="text-[9px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Top mismatches */}
          {pkg.top_mismatches.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground font-medium">Häufigste Abweichungen:</div>
              {pkg.top_mismatches.map(m => (
                <div key={m.pattern} className="flex items-center justify-between text-[10px] px-2 py-1 rounded bg-muted/50">
                  <span className="font-mono text-foreground">{m.pattern}</span>
                  <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-destructive/30 text-destructive">
                    {m.count}×
                  </Badge>
                </div>
              ))}
            </div>
          )}

          <Link
            to={`/admin/studio/${pkg.package_id}`}
            className="text-[10px] text-primary hover:underline flex items-center gap-1"
          >
            Paket öffnen <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

export default function BlueprintMatchAuditCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'trap-blueprint-match'],
    queryFn: () => adminRpc.trapBlueprintMatch(),
    refetchInterval: 60_000,
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  const global = data?.global;
  const packages = data?.packages ?? [];

  const problemPackages = packages.filter(
    (p: MatchPackage) => p.signal !== 'ok'
  );

  if (problemPackages.length === 0 && global) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/5 p-3 flex items-center gap-3">
        <Target className="h-4 w-4 text-success shrink-0" />
        <div>
          <div className="text-sm font-semibold text-foreground">Blueprint-Match OK</div>
          <div className="text-[11px] text-muted-foreground">
            {global.match_pct}% Übereinstimmung über {global.total} Fragen.
          </div>
        </div>
      </div>
    );
  }

  const hardFails = problemPackages.filter((p: MatchPackage) => p.signal === 'hard_fail');
  const warns = problemPackages.filter((p: MatchPackage) => p.signal === 'warn');

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground">
          Blueprint Trap-Match
        </span>
        <div className="flex gap-1.5 ml-auto">
          {hardFails.length > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-destructive/40 text-destructive bg-destructive/5">
              {hardFails.length} Hard-Fail
            </Badge>
          )}
          {warns.length > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-warning/40 text-warning bg-warning/5">
              {warns.length} Warn
            </Badge>
          )}
          {global && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-muted-foreground/30 text-muted-foreground">
              {global.match_pct}% global
            </Badge>
          )}
        </div>
      </div>

      {/* Global stats */}
      {global && global.no_blueprint > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-2 flex items-start gap-2">
          <HelpCircle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
          <div className="text-[10px] text-foreground">
            <span className="font-semibold">{global.no_blueprint} Fragen</span> ohne Blueprint-Zuordnung.
            <span className="text-muted-foreground"> Trap-Erwartung kann nicht geprüft werden.</span>
          </div>
        </div>
      )}

      {/* Package list */}
      <div className="space-y-1.5">
        {[...hardFails, ...warns].slice(0, 10).map((pkg: MatchPackage) => (
          <PackageRow key={pkg.package_id} pkg={pkg} />
        ))}
      </div>

      {problemPackages.length > 10 && (
        <div className="text-[10px] text-muted-foreground text-center">
          + {problemPackages.length - 10} weitere Pakete
        </div>
      )}
    </div>
  );
}
