/**
 * LaneReasonBreakdownCard — pro Lane: warum stehen Pending-Jobs?
 * Trennt echte Zombies, DAG-wartend, Bronze, Manual-Review, Complete.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Layers, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { LaneDrilldownDialog } from "./LaneDrilldownDialog";

interface Row {
  lane: string;
  pending_total: number;
  true_zombies: number;
  dag_waiting: number;
  bronze_locked: number;
  manual_review: number;
  complete_packages: number;
  reason_summary: string;
}

export function LaneReasonBreakdownCard() {
  const [drillLane, setDrillLane] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["lane-reason-breakdown"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_lane_reason_breakdown" as any);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 30_000,
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Layers className="h-4 w-4" /> Lane-Reason Breakdown (SSOT)
        </h3>
        <Badge variant="outline" className="text-[10px]">live · 30s</Badge>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <TooltipProvider>
          <div className="space-y-2">
            {(q.data ?? []).map((row) => {
              const critical = row.true_zombies > 0;
              return (
                <div
                  key={row.lane}
                  className={cn(
                    "rounded-md border p-3 text-xs",
                    critical && "border-destructive/50 bg-destructive/5",
                  )}
                >
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold">{row.lane}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {row.pending_total} pending
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground italic text-[11px]">
                        {row.reason_summary}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setDrillLane(row.lane)}
                      >
                        <Search className="h-3 w-3 mr-1" /> Drilldown
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    <ReasonMetric
                      label="echte Zombies"
                      value={row.true_zombies}
                      tooltip="Pending > 30min, Paket nicht in Bronze/Review/Published, keine offenen DAG-Steps. Echter Heal nötig."
                      tone={row.true_zombies > 0 ? "danger" : "ok"}
                    />
                    <ReasonMetric
                      label="DAG-wartend"
                      value={row.dag_waiting}
                      tooltip="Vorgelagerte Build-Steps noch offen (queued/failed/blocked). Kein Zombie — wartet bewusst."
                      tone="info"
                    />
                    <ReasonMetric
                      label="Bronze"
                      value={row.bronze_locked}
                      tooltip="feature_flags.bronze.locked = true. Wird vom Bronze-Guard absichtlich nicht ausgeführt."
                      tone="warn"
                    />
                    <ReasonMetric
                      label="Manual Review"
                      value={row.manual_review}
                      tooltip="Status requires_review/manual_review. Wartet auf Admin-Entscheidung."
                      tone="warn"
                    />
                    <ReasonMetric
                      label="Published"
                      value={row.complete_packages}
                      tooltip="Paket bereits published — Job sollte gecancelt werden."
                      tone="info"
                    />
                  </div>
                </div>
              );
            })}
            {(q.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">
                Keine Pending-Jobs in irgendeiner Lane.
              </p>
            )}
          </div>
        </TooltipProvider>
      )}
      <LaneDrilldownDialog
        lane={drillLane}
        open={!!drillLane}
        onOpenChange={(v) => !v && setDrillLane(null)}
      />
    </Card>
  );
}

function ReasonMetric({
  label,
  value,
  tooltip,
  tone,
}: {
  label: string;
  value: number;
  tooltip: string;
  tone: "ok" | "info" | "warn" | "danger";
}) {
  const toneClass = {
    ok: "text-muted-foreground",
    info: "text-foreground",
    warn: "text-warning",
    danger: "text-destructive",
  }[tone];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="cursor-help">
          <div className="text-muted-foreground text-[10px]">{label}</div>
          <div className={cn("font-bold tabular-nums", toneClass)}>{value}</div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
