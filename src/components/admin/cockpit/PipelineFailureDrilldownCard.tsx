import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, AlertOctagon, Power, History } from "lucide-react";
import { toast } from "sonner";

type AuditRow = {
  id: string;
  run_id: string;
  caller_id: string | null;
  window_minutes: number;
  requeued_count: number;
  requeued_ids: string[];
  error_classes_touched: { error_code: string; count: number }[];
  reaper_summary: Record<string, unknown>;
  before_snapshot: unknown[];
  after_snapshot: unknown[];
  delta_summary: {
    before_failure_total?: number;
    after_failure_total?: number;
    delta?: number;
    distinct_error_classes_touched?: number;
  };
  created_at: string;
};

type Row = {
  job_type: string;
  error_code: string;
  error_sample: string;
  failure_count: number;
  affected_packages: number;
  first_seen: string;
  last_seen: string;
  sample_job_ids: string[];
  classification:
    | "expected_guard"
    | "infra_transient"
    | "rate_limit"
    | "unclassified_silent"
    | "pipeline_blocker"
    | "other";
};

const CLASS_VARIANT: Record<Row["classification"], "default" | "secondary" | "destructive" | "outline"> = {
  expected_guard: "secondary",
  infra_transient: "outline",
  rate_limit: "outline",
  unclassified_silent: "secondary",
  pipeline_blocker: "destructive",
  other: "outline",
};

