import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDown, ArrowUp, Minus, RefreshCw } from "lucide-react";
import { format } from "date-fns";

interface DiffRow {
  bucket: {
    package_id: string | null;
    job_type: string;
    lane: string;
    pool: string;
    track: string;
    claim_state: string;
  };
  prev_n: number;
  curr_n: number;
  delta: number;
  prev_run_at: string;
  curr_run_at: string;
}

const STATE_TONE: Record<string, string> = {
  PROCESSING_WITHOUT_HEARTBEAT: "bg-status-error-bg-subtle text-status-error-fg",
  PROCESSING_WITH_HEARTBEAT: "bg-status-info-bg-subtle text-status-info-fg",
  PENDING_DEFERRED: "bg-status-warning-bg-subtle text-status-warning-fg",
  PENDING_CLAIMABLE: "bg-status-warning-bg-subtle text-status-warning-fg",
  FAILED: "bg-status-error-bg-subtle text-status-error-fg",
  DONE: "bg-status-success-bg-subtle text-status-success-fg",
  CANCELLED: "bg-surface-muted text-text-muted",
};

function deltaBadge(delta: number) {
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-status-error-fg font-medium">
        <ArrowUp className="h-3 w-3" /> +{delta}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-status-success-fg font-medium">
        <ArrowDown className="h-3 w-3" /> {delta}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-text-muted">
      <Minus className="h-3 w-3" /> 0
    </span>
  );
}

export function AggregateStateDiffCard() {
  const [filter, setFilter] = useState("");
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["aggregate-state-diff"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_aggregate_state_diff" as any, {
        p_scope: "nightly",
      });
      if (error) throw error;
      return (data ?? []) as DiffRow[];
    },
    refetchInterval: 60_000,
  });

  const filtered = (data ?? []).filter((r) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (
      r.bucket.job_type?.toLowerCase().includes(f) ||
      r.bucket.lane?.toLowerCase().includes(f) ||
      r.bucket.pool?.toLowerCase().includes(f) ||
      r.bucket.track?.toLowerCase().includes(f) ||
      r.bucket.claim_state?.toLowerCase().includes(f)
    );
  });

  const top = filtered.slice(0, 50);
  const meta = data?.[0];

  return (
    <Card className="shadow-elev-1">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Nightly Aggregate-State Diff</CardTitle>
            <CardDescription>
              Top-50 deltas package × job_type × lane × pool × track × claim-state
              {meta && (
                <span className="ml-2 text-xs">
                  · prev {format(new Date(meta.prev_run_at), "MMM d HH:mm")} →
                  curr {format(new Date(meta.curr_run_at), "MMM d HH:mm")}
                </span>
              )}
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="agg-diff-refresh"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <div className="pt-2">
          <Input
            placeholder="Filter by job_type / lane / pool / track / claim_state…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8"
            data-testid="agg-diff-filter"
          />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : top.length === 0 ? (
          <p className="text-sm text-text-muted py-6 text-center">
            No diffs yet — needs ≥2 nightly snapshots (cron 03:17 UTC).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-text-muted">
                <tr className="border-b border-border-subtle">
                  <th className="text-left py-2 pr-2">Job Type</th>
                  <th className="text-left py-2 pr-2">Lane / Pool</th>
                  <th className="text-left py-2 pr-2">Track</th>
                  <th className="text-left py-2 pr-2">State</th>
                  <th className="text-right py-2 pr-2">Prev</th>
                  <th className="text-right py-2 pr-2">Curr</th>
                  <th className="text-right py-2">Δ</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r, i) => (
                  <tr key={i} className="border-b border-border-subtle/50">
                    <td className="py-1.5 pr-2 font-mono">{r.bucket.job_type}</td>
                    <td className="py-1.5 pr-2 text-text-muted">
                      {r.bucket.lane}/{r.bucket.pool}
                    </td>
                    <td className="py-1.5 pr-2 text-text-muted">{r.bucket.track}</td>
                    <td className="py-1.5 pr-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${STATE_TONE[r.bucket.claim_state] ?? ""}`}
                      >
                        {r.bucket.claim_state}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r.prev_n}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r.curr_n}</td>
                    <td className="py-1.5 text-right">{deltaBadge(r.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AggregateStateDiffCard;
