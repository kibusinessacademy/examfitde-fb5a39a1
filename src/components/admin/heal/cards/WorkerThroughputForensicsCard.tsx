import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Gauge, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type ForensicsRow = {
  pool: string;
  pending: number;
  processing: number;
  oldest_pending_sec: number;
  unique_pkgs: number;
  batch_default: number;
  recommended_burst: number;
  recovery_pulse_eligible: boolean;
  gate: {
    healthy?: boolean;
    processing_capacity_available?: boolean;
    reaper_low?: boolean;
    db_latency_ok?: boolean;
    db_latency_ms?: number;
    reaper_kills_5m?: number;
  };
  tip: string;
};

/**
 * Worker Throughput Forensics — adaptive burst sizing + health-gate visibility.
 * Reads admin_get_worker_throughput_forensics() (admin-gated).
 * Recovery-Pulse läuft autonom alle 5min via Cron, manueller Trigger nur als Notfall.
 */
export function WorkerThroughputForensicsCard() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["worker-throughput-forensics"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_worker_throughput_forensics" as any,
      );
      if (error) throw error;
      return (data ?? []) as ForensicsRow[];
    },
    refetchInterval: 30_000,
  });

  const triggerManualPulse = async () => {
    const { data, error } = await supabase.rpc(
      "fn_auto_recovery_pulse_decide" as any,
    );
    if (error) {
      toast.error(`Pulse fehlgeschlagen: ${error.message}`);
      return;
    }
    const d = data as { decision?: string; pulsed?: number } | null;
    toast.success(`Pulse: ${d?.decision} (${d?.pulsed ?? 0} jobs)`);
    refetch();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" /> Worker Throughput Forensics
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Adaptive Burst (25/35/50/75) + Health-Gate. Auto-Pulse alle 5 min.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" variant="secondary" onClick={triggerManualPulse}>
            <Zap className="h-3 w-3 mr-1" /> Manual Pulse
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Lade…</p>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">Keine aktiven Pools.</p>
        ) : (
          <div className="space-y-3">
            {data.map((r) => (
              <div key={r.pool} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold">{r.pool}</span>
                  <div className="flex gap-2">
                    <Badge variant="outline">pending {r.pending}</Badge>
                    <Badge variant="outline">processing {r.processing}</Badge>
                    <Badge variant="outline">oldest {Math.round(r.oldest_pending_sec / 60)}min</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">batch={r.batch_default}</Badge>
                  <Badge variant="default">burst={r.recommended_burst}</Badge>
                  {r.recovery_pulse_eligible ? (
                    <Badge className="bg-amber-500/15 text-amber-700 border-amber-300">
                      pulse-eligible
                    </Badge>
                  ) : null}
                  <Badge variant={r.gate.healthy ? "outline" : "destructive"}>
                    gate {r.gate.healthy ? "✓" : "×"}
                  </Badge>
                  <Badge variant="outline" className="font-mono">
                    db {r.gate.db_latency_ms?.toFixed?.(1) ?? "?"}ms
                  </Badge>
                  <Badge variant="outline">reaper {r.gate.reaper_kills_5m ?? 0}/5m</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{r.tip}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
