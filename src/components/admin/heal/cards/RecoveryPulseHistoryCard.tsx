import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

type PulseRow = {
  id: string;
  created_at: string;
  result_status: string | null;
  metadata: {
    decision?: string;
    pending?: number;
    oldest_min?: number;
    burst_size?: number;
    pulsed?: number;
    gate?: { healthy?: boolean; db_latency_ms?: number; reaper_kills_5m?: number };
  } | null;
};

const decisionVariant = (d?: string): "default" | "secondary" | "outline" | "destructive" => {
  if (d === "pulsed") return "default";
  if (d === "noop_gate_unhealthy") return "destructive";
  return "secondary";
};

/**
 * Recovery Pulse History — last 20 decisions of fn_auto_recovery_pulse_decide.
 * Reads auto_heal_log directly (action_type='auto_recovery_pulse_decide').
 */
type HealthRow = {
  decision: string;
  decisions_count: number;
  pulsed_jobs_total: number;
  avg_burst_size: number | null;
  avg_oldest_min: number | null;
  avg_pending: number | null;
  last_at: string | null;
};

const decisionTone = (d: string): "default" | "destructive" | "secondary" | "outline" => {
  if (d === "pulsed") return "default";
  if (d.startsWith("noop_gate") || d.startsWith("noop_failure")) return "destructive";
  return "secondary";
};

export function RecoveryPulseHistoryCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["recovery-pulse-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auto_heal_log")
        .select("id, created_at, result_status, metadata")
        .eq("action_type", "auto_recovery_pulse_decide")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as PulseRow[];
    },
    refetchInterval: 30_000,
  });

  const { data: health } = useQuery({
    queryKey: ["recovery-pulse-health-24h"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_auto_recovery_pulse_health" as any,
        { p_window_hours: 24 },
      );
      if (error) return [] as HealthRow[];
      return (data ?? []) as HealthRow[];
    },
    refetchInterval: 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" /> Recovery Pulse History
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Letzte 20 Entscheidungen des Auto-Pulse-Cron (alle 5 min). „pulsed" = Recovery-Drain ausgelöst.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Lade…</p>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">Noch keine Pulse-Decisions.</p>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {data.map((r) => {
              const m = r.metadata ?? {};
              const decision = m.decision ?? "unknown";
              return (
                <div
                  key={r.id}
                  className="border rounded-md p-2 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <Badge variant={decisionVariant(decision)} className="font-mono">
                      {decision}
                    </Badge>
                    <span className="text-muted-foreground">
                      {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: de })}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline">pending {m.pending ?? 0}</Badge>
                    <Badge variant="outline">oldest {m.oldest_min ?? 0}min</Badge>
                    <Badge variant="outline">burst {m.burst_size ?? 0}</Badge>
                    <Badge variant={m.pulsed && m.pulsed > 0 ? "default" : "outline"}>
                      pulsed {m.pulsed ?? 0}
                    </Badge>
                    <Badge variant={m.gate?.healthy ? "outline" : "destructive"}>
                      gate {m.gate?.healthy ? "✓" : "×"}
                    </Badge>
                    {m.gate?.db_latency_ms !== undefined ? (
                      <Badge variant="outline" className="font-mono">
                        db {m.gate.db_latency_ms.toFixed(1)}ms
                      </Badge>
                    ) : null}
                    {m.gate?.reaper_kills_5m !== undefined ? (
                      <Badge variant="outline">reaper {m.gate.reaper_kills_5m}</Badge>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
