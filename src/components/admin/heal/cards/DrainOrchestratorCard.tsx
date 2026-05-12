import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, PlayCircle, Waves } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

type ClassRow = {
  class_name: string;
  enqueued: number;
  eligible_total: number;
  stopped_reason: string | null;
  gate_snapshot: Record<string, number>;
};

type LogRow = {
  action_type: string;
  result_status: string | null;
  created_at: string;
  metadata: any;
};

const CLASS_ORDER = [
  "BRONZE_REVIEW_REQUIRED",
  "NEEDS_INTEGRITY_FIRST",
  "POOL_GAP_REPAIR",
  "TRAP_GAP_REPAIR",
] as const;

/**
 * Multi-Class Drain-Orchestrator Cockpit.
 * Reads recent auto_heal_log runs (action_type=drain_orchestrator_run + per-class batches)
 * and exposes a manual trigger for admin_drain_class_orchestrator.
 * Cron `drain-orchestrator-10min` läuft autonom alle 10 min.
 */
export function DrainOrchestratorCard() {
  const qc = useQueryClient();

  const { data: logs, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["drain-orchestrator-log"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("auto_heal_log")
        .select("action_type,result_status,created_at,metadata")
        .in("action_type", [
          "drain_orchestrator_run",
          "drain_bronze_review_required_batch",
          "drain_needs_integrity_batch",
          "drain_pool_gap_batch",
          "drain_trap_gap_batch",
        ])
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as LogRow[];
    },
    refetchInterval: 30_000,
  });

  const trigger = useMutation({
    mutationFn: async (dry: boolean) => {
      const { data, error } = await supabase.rpc(
        "admin_drain_class_orchestrator" as any,
        { p_dry: dry } as any,
      );
      if (error) throw error;
      return data as ClassRow[];
    },
    onSuccess: (rows, dry) => {
      const total = rows.reduce((a, r) => a + (r.enqueued ?? 0), 0);
      toast.success(`${dry ? "Dry-Run" : "Run"}: ${total} enqueued (${rows.length} Klassen)`);
      qc.invalidateQueries({ queryKey: ["drain-orchestrator-log"] });
    },
    onError: (e: any) => toast.error(`Orchestrator fehlgeschlagen: ${e.message}`),
  });

  const lastRun = logs?.find((l) => l.action_type === "drain_orchestrator_run");
  const lastBatches = logs?.filter((l) => l.action_type !== "drain_orchestrator_run").slice(0, 8) ?? [];
  const gate = lastRun?.metadata?.gate_snapshot as Record<string, number> | undefined;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Waves className="h-5 w-5" /> Multi-Class Drain Orchestrator
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Bronze · Integrity · Pool · Trap. Auto-Cron alle 10 min. Global cap 20/Run.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => trigger.mutate(true)}
            disabled={trigger.isPending}
          >
            Dry
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => trigger.mutate(false)}
            disabled={trigger.isPending}
          >
            <PlayCircle className="h-3 w-3 mr-1" /> Run
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">Lade…</p>}

        {gate && (
          <div>
            <p className="text-xs font-medium mb-2">Gate-Snapshot (letzter Lauf)</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(gate)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <Badge key={k} variant={CLASS_ORDER.includes(k as any) ? "default" : "outline"}>
                    {k}: {v}
                  </Badge>
                ))}
            </div>
          </div>
        )}

        {lastRun && (
          <div className="text-xs text-muted-foreground">
            Letzter Run:{" "}
            {formatDistanceToNow(new Date(lastRun.created_at), { addSuffix: true })} ·{" "}
            <span className="font-medium">
              total enqueued {lastRun.metadata?.total_enqueued ?? 0}
            </span>{" "}
            · health {lastRun.metadata?.health?.healthy ? "ok" : "degraded"}
          </div>
        )}

        {lastBatches.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-2">Letzte Batches</p>
            <div className="space-y-1">
              {lastBatches.map((b, i) => {
                const enq = b.metadata?.enqueued ?? 0;
                const reason = b.metadata?.skipped_reason;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs border rounded px-2 py-1"
                  >
                    <span className="font-mono">
                      {b.action_type.replace("drain_", "").replace("_batch", "")}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant={enq > 0 ? "default" : "outline"}>
                        +{enq}
                      </Badge>
                      {reason && <Badge variant="outline">{reason}</Badge>}
                      <span className="text-muted-foreground">
                        {formatDistanceToNow(new Date(b.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
