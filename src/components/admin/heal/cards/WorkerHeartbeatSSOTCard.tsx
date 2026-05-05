/**
 * WorkerHeartbeatSSOTCard — SSOT-Visualisierung der echten Worker-Quelle
 * (ops_worker_heartbeats via admin_get_worker_heartbeat_summary).
 * Schwellen: critical = 0 alive_5m, warn = >120s seit letztem Heartbeat.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Worker {
  worker_name: string;
  instances: number;
  alive_5m: number;
  latest: string | null;
  processed_count: number;
}
interface Summary {
  workers: Worker[];
  any_alive_5m: boolean;
  pipeline_alive_5m: number;
  pipeline_latest: string | null;
  fetched_at: string;
}

function ageSec(ts: string | null): number | null {
  if (!ts) return null;
  return Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
}
function fmtAge(s: number | null) {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function WorkerHeartbeatSSOTCard() {
  const q = useQuery({
    queryKey: ["worker-heartbeat-ssot"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_worker_heartbeat_summary" as any);
      if (error) throw error;
      return data as Summary;
    },
    refetchInterval: 15_000,
  });

  const pipelineAge = ageSec(q.data?.pipeline_latest ?? null);
  // SSOT-Schwellen
  const stalled = q.data ? !q.data.any_alive_5m : false;
  const lagging = !stalled && pipelineAge != null && pipelineAge > 120;
  const status = stalled ? "critical" : lagging ? "warn" : "ok";

  return (
    <Card className={cn(
      "p-4",
      status === "critical" && "border-destructive bg-destructive-bg-subtle",
      status === "warn" && "border-warning bg-warning-bg-subtle",
    )}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Heart className={cn(
            "h-4 w-4",
            status === "critical" && "text-destructive animate-pulse",
            status === "warn" && "text-warning",
            status === "ok" && "text-green-600",
          )} />
          Worker Heartbeat (SSOT)
        </h3>
        <Badge variant="outline" className="text-[10px]">live · 15s</Badge>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <div className="mb-3 p-3 rounded-md bg-muted/30">
            <div className="flex items-center gap-2 mb-1">
              {status === "critical" && (
                <Badge variant="destructive" className="text-[10px]">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Worker-Stillstand
                </Badge>
              )}
              {status === "warn" && (
                <Badge variant="outline" className="text-[10px] border-warning text-warning">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Heartbeat lagging ({fmtAge(pipelineAge)})
                </Badge>
              )}
              {status === "ok" && (
                <Badge variant="outline" className="text-[10px] border-green-500 text-green-700">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> alive
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                pipeline-runner: {q.data?.pipeline_alive_5m ?? 0} alive · letzter HB {fmtAge(pipelineAge)}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Schwellen: critical = 0 alive in 5min · warn = letzter Heartbeat &gt; 120s · ok ansonsten.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="p-2 text-left">Worker</th>
                  <th className="p-2 text-center">Instances</th>
                  <th className="p-2 text-center">alive_5m</th>
                  <th className="p-2 text-center">letzter HB</th>
                  <th className="p-2 text-right">processed</th>
                </tr>
              </thead>
              <tbody>
                {(q.data?.workers ?? []).map((w) => {
                  const a = ageSec(w.latest);
                  const wStalled = w.alive_5m === 0;
                  return (
                    <tr key={w.worker_name} className="border-b">
                      <td className="p-2 font-mono">{w.worker_name}</td>
                      <td className="p-2 text-center tabular-nums">{w.instances}</td>
                      <td className="p-2 text-center tabular-nums">
                        <span className={cn(wStalled && "text-destructive font-bold")}>
                          {w.alive_5m}
                        </span>
                      </td>
                      <td className="p-2 text-center tabular-nums">{fmtAge(a)}</td>
                      <td className="p-2 text-right tabular-nums">{w.processed_count}</td>
                    </tr>
                  );
                })}
                {(q.data?.workers ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-muted-foreground">
                      Keine Worker-Heartbeats in den letzten 24h.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
