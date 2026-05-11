/**
 * SeoAlertDrilldownDialog — Heal-Cockpit SEO Card Step 2.
 *
 * Two-section drilldown:
 *  1) Recent seo_job_health_alert audit entries (when alerts were emitted)
 *  2) Recent jobs for the selected job_type (status, error, attempts, age)
 *
 * Triggered from per-row "Details" button in SeoJobHealthCard.
 */
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ShieldCheck, Clock } from "lucide-react";

type AlertLogRow = {
  id: string;
  created_at: string;
  result_status: string | null;
  alerts_emitted: number;
  rows: any;
  metadata: any;
};

type JobRow = {
  id: string;
  status: string;
  attempts: number;
  last_error_code: string | null;
  last_error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  age_seconds: number;
};

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "failed")
    return <Badge variant="destructive">{status}</Badge>;
  if (s === "cancelled")
    return (
      <Badge className="bg-warning text-warning-foreground hover:bg-warning/90">
        {status}
      </Badge>
    );
  if (s === "processing")
    return (
      <Badge className="bg-info text-info-foreground hover:bg-info/90">
        {status}
      </Badge>
    );
  if (s === "pending" || s === "queued")
    return <Badge variant="outline">{status}</Badge>;
  if (s === "completed" || s === "done")
    return (
      <Badge className="bg-success text-success-foreground hover:bg-success/90">
        {status}
      </Badge>
    );
  return <Badge variant="outline">{status}</Badge>;
}

function fmtAge(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

export function SeoAlertDrilldownDialog({
  open,
  onOpenChange,
  jobType,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobType: string | null;
}) {
  const alertsQ = useQuery({
    enabled: open,
    queryKey: ["heal-cockpit", "seo-alert-log"],
    queryFn: async (): Promise<AlertLogRow[]> => {
      const { data, error } = await supabase.rpc(
        "admin_get_seo_alert_log" as never,
        { p_limit: 25 } as never,
      );
      if (error) throw error;
      return (data as unknown as AlertLogRow[]) ?? [];
    },
    staleTime: 30_000,
  });

  const jobsQ = useQuery({
    enabled: open && !!jobType,
    queryKey: ["heal-cockpit", "seo-jobs-drilldown", jobType],
    queryFn: async (): Promise<JobRow[]> => {
      const { data, error } = await supabase.rpc(
        "admin_get_seo_jobs_drilldown" as never,
        { p_job_type: jobType, p_window_minutes: 60, p_limit: 50 } as never,
      );
      if (error) throw error;
      return (data as unknown as JobRow[]) ?? [];
    },
    staleTime: 15_000,
  });

  // Filter alert rows that mention this job_type (best-effort: rows is an array of {job_type,...})
  const filteredAlerts = (alertsQ.data ?? []).map((entry) => {
    const rows = Array.isArray(entry.rows) ? entry.rows : [];
    const matching = jobType
      ? rows.filter((r: any) => r?.job_type === jobType)
      : rows;
    return { ...entry, _matching: matching };
  });

  const alertsWithMatch = filteredAlerts.filter(
    (e) => e.alerts_emitted > 0 || e._matching.length > 0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            SEO Alert Drilldown
            {jobType && (
              <code className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {jobType}
              </code>
            )}
          </DialogTitle>
          <DialogDescription>
            Letzte Alert-Audits + jüngste Jobs (60-Min-Fenster).
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-3">
          {/* ── Section 1: Alert-Log ── */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              Alert-Audit (letzte 25 Läufe)
            </h3>
            {alertsQ.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : alertsQ.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive-bg-subtle px-3 py-2 text-xs text-destructive">
                Fehler: {(alertsQ.error as Error).message}
              </div>
            ) : alertsWithMatch.length === 0 ? (
              <div className="rounded-md border border-emerald-500/20 bg-success-bg-subtle px-3 py-2 text-xs text-text-secondary">
                Keine Alert-Treffer
                {jobType ? <> für <code className="font-mono">{jobType}</code></> : null}{" "}
                in den letzten 25 Läufen.{" "}
                <span className="text-text-secondary">
                  ({alertsQ.data?.length ?? 0} Audit-Läufe inspiziert, alle ohne Treffer.)
                </span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {alertsWithMatch.slice(0, 8).map((a) => (
                  <div
                    key={a.id}
                    className="rounded-md border border-warning/30 bg-warning-bg-subtle px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-text-primary">
                        {new Date(a.created_at).toLocaleString("de-DE", {
                          dateStyle: "short",
                          timeStyle: "medium",
                        })}
                      </span>
                      <Badge variant="outline" className="font-mono">
                        {a.alerts_emitted} alerts
                      </Badge>
                    </div>
                    {a._matching.length > 0 && (
                      <pre className="mt-1.5 max-h-32 overflow-auto rounded bg-background/40 p-1.5 font-mono text-[10px] text-text-secondary">
                        {JSON.stringify(a._matching, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Section 2: Recent Jobs for this job_type ── */}
          {jobType && (
            <section className="mt-5 space-y-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
                <Clock className="h-3.5 w-3.5" />
                Jobs (60-Min-Fenster)
              </h3>
              {jobsQ.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : jobsQ.isError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive-bg-subtle px-3 py-2 text-xs text-destructive">
                  Fehler: {(jobsQ.error as Error).message}
                </div>
              ) : (jobsQ.data ?? []).length === 0 ? (
                <div className="rounded-md border border-border-subtle bg-muted/30 px-3 py-2 text-xs text-text-secondary">
                  Keine Jobs im Fenster.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border-subtle text-left text-text-secondary">
                        <th className="py-1.5 pr-2 font-medium">Status</th>
                        <th className="py-1.5 pr-2 font-medium">Code</th>
                        <th className="py-1.5 pr-2 font-medium">Fehler</th>
                        <th className="py-1.5 pr-2 text-right font-medium">Vers.</th>
                        <th className="py-1.5 pr-2 text-right font-medium">Alter</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(jobsQ.data ?? []).map((j) => (
                        <tr
                          key={j.id}
                          className="border-b border-border-subtle/60 align-top"
                        >
                          <td className="py-1.5 pr-2">{statusBadge(j.status)}</td>
                          <td className="py-1.5 pr-2 font-mono text-text-primary">
                            {j.last_error_code ?? "—"}
                          </td>
                          <td className="py-1.5 pr-2 text-text-secondary">
                            <div className="max-w-[28ch] truncate" title={j.last_error ?? ""}>
                              {j.last_error ?? "—"}
                            </div>
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {j.attempts}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-text-secondary">
                            {fmtAge(j.age_seconds)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
