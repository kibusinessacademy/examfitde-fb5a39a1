/**
 * SeoJobHealthCard
 *
 * Surfaces admin_get_seo_job_health() in the Heal-Cockpit Diagnostics tab.
 * Per SEO job_type: pending / processing / failed_1h / cancelled_1h /
 * EMPTY_RESULT / HTTP_400 / REQUEUE_LOOP / failure_rate_pct_1h /
 * oldest_pending_age_minutes / alert_severity.
 *
 * Includes:
 *  - Reload (manual refresh)
 *  - CSV export
 *  - Rollback-flag hint for ops_feature_flags.seo_sitemap_refresh_producer_enabled
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  RefreshCw,
  Download,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  ShieldAlert,
  Search,
} from "lucide-react";
import { SeoAlertDrilldownDialog } from "./SeoAlertDrilldownDialog";
import { SeoRollbackDialog } from "./SeoRollbackDialog";

type SeoJobHealthRow = {
  job_type: string;
  pending_count: number;
  processing_count: number;
  failed_1h: number;
  failed_6h: number;
  cancelled_1h: number;
  empty_result_1h: number;
  http_400_1h: number;
  requeue_loop_1h: number;
  total_1h: number;
  failure_rate_pct_1h: number | null;
  oldest_pending_age_minutes: number | null;
  alert_severity: string | null;
};

type FlagRow = { flag_key: string; enabled: boolean | null };

function severityBadge(sev: string | null) {
  const s = (sev ?? "ok").toLowerCase();
  if (s === "critical" || s === "p0")
    return (
      <Badge variant="destructive" className="gap-1">
        <ShieldAlert className="h-3 w-3" /> CRIT
      </Badge>
    );
  if (s === "high" || s === "warn" || s === "p1")
    return (
      <Badge className="gap-1 bg-warning text-warning-foreground hover:bg-warning/90">
        <AlertTriangle className="h-3 w-3" /> WARN
      </Badge>
    );
  if (s === "info" || s === "p2")
    return (
      <Badge variant="outline" className="gap-1">
        <AlertCircle className="h-3 w-3" /> INFO
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1">
      <ShieldCheck className="h-3 w-3" /> OK
    </Badge>
  );
}

function severityRank(sev: string | null): number {
  const s = (sev ?? "ok").toLowerCase();
  if (s === "critical" || s === "p0") return 3;
  if (s === "high" || s === "warn" || s === "p1") return 2;
  if (s === "info" || s === "p2") return 1;
  return 0;
}

function toCsv(rows: SeoJobHealthRow[]): string {
  const cols: (keyof SeoJobHealthRow)[] = [
    "job_type",
    "alert_severity",
    "pending_count",
    "processing_count",
    "failed_1h",
    "failed_6h",
    "cancelled_1h",
    "empty_result_1h",
    "http_400_1h",
    "requeue_loop_1h",
    "total_1h",
    "failure_rate_pct_1h",
    "oldest_pending_age_minutes",
  ];
  const head = cols.join(",");
  const body = rows
    .map((r) =>
      cols
        .map((c) => {
          const v = r[c];
          if (v == null) return "";
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
  return `${head}\n${body}`;
}

export function SeoJobHealthCard() {
  const [drilldownJobType, setDrilldownJobType] = useState<string | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const health = useQuery({
    queryKey: ["heal-cockpit", "seo-job-health"],
    queryFn: async (): Promise<SeoJobHealthRow[]> => {
      const { data, error } = await supabase.rpc(
        "admin_get_seo_job_health" as never,
      );
      if (error) throw error;
      return (data as unknown as SeoJobHealthRow[]) ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const flag = useQuery({
    queryKey: ["heal-cockpit", "seo-feature-flags"],
    queryFn: async (): Promise<FlagRow[]> => {
      const { data, error } = await supabase
        .from("ops_feature_flags" as never)
        .select("flag_key, enabled")
        .like("flag_key", "seo_%");
      if (error) throw error;
      return (data as unknown as FlagRow[]) ?? [];
    },
    staleTime: 60_000,
  });

  const sortedRows = useMemo(() => {
    const rows = health.data ?? [];
    return [...rows].sort(
      (a, b) =>
        severityRank(b.alert_severity) - severityRank(a.alert_severity) ||
        b.failed_1h - a.failed_1h ||
        a.job_type.localeCompare(b.job_type),
    );
  }, [health.data]);

  const worst = useMemo(() => {
    const ranks = sortedRows.map((r) => severityRank(r.alert_severity));
    return Math.max(0, ...ranks);
  }, [sortedRows]);

  const sitemapFlag = flag.data?.find(
    (f) => f.flag_key === "seo_sitemap_refresh_producer_enabled",
  );

  const onExport = () => {
    if (!sortedRows.length) {
      toast.info("Keine Zeilen zum Export");
      return;
    }
    const csv = toCsv(sortedRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `seo-job-health-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("CSV exportiert");
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">SEO Job Health</CardTitle>
          {health.isLoading
            ? null
            : worst === 0
              ? severityBadge("ok")
              : worst === 1
                ? severityBadge("info")
                : worst === 2
                  ? severityBadge("warn")
                  : severityBadge("critical")}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={onExport}
            disabled={health.isFetching || !sortedRows.length}
            title="CSV exportieren"
          >
            <Download className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => health.refetch()}
            disabled={health.isFetching}
            title="Neu laden"
          >
            <RefreshCw
              className={`h-3 w-3 ${health.isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {sitemapFlag ? (
          <div
            className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${
              sitemapFlag.enabled === false
                ? "border-warning/30 bg-warning-bg-subtle"
                : "border-emerald-500/30 bg-success-bg-subtle"
            }`}
          >
            <div className="text-text-secondary">
              {sitemapFlag.enabled === false ? (
                <>
                  <strong className="font-semibold text-text-primary">
                    Rollback aktiv:
                  </strong>{" "}
                  <code className="font-mono">
                    seo_sitemap_refresh_producer_enabled = false
                  </code>
                  . Producer pausiert; Restjobs drainen normal.
                </>
              ) : (
                <>
                  Sitemap-Refresh-Producer:{" "}
                  <code className="font-mono">enabled</code>.
                </>
              )}
            </div>
            <Button
              size="sm"
              variant={sitemapFlag.enabled === false ? "default" : "outline"}
              onClick={() => setRollbackOpen(true)}
              title="Flag toggeln (admin-gated, audited)"
            >
              {sitemapFlag.enabled === false ? "Aktivieren" : "Rollback…"}
            </Button>
          </div>
        ) : null}

        {health.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : health.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive-bg-subtle px-3 py-2 text-xs text-destructive">
            Fehler beim Laden: {(health.error as Error).message}
          </div>
        ) : sortedRows.length === 0 ? (
          <div className="text-xs text-text-secondary">
            Keine SEO-Jobs in den letzten 60 Min beobachtet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-subtle text-left text-text-secondary">
                  <th className="py-1.5 pr-2 font-medium">Job-Type</th>
                  <th className="py-1.5 pr-2 font-medium">Sev</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Pend</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Proc</th>
                  <th className="py-1.5 pr-2 text-right font-medium">
                    Fail 1h
                  </th>
                  <th className="py-1.5 pr-2 text-right font-medium">
                    Canc 1h
                  </th>
                  <th className="py-1.5 pr-2 text-right font-medium">
                    Empty 1h
                  </th>
                  <th className="py-1.5 pr-2 text-right font-medium">
                    HTTP 400 1h
                  </th>
                  <th className="py-1.5 pr-2 text-right font-medium">
                    Requeue 1h
                  </th>
                  <th className="py-1.5 pr-2 text-right font-medium">
                    Fail-Rate
                  </th>
                  <th className="py-1.5 pr-2 text-right font-medium">
                    Oldest&nbsp;(min)
                  </th>
                  <th className="py-1.5 pr-2 text-right font-medium">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr
                    key={r.job_type}
                    className="border-b border-border-subtle/60 align-middle"
                  >
                    <td className="py-1.5 pr-2 font-mono text-text-primary">
                      {r.job_type}
                    </td>
                    <td className="py-1.5 pr-2">
                      {severityBadge(r.alert_severity)}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.pending_count}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.processing_count}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.failed_1h}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.cancelled_1h}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.empty_result_1h}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.http_400_1h}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.requeue_loop_1h}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.failure_rate_pct_1h == null
                        ? "—"
                        : `${Number(r.failure_rate_pct_1h).toFixed(1)}%`}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.oldest_pending_age_minutes ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5"
                        onClick={() => setDrilldownJobType(r.job_type)}
                        title="Alert-Details + Jobs anzeigen"
                        aria-label={`Drilldown ${r.job_type}`}
                      >
                        <Search className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-[10px] text-text-secondary">
          Quelle: <code className="font-mono">admin_get_seo_job_health()</code>{" "}
          • Auto-Refresh 60 s • Severity-Sort • Klick auf{" "}
          <Search className="inline h-2.5 w-2.5" /> öffnet Alert-/Job-Drilldown.
        </div>
      </CardContent>

      <SeoAlertDrilldownDialog
        open={drilldownJobType !== null}
        onOpenChange={(o) => !o && setDrilldownJobType(null)}
        jobType={drilldownJobType}
      />
    </Card>
  );
}
