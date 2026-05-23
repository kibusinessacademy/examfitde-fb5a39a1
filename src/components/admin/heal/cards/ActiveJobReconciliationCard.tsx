import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Snapshot = {
  counts: Record<string, number>;
  examples: Record<
    string,
    Array<{
      job_id: string;
      job_type: string;
      package_id: string | null;
      step_key: string | null;
      status: string;
      attempts: number;
      max_attempts: number;
      created_at: string;
    }>
  >;
  computed_at: string;
};

const CLASS_ORDER = [
  "STALE_PROCESSING",
  "ORPHANED_ACTIVE",
  "DAG_SUPERSEDED",
  "RETRYABLE_STUCK",
  "TERMINAL_DRIFT",
  "HEALTHY_ACTIVE",
];

const ACTIONABLE = new Set([
  "STALE_PROCESSING",
  "ORPHANED_ACTIVE",
  "DAG_SUPERSEDED",
  "RETRYABLE_STUCK",
]);

export function ActiveJobReconciliationCard() {
  const qc = useQueryClient();
  const [lastResult, setLastResult] = useState<{
    dry_run: boolean;
    actions: number;
    reset_to_pending: number;
    cancelled_superseded: number;
    requeued: number;
    skipped: number;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["active-job-reconciliation"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_active_job_reconciliation" as any,
        { p_limit_per_class: 5 },
      );
      if (error) throw error;
      return data as Snapshot;
    },
    refetchInterval: 15_000,
  });

  const dispatch = useMutation({
    mutationFn: async (opts: { dry_run: boolean }) => {
      const { data, error } = await supabase.rpc(
        "admin_active_job_reconcile_dispatch" as any,
        { p_dry_run: opts.dry_run, p_max_actions: 50 },
      );
      if (error) throw error;
      return data as typeof lastResult;
    },
    onSuccess: (res) => {
      setLastResult(res);
      toast.success(
        `${res?.dry_run ? "Dry-Run" : "Apply"} — actions=${res?.actions} (reset=${res?.reset_to_pending}, cancel=${res?.cancelled_superseded}, requeue=${res?.requeued}, skip=${res?.skipped})`,
      );
      if (!res?.dry_run) {
        qc.invalidateQueries({ queryKey: ["active-job-reconciliation"] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const counts = data?.counts ?? {};
  const actionableTotal = Array.from(ACTIONABLE).reduce(
    (s, k) => s + (counts[k] ?? 0),
    0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Active-Job Reconciliation (P2.5)</span>
          <Badge variant={actionableTotal > 0 ? "destructive" : "outline"}>
            actionable: {actionableTotal}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">
          Klassifiziert offene Jobs in HEALTHY / STALE_PROCESSING / ORPHANED_ACTIVE
          / DAG_SUPERSEDED / RETRYABLE_STUCK / TERMINAL_DRIFT. Re-Enqueue mit
          hartem Contract: attempts=0, parent_job_id, requeue_reason,
          enqueue_source.
        </div>

        <div className="flex flex-wrap gap-2">
          {CLASS_ORDER.map((c) => (
            <Badge
              key={c}
              variant={ACTIONABLE.has(c) && (counts[c] ?? 0) > 0 ? "destructive" : "secondary"}
            >
              {c}: {counts[c] ?? 0}
            </Badge>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={dispatch.isPending}
            onClick={() => dispatch.mutate({ dry_run: true })}
          >
            Dry-Run (max 50)
          </Button>
          <Button
            size="sm"
            disabled={dispatch.isPending || actionableTotal === 0}
            onClick={() => {
              if (
                !window.confirm(
                  `Apply Reconcile (max 50)? actionable=${actionableTotal}`,
                )
              )
                return;
              dispatch.mutate({ dry_run: false });
            }}
          >
            Apply (max 50)
          </Button>
        </div>

        {lastResult && (
          <div className="rounded border p-2 text-xs">
            <div className="font-semibold">
              Letzter Lauf — {lastResult.dry_run ? "DRY" : "APPLIED"}
            </div>
            <div>
              actions={lastResult.actions} reset={lastResult.reset_to_pending}{" "}
              cancel={lastResult.cancelled_superseded} requeue=
              {lastResult.requeued} skip={lastResult.skipped}
            </div>
          </div>
        )}

        {!isLoading && data?.examples && (
          <div className="space-y-3">
            {CLASS_ORDER.filter((c) => ACTIONABLE.has(c) && (counts[c] ?? 0) > 0).map(
              (c) => (
                <div key={c}>
                  <div className="text-xs font-semibold mb-1">
                    {c} — Beispiele
                  </div>
                  <div className="overflow-x-auto rounded border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted">
                        <tr>
                          <th className="p-1 text-left">job</th>
                          <th className="p-1 text-left">type</th>
                          <th className="p-1 text-left">step</th>
                          <th className="p-1 text-left">status</th>
                          <th className="p-1 text-right">att</th>
                          <th className="p-1 text-left">created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data.examples[c] ?? []).map((j) => (
                          <tr key={j.job_id} className="border-t">
                            <td className="p-1 font-mono">
                              {j.job_id.slice(0, 8)}
                            </td>
                            <td className="p-1">{j.job_type}</td>
                            <td className="p-1">{j.step_key ?? "—"}</td>
                            <td className="p-1">{j.status}</td>
                            <td className="p-1 text-right">
                              {j.attempts}/{j.max_attempts}
                            </td>
                            <td className="p-1">
                              {new Date(j.created_at).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
