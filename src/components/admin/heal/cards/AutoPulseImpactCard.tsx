import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

type ImpactRow = {
  decision: string;
  decisions_count: number;
  measured_pairs: number;
  avg_pending_delta: number | null;
  avg_failure_rate_delta: number | null;
  avg_oldest_min_delta: number | null;
  avg_pending_reduction_pct: number | null;
  success_count: number;
  success_rate_pct: number | null;
  total_pulsed_jobs: number;
  last_at: string | null;
};

const tone = (n: number | null | undefined, invert = false): "default" | "destructive" | "secondary" => {
  if (n == null) return "secondary";
  const positive = invert ? n < 0 : n > 0;
  if (Math.abs(n) < 0.001) return "secondary";
  return positive ? "default" : "destructive";
};

export function AutoPulseImpactCard() {
  const [windowDays, setWindowDays] = useState(7);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["auto-pulse-impact", windowDays],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_auto_pulse_impact" as any,
        { p_window_days: windowDays },
      );
      if (error) throw error;
      return (data ?? []) as ImpactRow[];
    },
    refetchInterval: 60_000,
  });

  const pulsed = data?.find((r) => r.decision === "pulsed");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" /> Auto-Pulse Wirkungsmessung
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Vorher/Nachher (≈30 min) je Pulse-Decision · Fenster: {windowDays}d
        </p>
        <div className="flex gap-1 pt-1">
          {[1, 7, 30].map((d) => (
            <Button
              key={d}
              size="sm"
              variant={windowDays === d ? "default" : "outline"}
              onClick={() => setWindowDays(d)}
              className="h-7 text-xs"
            >
              {d}d
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => refetch()} className="h-7 text-xs">
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {pulsed && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="border rounded-md p-2 text-center">
              <div className="text-[10px] text-muted-foreground uppercase">Success-Rate</div>
              <div className="text-lg font-semibold tabular-nums">
                {pulsed.success_rate_pct?.toFixed(1) ?? "—"}%
              </div>
              <div className="text-[10px] text-muted-foreground">
                {pulsed.success_count}/{pulsed.measured_pairs}
              </div>
            </div>
            <div className="border rounded-md p-2 text-center">
              <div className="text-[10px] text-muted-foreground uppercase">ø Pending Δ</div>
              <div className="text-lg font-semibold tabular-nums">
                {pulsed.avg_pending_delta?.toFixed(1) ?? "—"}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {pulsed.avg_pending_reduction_pct?.toFixed(1) ?? "—"}%
              </div>
            </div>
            <div className="border rounded-md p-2 text-center">
              <div className="text-[10px] text-muted-foreground uppercase">Pulsed Jobs</div>
              <div className="text-lg font-semibold tabular-nums">{pulsed.total_pulsed_jobs}</div>
              <div className="text-[10px] text-muted-foreground">total</div>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Lade…</p>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">Noch keine Pulse-Daten in diesem Fenster.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-1 px-2">Decision</th>
                  <th className="text-right py-1 px-2">N</th>
                  <th className="text-right py-1 px-2">Pairs</th>
                  <th className="text-right py-1 px-2">ø Pending Δ</th>
                  <th className="text-right py-1 px-2">ø Oldest Δ</th>
                  <th className="text-right py-1 px-2">ø Failure Δ</th>
                  <th className="text-right py-1 px-2">Success</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.decision} className="border-b">
                    <td className="py-1.5 px-2 font-mono">{r.decision}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums">{r.decisions_count}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums text-muted-foreground">
                      {r.measured_pairs}
                    </td>
                    <td className="text-right py-1.5 px-2">
                      <Badge variant={tone(r.avg_pending_delta)} className="font-mono text-[10px]">
                        {(r.avg_pending_delta ?? 0) > 0 ? (
                          <TrendingDown className="h-3 w-3 mr-0.5" />
                        ) : (
                          <TrendingUp className="h-3 w-3 mr-0.5" />
                        )}
                        {r.avg_pending_delta?.toFixed(1) ?? "—"}
                      </Badge>
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums">
                      {r.avg_oldest_min_delta?.toFixed(1) ?? "—"}
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums">
                      {r.avg_failure_rate_delta != null
                        ? (r.avg_failure_rate_delta * 100).toFixed(2) + "%"
                        : "—"}
                    </td>
                    <td className="text-right py-1.5 px-2 tabular-nums">
                      {r.success_rate_pct != null ? r.success_rate_pct.toFixed(0) + "%" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