export default function PipelineFailureDrilldownCard() {
  const [windowMin, setWindowMin] = useState(60);
  const qc = useQueryClient();

  const restart = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_pipeline_worker_restart", {
        p_window_minutes: windowMin,
        p_max_requeue: 100,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast.success("Worker restart ausgelöst", {
        description: `requeued: ${data?.requeued ?? 0} · Δ fails ${data?.delta?.delta ?? 0} · run_id ${String(data?.run_id ?? "").slice(0, 8)}`,
      });
      qc.invalidateQueries({ queryKey: ["admin-pipeline-failure-drilldown"] });
      qc.invalidateQueries({ queryKey: ["admin-launch-readiness-drilldown"] });
      qc.invalidateQueries({ queryKey: ["admin-pipeline-worker-restart-audit"] });
    },
    onError: (e: any) => toast.error("Worker restart fehlgeschlagen", { description: e?.message }),
  });

  const audit = useQuery({
    queryKey: ["admin-pipeline-worker-restart-audit"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_get_pipeline_worker_restart_audit", { p_limit: 5 });
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
    refetchInterval: 60_000,
  });

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin-pipeline-failure-drilldown", windowMin],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_get_pipeline_failure_drilldown", {
        p_window_minutes: windowMin,
        p_limit: 25,
      });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
  });

  const rows = data ?? [];
  const totals = rows.reduce(
    (acc, r) => {
      acc.total += Number(r.failure_count) || 0;
      acc[r.classification] = (acc[r.classification] || 0) + Number(r.failure_count);
      return acc;
    },
    { total: 0 } as Record<string, number>,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <AlertOctagon className="h-4 w-4 text-status-error" />
          Pipeline Failure Drilldown
          <span className="text-xs text-text-muted font-normal">
            ({totals.total} fails / {windowMin}min)
          </span>
        </CardTitle>
        <div className="flex items-center gap-2">
          {[15, 60, 240].map((m) => (
            <Button
              key={m}
              size="sm"
              variant={windowMin === m ? "default" : "outline"}
              onClick={() => setWindowMin(m)}
            >
              {m}m
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => restart.mutate()}
            disabled={restart.isPending}
            title="Reapt stale Processing-Jobs + requeut infra/rate_limit Failures im Fenster"
          >
            {restart.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Power className="h-4 w-4 mr-1" />}
            Worker Restart
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2 mb-3 text-xs">
          {(["pipeline_blocker", "infra_transient", "rate_limit", "expected_guard", "unclassified_silent", "other"] as const).map(
            (c) =>
              totals[c] ? (
                <Badge key={c} variant={CLASS_VARIANT[c]}>
                  {c}: {totals[c]}
                </Badge>
              ) : null,
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
          </div>
        ) : !rows.length ? (
          <p className="text-sm text-text-muted py-6 text-center">
            Keine fehlgeschlagenen Jobs im Fenster.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-text-muted">
                <tr className="border-b border-border">
                  <th className="text-left p-2">Job-Type</th>
                  <th className="text-left p-2">Code</th>
                  <th className="text-left p-2">Klassifikation</th>
                  <th className="text-right p-2">Fails</th>
                  <th className="text-right p-2">Pakete</th>
                  <th className="text-left p-2">Letzter</th>
                  <th className="text-left p-2">Sample</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/60 align-top hover:bg-surface-sunken/50">
                    <td className="p-2 font-mono text-text-primary">{r.job_type}</td>
                    <td className="p-2 font-mono text-text-secondary">{r.error_code}</td>
                    <td className="p-2">
                      <Badge variant={CLASS_VARIANT[r.classification]}>{r.classification}</Badge>
                    </td>
                    <td className="p-2 text-right text-text-primary font-semibold">{r.failure_count}</td>
                    <td className="p-2 text-right text-text-secondary">{r.affected_packages}</td>
                    <td className="p-2 whitespace-nowrap text-text-muted">
                      {r.last_seen ? new Date(r.last_seen).toLocaleTimeString("de-DE") : "—"}
                    </td>
                    <td className="p-2 max-w-[28rem]">
                      <div className="text-text-secondary truncate" title={r.error_sample}>
                        {r.error_sample || <span className="text-text-muted italic">silent</span>}
                      </div>
                      {r.sample_job_ids?.length ? (
                        <div className="font-mono text-[10px] text-text-muted truncate">
                          {r.sample_job_ids[0]?.slice(0, 8)}…
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-border">
          <div className="flex items-center gap-2 mb-2 text-xs text-text-muted">
            <History className="h-3.5 w-3.5" />
            <span className="font-semibold">Letzte Worker-Restarts</span>
          </div>
          {audit.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
          ) : !audit.data?.length ? (
            <p className="text-xs text-text-muted italic">Noch keine Restart-Runs.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-text-muted">
                  <tr className="border-b border-border">
                    <th className="text-left p-1.5">Zeit</th>
                    <th className="text-left p-1.5">run_id</th>
                    <th className="text-right p-1.5">Fenster</th>
                    <th className="text-right p-1.5">requeued</th>
                    <th className="text-right p-1.5">Vorher</th>
                    <th className="text-right p-1.5">Nachher</th>
                    <th className="text-right p-1.5">Δ</th>
                    <th className="text-left p-1.5">Fehlerklassen</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.map((a) => {
                    const before = a.delta_summary?.before_failure_total ?? 0;
                    const after = a.delta_summary?.after_failure_total ?? 0;
                    const delta = a.delta_summary?.delta ?? after - before;
                    return (
                      <tr key={a.id} className="border-b border-border/60 align-top">
                        <td className="p-1.5 whitespace-nowrap text-text-muted">
                          {new Date(a.created_at).toLocaleTimeString("de-DE")}
                        </td>
                        <td className="p-1.5 font-mono text-text-secondary">{a.run_id.slice(0, 8)}</td>
                        <td className="p-1.5 text-right text-text-secondary">{a.window_minutes}m</td>
                        <td className="p-1.5 text-right font-semibold text-text-primary">{a.requeued_count}</td>
                        <td className="p-1.5 text-right text-text-secondary">{before}</td>
                        <td className="p-1.5 text-right text-text-secondary">{after}</td>
                        <td className={`p-1.5 text-right font-semibold ${delta < 0 ? "text-status-success" : delta > 0 ? "text-status-error" : "text-text-muted"}`}>
                          {delta > 0 ? "+" : ""}{delta}
                        </td>
                        <td className="p-1.5">
                          <div className="flex flex-wrap gap-1">
                            {(a.error_classes_touched || []).slice(0, 4).map((ec, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] px-1 py-0">
                                {ec.error_code}: {ec.count}
                              </Badge>
                            ))}
                            {!a.error_classes_touched?.length && (
                              <span className="text-text-muted italic">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
