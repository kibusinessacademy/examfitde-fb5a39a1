import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Wave = {
  wave_id: string;
  started_at: string;
  last_event_at: string;
  dispatched: number;
  skipped: number;
  completed: number;
  failed: number;
  tail_released: number;
  avg_runtime_s: number | null;
  bronze_remaining: number;
};

type Snapshot = {
  bronze_remaining_total: number;
  bronze_eligible: number;
  waves: Wave[];
  computed_at: string;
};

export function BronzeDrainWaveCard() {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["bronze-drain-waves"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_bronze_drain_waves" as any,
        { p_limit: 10 },
      );
      if (error) throw error;
      return data as Snapshot;
    },
    refetchInterval: 15_000,
  });

  const dispatch = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_bronze_drain_canary_dispatch" as any,
        { p_batch_size: 5 },
      );
      if (error) throw error;
      return data as {
        wave_id: string;
        dispatched: number;
        skipped: number;
        skip_reasons: Record<string, number>;
      };
    },
    onSuccess: (res) => {
      toast.success(
        `Bronze-Drain Wave ${res.wave_id.slice(0, 8)} — dispatched ${res.dispatched}, skipped ${res.skipped}`,
      );
      qc.invalidateQueries({ queryKey: ["bronze-drain-waves"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Bronze-Drain Canary (P2)</span>
          <span className="flex items-center gap-2">
            <Badge variant="outline">
              eligible: {data?.bronze_eligible ?? "…"}
            </Badge>
            <Badge variant="secondary">
              total: {data?.bronze_remaining_total ?? "…"}
            </Badge>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">
          Reaktiviert die ältesten Bronze-Pakete in 5er-Wellen. Stop-Conditions:
          failed-Spike, duplicate Repair-Jobs, queue-pressure Anstieg, neue
          DAG-Inkonsistenzen. Zwischen Wellen 15–30 min beobachten.
        </div>
        <Button
          size="sm"
          disabled={
            pending ||
            dispatch.isPending ||
            (data?.bronze_eligible ?? 0) === 0
          }
          onClick={() => {
            if (
              !window.confirm(
                `Canary-Welle (5 Pakete) starten? Eligible: ${data?.bronze_eligible ?? 0}`,
              )
            )
              return;
            setPending(true);
            dispatch.mutate(undefined, { onSettled: () => setPending(false) });
          }}
        >
          Canary starten (5)
        </Button>

        <div className="overflow-x-auto rounded border">
          <table className="w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="p-2 text-left">Wave</th>
                <th className="p-2 text-left">gestartet</th>
                <th className="p-2 text-right">disp.</th>
                <th className="p-2 text-right">skip</th>
                <th className="p-2 text-right">done</th>
                <th className="p-2 text-right">fail</th>
                <th className="p-2 text-right">tail</th>
                <th className="p-2 text-right">avg s</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="p-4 text-center">
                    lädt…
                  </td>
                </tr>
              )}
              {!isLoading && (data?.waves?.length ?? 0) === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="p-4 text-center text-muted-foreground"
                  >
                    noch keine Welle
                  </td>
                </tr>
              )}
              {data?.waves?.map((w) => (
                <tr key={w.wave_id} className="border-t">
                  <td className="p-2 font-mono">{w.wave_id.slice(0, 8)}</td>
                  <td className="p-2">
                    {new Date(w.started_at).toLocaleString()}
                  </td>
                  <td className="p-2 text-right">{w.dispatched}</td>
                  <td className="p-2 text-right">{w.skipped}</td>
                  <td className="p-2 text-right">{w.completed}</td>
                  <td className="p-2 text-right">{w.failed}</td>
                  <td className="p-2 text-right">{w.tail_released}</td>
                  <td className="p-2 text-right">
                    {w.avg_runtime_s ? Math.round(w.avg_runtime_s) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
