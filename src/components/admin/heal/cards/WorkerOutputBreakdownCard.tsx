/**
 * WorkerOutputBreakdownCard — Worker-Output Auswertung.
 * Zeigt completed vs cancelled vs failed mit Cause-Kategorien (timeout,
 * rate_limit, validation, upstream_5xx, resource_kill, ...) global und
 * per Job-Type. So sieht man nach einem Heal sofort den Engpass.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export function WorkerOutputBreakdownCard() {
  const [hours, setHours] = useState("6");
  const q = useQuery({
    queryKey: ["worker-output-breakdown", hours],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_worker_output_breakdown" as any,
        { p_window_hours: Number(hours) } as any,
      );
      if (error) throw error;
      return data as any;
    },
    refetchInterval: 60_000,
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Worker-Output (Cause-Categories)
        </h3>
        <Select value={hours} onValueChange={setHours}>
          <SelectTrigger className="h-7 w-[100px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["1","6","24","72"].map((h) => (
              <SelectItem key={h} value={h}>{h}h</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {q.isLoading || !q.data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 mb-3">
            <Stat label="completed" value={q.data.totals.completed} tone="ok" />
            <Stat label="cancelled" value={q.data.totals.cancelled} tone="warn" />
            <Stat label="failed" value={q.data.totals.failed} tone="bad" />
            <Stat label="total" value={q.data.totals.total} />
          </div>

          <div className="text-xs font-semibold mb-1">Top Cause-Kategorien</div>
          <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
            {(q.data.by_status_category ?? []).slice(0, 12).map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Badge variant={r.status === "completed" ? "default" :
                                 r.status === "cancelled" ? "secondary" : "destructive"}
                       className="text-[10px] w-20 justify-center">{r.status}</Badge>
                <span className="font-mono text-[11px] flex-1 truncate">{r.cause_category}</span>
                <span className="font-mono font-semibold tabular-nums">{r.count}</span>
              </div>
            ))}
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer font-semibold mb-1">
              Aufschlüsselung nach Job-Type ({(q.data.by_job_type ?? []).length})
            </summary>
            <table className="w-full mt-2 text-[11px]">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left">job_type</th>
                  <th className="text-right">cmp</th>
                  <th className="text-right">cnc</th>
                  <th className="text-right">fld</th>
                  <th className="text-left pl-2">top_cause</th>
                </tr>
              </thead>
              <tbody>
                {(q.data.by_job_type ?? []).map((r: any, i: number) => (
                  <tr key={i} className="border-t">
                    <td className="font-mono py-0.5">{r.job_type}</td>
                    <td className="text-right tabular-nums text-emerald-600">{r.completed}</td>
                    <td className="text-right tabular-nums text-amber-600">{r.cancelled}</td>
                    <td className="text-right tabular-nums text-destructive">{r.failed}</td>
                    <td className="pl-2 font-mono text-muted-foreground">{r.top_cause ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-emerald-600" :
                tone === "warn" ? "text-amber-600" :
                tone === "bad" ? "text-destructive" : "";
  return (
    <div className="rounded border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value ?? 0}</div>
    </div>
  );
}
