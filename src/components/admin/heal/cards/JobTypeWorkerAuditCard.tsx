import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Activity } from "lucide-react";
import { useState } from "react";

type Row = {
  job_type: string;
  lane: string;
  pool: string;
  is_governance: boolean;
  requires_package_id: boolean;
  jobs_7d: number;
  done_7d: number;
  failed_7d: number;
  open_now: number;
  last_seen_at: string | null;
  last_completed_at: string | null;
  worker_status:
    | "HEALTHY"
    | "IDLE_7D"
    | "IDLE_30D"
    | "NEVER_SEEN"
    | "FAILING_ONLY"
    | "FAILING_DEGRADED";
};

const STATUS_BADGE: Record<Row["worker_status"], string> = {
  HEALTHY: "bg-status-success",
  IDLE_7D: "bg-status-warning-subtle text-status-warning",
  IDLE_30D: "bg-status-warning-subtle text-status-warning",
  NEVER_SEEN: "bg-muted text-text-muted",
  FAILING_ONLY: "bg-status-error",
  FAILING_DEGRADED: "bg-status-error-subtle text-status-error",
};

export function JobTypeWorkerAuditCard() {
  const [filter, setFilter] = useState<"ALL" | "PROBLEMS">("PROBLEMS");

  const q = useQuery({
    queryKey: ["job-type-worker-audit"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_job_type_worker_audit");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const rows = q.data ?? [];
  const summary = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.worker_status] = (acc[r.worker_status] ?? 0) + 1;
    return acc;
  }, {});

  const filtered =
    filter === "ALL"
      ? rows
      : rows.filter((r) => r.worker_status !== "HEALTHY");

  const exportCsv = () => {
    const header = ["job_type","lane","pool","worker_status","jobs_7d","done_7d","failed_7d","open_now","last_seen_at"];
    const csv = [header.join(",")]
      .concat(rows.map(r => [r.job_type, r.lane, r.pool, r.worker_status, r.jobs_7d, r.done_7d, r.failed_7d, r.open_now, r.last_seen_at ?? ""].join(",")))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `job-type-worker-audit-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <Card data-testid="job-type-worker-audit-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" /> Job-Type ↔ Worker Audit
            </CardTitle>
            <CardDescription>
              Pro aktivem Job-Type: Lane/Pool, 7-Tage-Throughput, letzte Sichtung, Worker-Status.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant={filter === "PROBLEMS" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter("PROBLEMS")}
            >
              Nur Probleme
            </Button>
            <Button
              variant={filter === "ALL" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter("ALL")}
            >
              Alle ({rows.length})
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
              CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(summary).map(([k, v]) => (
            <Badge key={k} className={STATUS_BADGE[k as Row["worker_status"]] ?? ""}>
              {k}: {v}
            </Badge>
          ))}
        </div>

        {q.isLoading && (
          <div className="flex items-center gap-2 px-3 py-6 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade Audit…
          </div>
        )}

        {q.error && (
          <div className="rounded-md border border-status-error/40 bg-status-error-subtle p-3 text-xs">
            Fehler: {(q.error as Error).message}
          </div>
        )}

        {!q.isLoading && filtered.length === 0 && (
          <div className="px-3 py-6 text-sm text-text-muted">
            {filter === "PROBLEMS" ? "Keine Probleme – alle Worker HEALTHY." : "Keine Daten."}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="rounded-md border">
            <div className="grid grid-cols-12 gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium">
              <div className="col-span-4">Job-Type</div>
              <div className="col-span-2">Lane / Pool</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-1 text-right">7d</div>
              <div className="col-span-1 text-right">done</div>
              <div className="col-span-1 text-right">failed</div>
              <div className="col-span-1 text-right">open</div>
            </div>
            <div className="max-h-[480px] overflow-y-auto">
              {filtered.map((r) => (
                <div
                  key={r.job_type}
                  className="grid grid-cols-12 items-center gap-2 border-b px-3 py-2 text-xs last:border-0"
                >
                  <div className="col-span-4 truncate font-mono">
                    {r.job_type}
                    {r.is_governance && (
                      <Badge variant="outline" className="ml-2 text-[10px]">gov</Badge>
                    )}
                  </div>
                  <div className="col-span-2 text-text-muted">
                    {r.lane} / {r.pool}
                  </div>
                  <div className="col-span-2">
                    <Badge className={STATUS_BADGE[r.worker_status] ?? ""}>
                      {r.worker_status}
                    </Badge>
                  </div>
                  <div className="col-span-1 text-right tabular-nums">{r.jobs_7d}</div>
                  <div className="col-span-1 text-right tabular-nums text-status-success">
                    {r.done_7d}
                  </div>
                  <div className="col-span-1 text-right tabular-nums text-status-error">
                    {r.failed_7d}
                  </div>
                  <div className="col-span-1 text-right tabular-nums">{r.open_now}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
