/**
 * PruefungsreifeFunnelCard — Drop-off-Dashboard für den neuen Prüfungsreife-Funnel.
 *
 * Stages:
 *  1. landing_view
 *  2. quiz_started (real)  +  lead_magnet_view stage='quiz_started'   (fallback)
 *  3. quiz_completed (real) + lead_magnet_view stage='quiz_completed' (fallback)
 *  4. cta_click metadata.location='pruefungscheck_result_primary'
 *  5. checkout_start / checkout_started
 *
 * Quelle: RPC admin_get_pruefungsreife_funnel(days int).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, RefreshCw, TrendingDown, Activity, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";

type Stage = {
  key: string;
  label: string;
  count: number;
  real_events?: number;
  fallback_events?: number;
};
type FunnelData = {
  window_days: number;
  since: string;
  stages: Stage[];
  completion_rate_pct: number;
  cta_rate_pct: number;
  checkout_rate_pct: number;
  package_resolution: { total: number; resolved: number; fallback: number; resolved_pct: number };
  top_dropoff: { stage: string | null; pct: number | null };
  top_slugs: Array<{ slug: string; starts: number }>;
  insights: Array<{ severity: "info" | "warning" | "critical"; message: string }>;
  generated_at: string;
};

const WINDOWS = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
];

const SEVERITY_STYLE: Record<string, string> = {
  critical: "border-status-error/40 bg-status-error-subtle text-status-error-foreground",
  warning:  "border-status-warning/40 bg-status-warning-subtle text-status-warning-foreground",
  info:     "border-status-info/40 bg-status-info-subtle text-status-info-foreground",
};

async function fetchFunnel(days: number): Promise<FunnelData> {
  const { data, error } = await supabase.rpc(
    "admin_get_pruefungsreife_funnel" as never,
    { p_days: days } as never,
  );
  if (error) throw error;
  return data as unknown as FunnelData;
}

export default function PruefungsreifeFunnelCard() {
  const [days, setDays] = useState(7);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["pruefungsreife-funnel", days],
    queryFn: () => fetchFunnel(days),
    staleTime: 60_000,
  });

  const maxCount = useMemo(
    () => Math.max(1, ...(data?.stages.map((s) => s.count) ?? [1])),
    [data],
  );

  return (
    <Card className="bg-surface-raised border-border-subtle">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Prüfungsreife-Funnel</CardTitle>
          {data && (
            <Badge variant="outline" className="text-[10px]">
              {data.window_days}d · gen. {new Date(data.generated_at).toLocaleTimeString("de-DE")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w.days}
              size="sm"
              variant={days === w.days ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setDays(w.days)}
            >
              {w.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => refetch()}
            aria-label="Aktualisieren"
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {error && (
          <div className="rounded-lg border border-status-error/40 bg-status-error-subtle p-3 text-sm">
            <AlertTriangle className="inline h-4 w-4 mr-1" />
            {(error as Error).message}
          </div>
        )}

        {isLoading || !data ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            {/* KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label="Starts" value={data.stages[1]?.count ?? 0} />
              <Kpi label="Abschluss" value={`${data.completion_rate_pct}%`} />
              <Kpi label="Result-CTA" value={`${data.cta_rate_pct}%`} />
              <Kpi label="Checkout" value={`${data.checkout_rate_pct}%`} />
            </div>

            {/* Funnel bars */}
            <div className="space-y-2">
              {data.stages.map((s, idx) => {
                const prev = idx > 0 ? data.stages[idx - 1].count : null;
                const drop = prev && prev > 0
                  ? Math.max(0, Math.round(100 * (prev - s.count) / prev))
                  : null;
                const widthPct = (s.count / maxCount) * 100;
                return (
                  <div key={s.key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-secondary">
                        {idx + 1}. {s.label}
                        {s.real_events !== undefined && (
                          <span className="ml-2 text-text-tertiary">
                            (real {s.real_events} · fallback {s.fallback_events})
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-text-primary">
                        {s.count.toLocaleString("de-DE")}
                        {drop !== null && drop > 0 && (
                          <span className="ml-2 text-status-warning-foreground">
                            <TrendingDown className="inline h-3 w-3" /> {drop}%
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-sunken overflow-hidden">
                      <div
                        className="h-full bg-primary transition-[width] duration-500"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Top dropoff + package resolution */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-border-subtle p-3">
                <div className="text-xs text-text-tertiary mb-1">Größter Drop-off</div>
                <div className="text-sm font-semibold text-text-primary">
                  {data.top_dropoff.stage ?? "—"}
                </div>
                <div className="text-xs text-status-warning-foreground mt-0.5">
                  {data.top_dropoff.pct ?? 0}% Verlust
                </div>
              </div>
              <div className="rounded-lg border border-border-subtle p-3">
                <div className="text-xs text-text-tertiary mb-1">package_id-Resolver</div>
                <div className="text-sm font-semibold text-text-primary">
                  {data.package_resolution.resolved_pct}% resolved
                </div>
                <div className="text-xs text-text-tertiary mt-0.5">
                  {data.package_resolution.resolved}/{data.package_resolution.total} strict-Events
                  · {data.package_resolution.fallback} Fallback
                </div>
              </div>
            </div>

            {/* Top slugs */}
            {data.top_slugs.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-text-secondary">Top 10 Slugs nach Starts</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                  {data.top_slugs.map((row) => (
                    <div key={row.slug} className="flex items-center justify-between text-xs">
                      <span className="truncate text-text-primary" title={row.slug}>{row.slug}</span>
                      <span className="font-mono text-text-tertiary">{row.starts}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Insights */}
            <div className="space-y-2">
              {data.insights.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Keine Auffälligkeiten im Funnel.
                </div>
              ) : (
                data.insights.map((ins, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border p-2.5 text-xs ${SEVERITY_STYLE[ins.severity] ?? ""}`}
                  >
                    {ins.message}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className="text-lg font-bold text-text-primary mt-0.5">
        {typeof value === "number" ? value.toLocaleString("de-DE") : value}
      </div>
    </div>
  );
}
