/**
 * ThroughputCard — Live Queue Throughput v2 metrics.
 * Source: RPC admin_get_queue_throughput_v2(p_window_hours)
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Props { windowHours?: number }

export function ThroughputCard({ windowHours = 6 }: Props) {
  const throughput = useQuery({
    queryKey: ["queue-throughput-v2", windowHours],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_queue_throughput_v2" as any,
        { p_window_hours: windowHours },
      );
      if (error) throw error;
      return data as any;
    },
    refetchInterval: 30_000,
  });

  const d = throughput.data;
  const claimable = d?.pending_claimable_now ?? 0;
  const deferred = d?.pending_deferred_future ?? 0;
  const terminal = d?.pending_admin_terminal ?? 0;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Queue Throughput ({windowHours}h)</h3>
        <Badge variant="outline" className="text-[10px]">live · v2</Badge>
      </div>
      {d ? (
        <>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Metric label="jobs/h" value={d.jobs_per_hour ?? 0} />
            <Metric label={`done (${windowHours}h)`} value={d.completed_total ?? 0} />
            <Metric label="duration p50" value={`${d.duration_p50_sec ?? 0}s`} />
            <Metric label="duration p95" value={`${d.duration_p95_sec ?? 0}s`} />
            <Metric label="pending wait p50" value={`${Math.round((d.pending_wait_p50_sec ?? 0) / 60)}m`} />
            <Metric
              label="pending wait p95"
              value={`${Math.round((d.pending_wait_p95_sec ?? 0) / 60)}m`}
              danger={(d.pending_wait_p95_sec ?? 0) > 3600}
            />
            <Metric label="lifecycle p95" value={`${d.lifecycle_p95_sec ?? 0}s`} />
            <Metric
              label="oldest processing"
              value={`${Math.round(d.processing_oldest_sec ?? 0)}s`}
              danger={(d.processing_oldest_sec ?? 0) > 600}
            />
          </div>
          <div className="mt-3 pt-2 border-t border-border flex flex-wrap gap-2 text-[10px]">
            <Badge variant="secondary">claimable now: {claimable}</Badge>
            <Badge variant="outline">deferred (run_after future): {deferred}</Badge>
            {terminal > 0 && <Badge variant="outline">admin_terminal: {terminal}</Badge>}
            <span className="text-text-muted self-center" title={String(d.metric_definition ?? "")}>
              p50/p95 = effective wait (ohne deferred & terminal)
            </span>
          </div>
        </>
      ) : (
        <Skeleton className="h-24 w-full" />
      )}
    </Card>
  );
}

function Metric({ label, value, danger }: { label: string; value: any; danger?: boolean }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-bold tabular-nums", danger && "text-destructive")}>{value}</div>
    </div>
  );
}
