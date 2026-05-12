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

// Klassen-Konfiguration (gespiegelt aus den drain_*-RPCs).
// Quelle: migration 20260512115118 + memory multi-class-drain-orchestrator-v1
const CLASS_CONFIG: Record<
  string,
  { batch: number; wipCap: number; jobType: string; eligibility: string }
> = {
  bronze_review_required: {
    batch: 5,
    wipCap: 5,
    jobType: "package_elite_harden",
    eligibility: "bronze_locked, score 75–84, repair_attempts<1, !repair_active",
  },
  needs_integrity: {
    batch: 10,
    wipCap: 10,
    jobType: "package_run_integrity_check",
    eligibility: "status∈(building,queued), kein aktiver integrity-Job",
  },
  pool_gap: {
    batch: 3,
    wipCap: 3,
    jobType: "package_repair_exam_pool_quality",
    eligibility: "POOL_GAP_REPAIR, kein aktiver pool-repair-Job",
  },
  trap_gap: {
    batch: 2,
    wipCap: 2,
    jobType: "package_exam_rebalance",
    eligibility: "TRAP_GAP_REPAIR, kein aktiver rebalance-Job",
  },
};

const STOP_REASON_LABEL: Record<string, string> = {
  wip_cap: "WIP-Cap erreicht",
  global_cap: "globaler Cap (20/Run) erreicht",
  class_empty: "keine eligiblen Pakete",
  health_gate_red: "Health-Gate rot (Hard-Stop)",
  repair_already_active: "Repair bereits aktiv",
  not_bronze: "kein Bronze-Status",
  attempts_exhausted: "max. Repair-Versuche erreicht",
};

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
            · health {lastRun.metadata?.health?.healthy ? "ok" : "degraded"} · global cap{" "}
            {lastRun.metadata?.global_cap ?? 20}
          </div>
        )}

        {/* Klassen-Matrix: Stop-Reason + Grenzwerte aus letztem Lauf */}
        <div>
          <p className="text-xs font-medium mb-2">Stop-Reason &amp; Grenzwerte je Klasse</p>
          <div className="space-y-1">
            {(Object.keys(CLASS_CONFIG) as Array<keyof typeof CLASS_CONFIG>).map((key) => {
              const cfg = CLASS_CONFIG[key];
              const batch = lastBatches.find(
                (b) => b.action_type === `drain_${key}_batch`,
              );
              const m = (batch?.metadata ?? {}) as Record<string, any>;
              const enq = m.enqueued ?? 0;
              const active = m.active ?? m.wip ?? m.in_flight;
              const cap = m.cap ?? m.wip_cap ?? cfg.wipCap;
              const rawReason = (m.skipped_reason ?? m.stopped_reason) as string | undefined;
              const reasonLabel = rawReason
                ? STOP_REASON_LABEL[rawReason] ?? rawReason
                : enq > 0
                ? "ok – enqueued"
                : "—";
              const status = batch?.result_status ?? "—";
              // Curated metadata-keys (per class). Rest fällt in raw-JSON.
              const KNOWN = new Set([
                "enqueued", "active", "wip", "in_flight", "cap", "wip_cap",
                "skipped_reason", "stopped_reason",
              ]);
              const extraEntries = Object.entries(m).filter(
                ([k]) => !KNOWN.has(k),
              );
              const health = m.health ?? lastRun?.metadata?.health;
              const globalCap = lastRun?.metadata?.global_cap ?? 20;
              const totalEnq = lastRun?.metadata?.total_enqueued ?? 0;
              return (
                <div
                  key={key}
                  className="text-xs border rounded px-2 py-2 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium">{key.toUpperCase()}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={enq > 0 ? "default" : status === "noop" ? "muted" : "outline"}>
                        +{enq}
                      </Badge>
                      <Badge variant={rawReason ? "warning" : "success"}>
                        {reasonLabel}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                    <span>WIP: <span className="font-mono text-foreground">{active ?? "?"}/{cap}</span></span>
                    <span>Batch-Limit: <span className="font-mono text-foreground">{cfg.batch}</span></span>
                    <span className="col-span-2">Job-Type: <span className="font-mono text-foreground">{cfg.jobType}</span></span>
                    <span className="col-span-2">Eligible: <span className="text-foreground">{cfg.eligibility}</span></span>
                    {batch && (
                      <span className="col-span-2">
                        Letzter Batch:{" "}
                        {formatDistanceToNow(new Date(batch.created_at), { addSuffix: true })} · status {status}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {lastBatches.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Batch-Historie ({lastBatches.length})
            </summary>
            <div className="space-y-1 mt-2">
              {lastBatches.map((b, i) => {
                const enq = b.metadata?.enqueued ?? 0;
                const reason = b.metadata?.skipped_reason;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between border rounded px-2 py-1"
                  >
                    <span className="font-mono">
                      {b.action_type.replace("drain_", "").replace("_batch", "")}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant={enq > 0 ? "default" : "outline"}>+{enq}</Badge>
                      {reason && <Badge variant="outline">{reason}</Badge>}
                      <span className="text-muted-foreground">
                        {formatDistanceToNow(new Date(b.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
