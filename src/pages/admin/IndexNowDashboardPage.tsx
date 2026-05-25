import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, PlayCircle, Database, AlertCircle } from "lucide-react";
import { KpiCard } from "@/components/admin/cards/KpiCard";
import { formatDateTime } from "@/components/admin/lib/admin-utils";

type IndexNowSummary = {
  totals: {
    total_pending: number;
    total_failed: number;
    total_success: number;
    success_24h: number;
    success_7d: number;
    success_30d: number;
    last_success_at: string | null;
    oldest_pending_at: string | null;
    oldest_pending_minutes: number | null;
  };
  by_source: Array<{ source_type: string; status: string; count: number; last_at: string | null }>;
  by_path_prefix: Array<{
    path_prefix: string;
    success_count: number;
    pending_count: number;
    failed_count: number;
    last_success_at: string | null;
  }>;
  recent_failures: Array<{
    url: string;
    http_status: number | null;
    error: string;
    retry_count: number;
    updated_at: string;
  }>;
  oldest_pending: Array<{
    url: string;
    source_type: string;
    created_at: string;
    retry_count: number;
  }>;
  generated_at: string;
};

const SITEMAP_TOTAL_HINT = 2601;

export default function IndexNowDashboardPage() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-indexnow-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_indexnow_status_summary");
      if (error) throw error;
      return data as unknown as IndexNowSummary;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const invokeAction = useMutation({
    mutationFn: async (payload: { action: string; dry_run?: boolean; limit?: number; chunk_size?: number }) => {
      const { data, error } = await supabase.functions.invoke("seo-submit-indexnow", { body: payload });
      if (error) throw error;
      return data;
    },
    onSuccess: (data, vars) => {
      toast({
        title: `${vars.action} ✓`,
        description: JSON.stringify(data).slice(0, 240),
      });
      qc.invalidateQueries({ queryKey: ["admin-indexnow-summary"] });
    },
    onError: (err: Error) => {
      toast({ title: "Aktion fehlgeschlagen", description: err.message, variant: "destructive" });
    },
    onSettled: () => setBusy(null),
  });

  const trigger = (action: string, extra?: Record<string, unknown>) => {
    setBusy(action);
    invokeAction.mutate({ action, ...extra } as never);
  };

  const totals = data?.totals;
  const coveragePct = totals
    ? Math.min(100, Math.round((totals.total_success / Math.max(SITEMAP_TOTAL_HINT, 1)) * 100))
    : 0;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">IndexNow Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Submission-Status, Coverage, Pending-Backlog und Drain-/Backfill-Steuerung.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Neu laden
          </Button>
          <Button
            size="sm"
            onClick={() => trigger("drain_pending", { limit: 500, chunk_size: 50 })}
            disabled={!!busy}
          >
            {busy === "drain_pending" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
            Pending drainen (max 500)
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => trigger("backfill_sitemap", { dry_run: true })}
            disabled={!!busy}
          >
            {busy === "backfill_sitemap_dry" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
            Backfill (Dry-Run)
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm("Sitemap-Backfill: alle nicht abgedeckten URLs aus sitemap.xml in IndexNow-Queue (pending) einfügen. Fortfahren?")) {
                trigger("backfill_sitemap");
              }
            }}
            disabled={!!busy}
          >
            {busy === "backfill_sitemap" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
            Backfill (Live)
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => trigger("retry_failed")}
            disabled={!!busy}
          >
            Failed retry
          </Button>
        </div>
      </header>

      {error && (
        <Card className="border-destructive/50 bg-destructive/10 p-4 text-sm">
          <AlertCircle className="mb-1 inline h-4 w-4 text-destructive" /> {(error as Error).message}
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Pending"
          value={totals?.total_pending ?? "–"}
          hint={
            totals?.oldest_pending_minutes
              ? `ältester ${Math.round(totals.oldest_pending_minutes)} min`
              : "keine Backlog-Einträge"
          }
        />
        <KpiCard
          label="Success 24h / 7d"
          value={totals ? `${totals.success_24h} / ${totals.success_7d}` : "–"}
          hint={`gesamt: ${totals?.total_success ?? "–"}`}
        />
        <KpiCard
          label="Failed gesamt"
          value={totals?.total_failed ?? "–"}
          hint="≥1 Retry empfohlen"
        />
        <KpiCard
          label="Coverage*"
          value={`${coveragePct} %`}
          hint={`Success-URLs / ~${SITEMAP_TOTAL_HINT} Sitemap-URLs`}
        />
      </div>

      {/* Coverage bar */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span>Sitemap-Coverage (Success / Hint-Total)</span>
          <span className="font-medium">{coveragePct} %</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${coveragePct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Letzter erfolgreicher Submit: {formatDateTime(totals?.last_success_at)}
          {" · "}
          Letztes Refresh: {formatDateTime(data?.generated_at)}
        </p>
      </Card>

      {/* By path prefix (sub-sitemap proxy) */}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Coverage pro URL-Pfad (Proxy für Sub-Sitemaps)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2">Pfad</th>
                <th className="py-2 text-right">Success</th>
                <th className="py-2 text-right">Pending</th>
                <th className="py-2 text-right">Failed</th>
                <th className="py-2">Letzter Success</th>
              </tr>
            </thead>
            <tbody>
              {(data?.by_path_prefix ?? []).map((row) => (
                <tr key={row.path_prefix} className="border-b last:border-b-0">
                  <td className="py-2 font-mono text-xs">{row.path_prefix}</td>
                  <td className="py-2 text-right text-emerald-600">{row.success_count}</td>
                  <td className="py-2 text-right text-amber-600">{row.pending_count}</td>
                  <td className="py-2 text-right text-rose-600">{row.failed_count}</td>
                  <td className="py-2 text-xs text-muted-foreground">{formatDateTime(row.last_success_at)}</td>
                </tr>
              ))}
              {!data?.by_path_prefix?.length && (
                <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">Keine Daten</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* By source type */}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Aufschlüsselung nach Quelle
        </h2>
        <div className="flex flex-wrap gap-2">
          {(data?.by_source ?? []).map((s) => (
            <Badge
              key={`${s.source_type}-${s.status}`}
              variant={s.status === "success" ? "default" : s.status === "pending" ? "secondary" : "destructive"}
              className="text-xs"
            >
              {s.source_type} · {s.status}: {s.count}
            </Badge>
          ))}
          {!data?.by_source?.length && <span className="text-sm text-muted-foreground">Keine Daten</span>}
        </div>
      </Card>

      {/* Oldest pending */}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Älteste 20 Pending-Einträge
        </h2>
        <div className="space-y-1 text-xs font-mono">
          {(data?.oldest_pending ?? []).map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-2 truncate border-b py-1 last:border-b-0">
              <span className="truncate">{p.url}</span>
              <span className="shrink-0 text-muted-foreground">
                {p.source_type} · retry {p.retry_count} · {formatDateTime(p.created_at)}
              </span>
            </div>
          ))}
          {!data?.oldest_pending?.length && <p className="text-sm text-muted-foreground">Backlog leer.</p>}
        </div>
      </Card>

      {/* Recent failures */}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Letzte 20 Fehler
        </h2>
        <div className="space-y-1 text-xs">
          {(data?.recent_failures ?? []).map((f, i) => (
            <div key={i} className="border-b py-2 last:border-b-0">
              <div className="font-mono truncate">{f.url}</div>
              <div className="text-muted-foreground">
                HTTP {f.http_status ?? "–"} · retry {f.retry_count} · {formatDateTime(f.updated_at)}
              </div>
              {f.error && <div className="mt-0.5 text-rose-600">{f.error}</div>}
            </div>
          ))}
          {!data?.recent_failures?.length && <p className="text-sm text-muted-foreground">Keine Fehler.</p>}
        </div>
      </Card>
    </div>
  );
}
