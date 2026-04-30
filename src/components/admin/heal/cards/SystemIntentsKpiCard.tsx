import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type IntentKpiRow = {
  intent_type: string;
  source: string | null;
  pending: number;
  claimed_open: number;
  stuck_claimed: number;
  consumed: number;
  created_last_hour: number;
  consumed_last_hour: number;
  last_created_at: string | null;
  last_consumed_at: string | null;
  avg_processing_seconds: number | null;
};

export function SystemIntentsKpiCard() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["v_system_intents_kpi"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_system_intents_kpi")
        .select("*");
      if (error) throw error;
      return (data ?? []) as IntentKpiRow[];
    },
    refetchInterval: 30_000,
  });

  // Realtime: refresh on any system_intents change
  useEffect(() => {
    const ch = supabase
      .channel("system_intents_kpi")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "system_intents" },
        () => qc.invalidateQueries({ queryKey: ["v_system_intents_kpi"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-text-primary">
          System-Intents (Phase 2a — Loop-Routing)
        </h3>
        <Badge variant="outline" className="ml-auto text-xs">
          live · 30s
        </Badge>
      </div>

      <p className="text-xs text-text-secondary mb-3">
        Idempotente Eintrittspunkte für Cron-getriebene Loops. Ziel: pro 5-Min-Bucket
        genau 1 Ausführung pro Loop-Typ — kein Doppel-Trigger, keine DAG-Storms.
      </p>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !data || data.length === 0 ? (
        <p className="text-xs text-text-tertiary italic">
          Noch keine Intents in den letzten 24h. Worker startet alle Min., Recorder alle 5 Min.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th className="text-left py-2 pr-2 font-medium">Intent / Source</th>
                <th className="text-right px-2 font-medium">Pending</th>
                <th className="text-right px-2 font-medium">Claimed</th>
                <th className="text-right px-2 font-medium">Stuck&gt;15m</th>
                <th className="text-right px-2 font-medium">Consumed 24h</th>
                <th className="text-right px-2 font-medium">∅ Sek.</th>
                <th className="text-right pl-2 font-medium">Letzte Verarbeitung</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr
                  key={`${r.intent_type}-${r.source ?? ""}`}
                  className="border-b border-border-subtle/40 hover:bg-surface-hover"
                >
                  <td className="py-2 pr-2">
                    <div className="font-mono text-text-primary">{r.intent_type}</div>
                    {r.source && (
                      <div className="text-text-tertiary text-[10px]">{r.source}</div>
                    )}
                  </td>
                  <td className="text-right px-2 tabular-nums">
                    {r.pending > 0 ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {r.pending}
                      </Badge>
                    ) : (
                      <span className="text-text-tertiary">0</span>
                    )}
                  </td>
                  <td className="text-right px-2 tabular-nums">
                    {r.claimed_open > 0 ? (
                      <span className="text-text-primary">{r.claimed_open}</span>
                    ) : (
                      <span className="text-text-tertiary">0</span>
                    )}
                  </td>
                  <td className="text-right px-2 tabular-nums">
                    {r.stuck_claimed > 0 ? (
                      <Badge variant="destructive" className="text-[10px]">
                        {r.stuck_claimed}
                      </Badge>
                    ) : (
                      <span className="text-text-tertiary">0</span>
                    )}
                  </td>
                  <td className="text-right px-2 tabular-nums text-text-primary">
                    {r.consumed}
                  </td>
                  <td className="text-right px-2 tabular-nums text-text-secondary">
                    {r.avg_processing_seconds != null
                      ? r.avg_processing_seconds.toFixed(1)
                      : "—"}
                  </td>
                  <td className="text-right pl-2 text-text-tertiary text-[10px]">
                    {r.last_consumed_at
                      ? new Date(r.last_consumed_at).toLocaleTimeString("de-DE")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
