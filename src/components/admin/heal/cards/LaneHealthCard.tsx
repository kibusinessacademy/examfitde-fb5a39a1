/**
 * LaneHealthCard — pro Lane (control/build/recovery): pending/processing,
 * letzter completed-Timestamp, completed in 6h, ältester Pending.
 * SSOT: job_queue.status='completed' (NICHT 'done'). Erkennt Worker-Stillstände
 * (Lane mit Pending > 0, aber completed_6h = 0) → kritisch markiert.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface LaneRow {
  lane: string;
  pending_cnt: number;
  processing_cnt: number;
  queued_cnt: number;
  last_completed_at: string | null;
  completed_6h: number;
  oldest_pending_sec: number | null;
}

function fmtAgo(ts: string | null): string {
  if (!ts) return "nie";
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function fmtSec(s: number | null): string {
  if (!s || s < 60) return `${s ?? 0}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function LaneHealthCard() {
  const q = useQuery({
    queryKey: ["admin-lane-health"],
    queryFn: async () => {
      // Primary: SECURITY DEFINER RPC with has_role gate
      const { data, error } = await supabase.rpc("admin_get_lane_health" as any);
      if (!error && Array.isArray(data) && data.length > 0) {
        return data as LaneRow[];
      }
      // Fallback: direct view query (works only if caller has SELECT grant or RLS allows)
      const { data: viewData, error: viewErr } = await supabase
        .from("v_admin_lane_health" as any)
        .select("*");
      if (viewErr && error) throw error;
      return ((viewData ?? data ?? []) as unknown) as LaneRow[];
    },
    refetchInterval: 30_000,
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4" /> Lane-Health
        </h3>
        <Badge variant="outline" className="text-[10px]">live · 30s</Badge>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="space-y-2">
          {(q.data ?? [])
            .sort((a, b) => (b.pending_cnt + b.processing_cnt) - (a.pending_cnt + a.processing_cnt))
            .map((row) => {
              // Differenziertes Stillstand-Signal:
              // - workerStalled: pending > 0, NICHTS processing, 0 completed in 6h
              //   → echter Worker-Pickup-Ausfall
              // - dagBacklog: pending > 0, processing > 0 (Worker leben), aber 0 completed
              //   → Jobs werden vom Claim-RPC ausgefiltert (DAG-Prereqs nicht erfüllt)
              const noCompletions = row.pending_cnt > 0 && row.completed_6h === 0;
              const workerStalled = noCompletions && row.processing_cnt === 0;
              const dagBacklog = noCompletions && row.processing_cnt > 0;
              const slow = (row.oldest_pending_sec ?? 0) > 3600;
              const critical = workerStalled || dagBacklog;
              return (
                <div
                  key={row.lane}
                  className={cn(
                    "rounded-md border p-3 text-xs",
                    critical && "border-destructive/50 bg-destructive/5",
                    !critical && slow && "border-warning/50 bg-warning/5",
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold">{row.lane}</span>
                      {workerStalled && (
                        <Badge variant="destructive" className="text-[10px]">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Worker-Stillstand
                        </Badge>
                      )}
                      {dagBacklog && (
                        <Badge variant="destructive" className="text-[10px]" title="Jobs werden vom Claim-RPC ausgefiltert: DAG-Prereqs nicht erfüllt (vorgelagerte Tail-Steps queued/failed). Heal via Stuck-Patterns Bulk-Promote oder Per-Step-Retry.">
                          <AlertTriangle className="h-3 w-3 mr-1" /> DAG-Backlog
                        </Badge>
                      )}
                      {!critical && slow && (
                        <Badge variant="outline" className="text-[10px] border-warning text-warning-foreground">
                          slow drain
                        </Badge>
                      )}
                    </div>
                    <span className="text-muted-foreground">
                      last completed: {fmtAgo(row.last_completed_at)} · completed_6h: {row.completed_6h}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <Metric label="pending" value={row.pending_cnt} />
                    <Metric label="processing" value={row.processing_cnt} />
                    <Metric label="queued" value={row.queued_cnt} />
                    <Metric label="oldest" value={fmtSec(row.oldest_pending_sec)} danger={slow} />
                  </div>
                </div>
              );
            })}
          {(q.data ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">Keine aktiven Lanes.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function Metric({ label, value, danger }: { label: string; value: any; danger?: boolean }) {
  return (
    <div>
      <div className="text-muted-foreground text-[10px]">{label}</div>
      <div className={cn("font-bold tabular-nums", danger && "text-destructive")}>{value}</div>
    </div>
  );
}
