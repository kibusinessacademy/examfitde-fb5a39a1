import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, AlertTriangle } from "lucide-react";

type Dashboard = {
  metrics: {
    current_60m: number;
    previous_60m: number;
    cancels_60m: number;
    multiplier: number | null;
    severity: "ok" | "warn" | "crit";
    threshold_explained: string;
    threshold_warn_absolute: number;
    threshold_crit_absolute: number;
    threshold_warn_min_for_multiplier: number;
    threshold_warn_multiplier: number;
    measured_at: string;
  };
  top_partitions: Array<{
    job_type: string;
    protect_reason: string;
    package_id: string | null;
    package_status: string;
    skips: number;
    pct_of_total: number | null;
    last_seen: string;
  }>;
  recent_skips: Array<{
    id: string;
    created_at: string;
    job_id: string | null;
    job_type: string | null;
    protect_reason: string | null;
    package_id: string | null;
    package_status: string | null;
    exempt_from_auto_cancel: boolean | null;
    payload_is_repair: boolean | null;
    meta_is_repair: boolean | null;
  }>;
  jobs_context: Array<{
    id: string;
    job_type: string;
    status: string;
    last_error: string | null;
    last_error_code: string | null;
    package_id: string | null;
  }>;
  runbook: string;
  window_min: number;
  generated_at: string;
};

const SEV_LABEL: Record<string, string> = {
  ok: "OK",
  warn: "WARN",
  crit: "CRIT",
};

export function OpsCancelSkipRiseCard() {
  const [showRunbook, setShowRunbook] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["ops-cancel-skip-rise-dashboard"],
    queryFn: async (): Promise<Dashboard> => {
      const { data, error } = await supabase.rpc(
        "admin_get_ops_cancel_skip_rise_dashboard" as any,
        { p_window_min: 60 } as any,
      );
      if (error) throw error;
      return data as Dashboard;
    },
    refetchInterval: 30_000,
  });

  const sev = data?.metrics?.severity ?? "ok";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-status-warning" />
            Ops Cancel · Skip-Rise Live
          </CardTitle>
          <p className="text-xs text-text-muted mt-1">
            Auto-Refresh 30s · Window {data?.window_min ?? 60}m
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={sev === "crit" ? "destructive" : sev === "warn" ? "secondary" : "outline"}
          >
            {SEV_LABEL[sev]}
          </Badge>
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !data ? (
          <div className="text-text-muted text-sm">Lade Metriken …</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Metric label="Skips · 60m" value={data.metrics.current_60m} />
              <Metric label="Skips · Vorstunde" value={data.metrics.previous_60m} />
              <Metric
                label="Multiplier"
                value={data.metrics.multiplier == null ? "—" : `${data.metrics.multiplier}×`}
              />
              <Metric label="Cancels · 60m" value={data.metrics.cancels_60m} />
            </div>

            <div className="rounded-md border border-border-subtle bg-surface-muted p-3">
              <div className="text-xs font-medium text-text-secondary mb-1">
                Schwellwert-Begründung
              </div>
              <div className="text-sm">{data.metrics.threshold_explained}</div>
              <div className="text-xs text-text-muted mt-2">
                warn ≥ {data.metrics.threshold_warn_absolute} · crit ≥{" "}
                {data.metrics.threshold_crit_absolute} · oder ≥{" "}
                {data.metrics.threshold_warn_min_for_multiplier} mit Multiplier ≥{" "}
                {data.metrics.threshold_warn_multiplier}×
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-2">
                Top-Partitionen · job_type × protect_reason
              </div>
              {data.top_partitions.length === 0 ? (
                <div className="text-text-muted text-sm">Keine Skips im Fenster.</div>
              ) : (
                <ScrollArea className="h-56 rounded-md border border-border-subtle">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-muted sticky top-0">
                      <tr className="text-left">
                        <th className="px-2 py-1">job_type</th>
                        <th className="px-2 py-1">protect_reason</th>
                        <th className="px-2 py-1">pkg_status</th>
                        <th className="px-2 py-1 text-right">skips</th>
                        <th className="px-2 py-1 text-right">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top_partitions.map((p, i) => (
                        <tr key={i} className="border-t border-border-subtle">
                          <td className="px-2 py-1 font-mono">{p.job_type}</td>
                          <td className="px-2 py-1">{p.protect_reason}</td>
                          <td className="px-2 py-1">{p.package_status}</td>
                          <td className="px-2 py-1 text-right">{p.skips}</td>
                          <td className="px-2 py-1 text-right">{p.pct_of_total ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </div>

            <div>
              <div className="text-sm font-medium mb-2">Letzte Skip-Events</div>
              {data.recent_skips.length === 0 ? (
                <div className="text-text-muted text-sm">Keine Events.</div>
              ) : (
                <ScrollArea className="h-48 rounded-md border border-border-subtle">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-muted sticky top-0">
                      <tr className="text-left">
                        <th className="px-2 py-1">Zeit</th>
                        <th className="px-2 py-1">job_type</th>
                        <th className="px-2 py-1">Reason</th>
                        <th className="px-2 py-1">exempt</th>
                        <th className="px-2 py-1">repair</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_skips.map((r) => (
                        <tr key={r.id} className="border-t border-border-subtle">
                          <td className="px-2 py-1 whitespace-nowrap">
                            {new Date(r.created_at).toLocaleTimeString()}
                          </td>
                          <td className="px-2 py-1 font-mono">{r.job_type ?? "?"}</td>
                          <td className="px-2 py-1">{r.protect_reason ?? "?"}</td>
                          <td className="px-2 py-1">{r.exempt_from_auto_cancel ? "✓" : "—"}</td>
                          <td className="px-2 py-1">
                            {r.payload_is_repair || r.meta_is_repair ? "✓" : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </div>

            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowRunbook((s) => !s)}
              >
                {showRunbook ? "Runbook ausblenden" : "Runbook + Debug-Queries anzeigen"}
              </Button>
              {showRunbook && (
                <pre className="mt-2 rounded-md border border-border-subtle bg-surface-muted p-3 text-xs whitespace-pre-wrap font-mono">
                  {data.runbook}
                </pre>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-muted p-3">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
