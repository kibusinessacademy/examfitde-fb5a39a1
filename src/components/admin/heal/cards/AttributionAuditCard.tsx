import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Target, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type EventRow = {
  event_type: string;
  requires_package: boolean;
  strict: boolean;
  scope: string;
  total: number;
  with_pkg: number;
  without_pkg: number;
  attribution_pct: number;
};
type Summary = {
  window_days: number;
  generated_at: string;
  totals: { events_total: number; events_with_pkg: number; attribution_pct: number };
  by_event_type: EventRow[];
  recent_violations: Array<{
    logged_at: string;
    event_type: string;
    page_path: string | null;
    strict: boolean;
    result_status: string;
  }>;
};

export function AttributionAuditCard() {
  const [days, setDays] = useState<number>(7);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["attribution-audit", days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_attribution_audit_summary" as any, {
        _window_days: days,
      });
      if (error) throw error;
      return data as Summary;
    },
    refetchInterval: 60_000,
  });

  const setPolicy = useMutation({
    mutationFn: async (vars: { event_type: string; requires_package: boolean; strict: boolean; scope: string }) => {
      const { data, error } = await supabase.rpc("admin_set_attribution_policy" as any, {
        _event_type: vars.event_type,
        _requires_package: vars.requires_package,
        _strict: vars.strict,
        _scope: vars.scope,
        _notes: null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Policy aktualisiert");
      qc.invalidateQueries({ queryKey: ["attribution-audit"] });
    },
    onError: (e: any) => toast.error("Update fehlgeschlagen", { description: e.message }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          Attribution Propagation Audit (2.3b)
        </CardTitle>
        <div className="flex items-center gap-1">
          {[7, 30, 90].map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? "default" : "ghost"}
              onClick={() => setDays(d)}
              className="h-7 text-xs"
            >
              {d}d
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Soft-Audit-Trigger loggt Events ohne package context. <code>strict=true</code> blockt den Insert
          und produziert 22023/check_violation. Erst nach 7d stabile observation strict aktivieren.
        </p>

        {q.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {q.data && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">Events: {q.data.totals.events_total}</Badge>
              <Badge variant="outline">mit pkg: {q.data.totals.events_with_pkg}</Badge>
              <Badge
                className={
                  q.data.totals.attribution_pct >= 90
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : q.data.totals.attribution_pct >= 50
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : "bg-destructive-bg-subtle text-destructive"
                }
              >
                attribution {q.data.totals.attribution_pct}%
              </Badge>
            </div>

            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground sticky top-0 bg-background">
                  <tr>
                    <th className="text-left py-1 pr-2">event_type</th>
                    <th className="text-left py-1 pr-2">scope</th>
                    <th className="text-right py-1 pr-2">total</th>
                    <th className="text-right py-1 pr-2">w/o pkg</th>
                    <th className="text-right py-1 pr-2">%</th>
                    <th className="text-center py-1 pr-2">req</th>
                    <th className="text-center py-1">strict</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.by_event_type.map((r) => (
                    <tr key={r.event_type} className="border-t border-border/40">
                      <td className="py-1 pr-2 font-mono">{r.event_type}</td>
                      <td className="py-1 pr-2">{r.scope}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{r.total}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{r.without_pkg}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{r.attribution_pct}%</td>
                      <td className="py-1 pr-2 text-center">{r.requires_package ? "✓" : "—"}</td>
                      <td className="py-1 text-center">
                        {r.requires_package ? (
                          <Button
                            size="sm"
                            variant={r.strict ? "destructive" : "ghost"}
                            disabled={setPolicy.isPending}
                            onClick={() =>
                              setPolicy.mutate({
                                event_type: r.event_type,
                                requires_package: true,
                                strict: !r.strict,
                                scope: r.scope,
                              })
                            }
                            className="h-6 text-[11px]"
                          >
                            {r.strict ? "strict" : "soft"}
                          </Button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {q.data.recent_violations.length > 0 && (
              <div className="border-t border-border/40 pt-2">
                <div className="text-xs font-semibold mb-1">
                  Recent violations ({q.data.recent_violations.length})
                </div>
                <div className="max-h-40 overflow-y-auto text-[11px] font-mono space-y-0.5">
                  {q.data.recent_violations.map((v, i) => (
                    <div key={i} className="flex gap-2 text-muted-foreground">
                      <span>{new Date(v.logged_at).toLocaleTimeString()}</span>
                      <span className="text-foreground">{v.event_type}</span>
                      <span>{v.page_path ?? "—"}</span>
                      <Badge
                        variant="outline"
                        className={v.result_status === "blocked" ? "text-destructive" : ""}
                      >
                        {v.result_status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default AttributionAuditCard;
