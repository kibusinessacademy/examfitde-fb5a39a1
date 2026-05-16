import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Wrench, RefreshCw } from "lucide-react";

type StrategyRow = {
  repair_strategy: string;
  root_cause: string;
  requires_platform_fix: boolean;
  expected_job_type: string | null;
  signal_count: number;
  safe_count: number;
  blocked_count: number;
};
type Summary = {
  generated_at: string;
  totals: {
    signals_total: number;
    safe_to_repair: number;
    blocked: number;
    platform_fix: number;
    active_job_present: number;
    packages_touched: number;
  };
  by_strategy: StrategyRow[];
  by_blocked_reason: Array<{ blocked_reason: string; count: number }>;
};
type Signal = {
  package_id: string;
  package_key: string;
  package_title: string;
  signal: string;
  root_cause: string;
  repair_strategy: string;
  expected_job_type: string | null;
  blocked_reason: string | null;
  safe_to_repair: boolean;
};

export function RepairEligibilityCard() {
  const [strategy, setStrategy] = useState<string | null>(null);
  const [safeOnly, setSafeOnly] = useState<boolean | null>(null);

  const summary = useQuery({
    queryKey: ["repair-eligibility-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_repair_eligibility_summary" as any);
      if (error) throw error;
      return data as Summary;
    },
    refetchInterval: 60_000,
  });

  const drill = useQuery({
    queryKey: ["repair-eligibility-signals", strategy, safeOnly],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_repair_eligibility_signals" as any, {
        _strategy: strategy,
        _root_cause: null,
        _safe_only: safeOnly,
        _blocked_reason: null,
        _track: null,
        _limit: 100,
      });
      if (error) throw error;
      return (data ?? []) as Signal[];
    },
    enabled: !!strategy || safeOnly !== null,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Wrench className="h-4 w-4 text-primary" />
          Repair Eligibility Projection (2.3c-0, diagnose-only)
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => summary.refetch()} disabled={summary.isFetching}>
          {summary.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Klassifiziert jedes fehlende Growth-Signal nach <code>repair_strategy</code> + <code>root_cause</code> +{" "}
          <code>safe_to_repair</code>. Plattform-Drifts werden ausgeschlossen, Active-Jobs deduplizieren.
          Dispatcher (2.3c) konsumiert <code>safe_to_repair=true</code> mit <code>expected_job_type</code>.
        </p>

        {summary.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {summary.data && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">Signale: {summary.data.totals.signals_total}</Badge>
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                safe: {summary.data.totals.safe_to_repair}
              </Badge>
              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                blocked: {summary.data.totals.blocked}
              </Badge>
              <Badge variant="outline">platform_fix: {summary.data.totals.platform_fix}</Badge>
              <Badge variant="outline">active_job: {summary.data.totals.active_job_present}</Badge>
              <Badge variant="outline">packages: {summary.data.totals.packages_touched}</Badge>
            </div>

            <div className="flex gap-1">
              <Button
                size="sm"
                variant={safeOnly === true ? "default" : "ghost"}
                onClick={() => setSafeOnly(safeOnly === true ? null : true)}
                className="h-7 text-xs"
              >
                nur safe
              </Button>
              <Button
                size="sm"
                variant={safeOnly === false ? "default" : "ghost"}
                onClick={() => setSafeOnly(safeOnly === false ? null : false)}
                className="h-7 text-xs"
              >
                nur blocked
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left py-1 pr-2">strategy</th>
                    <th className="text-left py-1 pr-2">root_cause</th>
                    <th className="text-left py-1 pr-2">job_type</th>
                    <th className="text-right py-1 pr-2">signals</th>
                    <th className="text-right py-1 pr-2">safe</th>
                    <th className="text-right py-1 pr-2">blocked</th>
                    <th className="text-center py-1">drill</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.by_strategy.map((r) => (
                    <tr key={`${r.repair_strategy}-${r.root_cause}`} className="border-t border-border/40">
                      <td className="py-1 pr-2 font-mono">
                        {r.repair_strategy}
                        {r.requires_platform_fix && (
                          <Badge variant="outline" className="ml-1 text-[10px] py-0">
                            platform
                          </Badge>
                        )}
                      </td>
                      <td className="py-1 pr-2 font-mono">{r.root_cause}</td>
                      <td className="py-1 pr-2 font-mono text-muted-foreground">
                        {r.expected_job_type ?? "—"}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{r.signal_count}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {r.safe_count}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums text-amber-600 dark:text-amber-400">
                        {r.blocked_count}
                      </td>
                      <td className="py-1 text-center">
                        <Button
                          size="sm"
                          variant={strategy === r.repair_strategy ? "default" : "ghost"}
                          onClick={() =>
                            setStrategy(strategy === r.repair_strategy ? null : r.repair_strategy)
                          }
                          className="h-6 text-[11px]"
                        >
                          {strategy === r.repair_strategy ? "schließen" : "öffnen"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              {summary.data.by_blocked_reason.map((b) => (
                <Badge key={b.blocked_reason} variant="outline">
                  {b.blocked_reason}: {b.count}
                </Badge>
              ))}
            </div>
          </>
        )}

        {(strategy || safeOnly !== null) && (
          <div className="border-t border-border/40 pt-2">
            <div className="text-xs font-semibold mb-1">
              Drill-down{strategy ? `: ${strategy}` : ""}
              {safeOnly !== null ? ` · ${safeOnly ? "safe" : "blocked"}` : ""}
            </div>
            {drill.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {drill.data && drill.data.length === 0 && (
              <div className="text-xs text-muted-foreground">Keine Signale.</div>
            )}
            {drill.data && drill.data.length > 0 && (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground sticky top-0 bg-background">
                    <tr>
                      <th className="text-left py-1 pr-2">package_key</th>
                      <th className="text-left py-1 pr-2">signal</th>
                      <th className="text-left py-1 pr-2">root_cause</th>
                      <th className="text-left py-1 pr-2">blocked</th>
                      <th className="text-center py-1">safe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drill.data.map((s, i) => (
                      <tr key={`${s.package_id}-${s.signal}-${i}`} className="border-t border-border/40">
                        <td className="py-1 pr-2 font-mono">{s.package_key}</td>
                        <td className="py-1 pr-2 font-mono">{s.signal}</td>
                        <td className="py-1 pr-2 font-mono text-muted-foreground">{s.root_cause}</td>
                        <td className="py-1 pr-2 font-mono text-muted-foreground">
                          {s.blocked_reason ?? "—"}
                        </td>
                        <td className="py-1 text-center">
                          {s.safe_to_repair ? (
                            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                              ✓
                            </Badge>
                          ) : (
                            <Badge variant="outline">—</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default RepairEligibilityCard;
