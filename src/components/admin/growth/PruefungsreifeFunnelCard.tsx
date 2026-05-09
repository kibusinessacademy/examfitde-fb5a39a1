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
  question_source: "blueprint" | "generic" | null;
  since: string;
  stages: Stage[];
  completion_rate_pct: number;
  cta_rate_pct: number;
  checkout_rate_pct: number;
  package_resolution: { total: number; resolved: number; fallback: number; resolved_pct: number };
  mc_score?: { avg_pct: number | null; samples: number };
  self_score_avg?: number | null;
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

const SOURCES: Array<{ label: string; value: "all" | "blueprint" | "generic" }> = [
  { label: "Alle", value: "all" },
  { label: "Blueprint", value: "blueprint" },
  { label: "Generic", value: "generic" },
];

const SEVERITY_STYLE: Record<string, string> = {
  critical: "border-status-error/40 bg-status-error-subtle text-status-error-foreground",
  warning:  "border-status-warning/40 bg-status-warning-subtle text-status-warning-foreground",
  info:     "border-status-info/40 bg-status-info-subtle text-status-info-foreground",
};

async function fetchFunnel(days: number, source: "all" | "blueprint" | "generic"): Promise<FunnelData> {
  const { data, error } = await supabase.rpc(
    "admin_get_pruefungsreife_funnel" as never,
    { p_days: days, p_question_source: source === "all" ? null : source } as never,
  );
  if (error) throw error;
  return data as unknown as FunnelData;
}

export default function PruefungsreifeFunnelCard() {
  const [days, setDays] = useState(7);
  const [source, setSource] = useState<"all" | "blueprint" | "generic">("all");
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["pruefungsreife-funnel", days, source],
    queryFn: () => fetchFunnel(days, source),
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
                const hasMix = s.real_events !== undefined && s.fallback_events !== undefined;
                const total = (s.real_events ?? 0) + (s.fallback_events ?? 0);
                const fallbackPct = hasMix && total > 0
                  ? Math.round(100 * (s.fallback_events ?? 0) / total)
                  : null;
                const resolvedPct = fallbackPct !== null ? 100 - fallbackPct : null;
                const fallbackBadge =
                  fallbackPct === null ? null
                  : fallbackPct === 0 ? "border-success/40 text-success"
                  : fallbackPct > 40 ? "border-status-warning/40 text-status-warning-foreground"
                  : "border-border text-text-tertiary";
                return (
                  <div key={s.key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs gap-2 flex-wrap">
                      <span className="text-text-secondary flex items-center gap-1.5">
                        {idx + 1}. {s.label}
                        {hasMix && (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className={`text-[10px] h-5 cursor-help ${fallbackBadge}`}>
                                  strict {resolvedPct}% · fallback {fallbackPct}%
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                <div className="space-y-1">
                                  <div><b>Strict:</b> {s.key} mit aufgelöster <code>package_id</code> ({s.real_events})</div>
                                  <div><b>Fallback:</b> <code>lead_magnet_view</code> mit <code>metadata.stage='{s.key}'</code> ({s.fallback_events})</div>
                                  <div className="text-text-tertiary">Beide zählen — Fallback ist sicher, aber nicht paketgebunden.</div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
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
                    <div className="h-2 rounded-full bg-surface-sunken overflow-hidden flex">
                      {hasMix && total > 0 ? (
                        <>
                          <div
                            className="h-full bg-primary transition-[width] duration-500"
                            style={{ width: `${widthPct * (s.real_events! / total)}%` }}
                            title={`strict: ${s.real_events}`}
                          />
                          <div
                            className="h-full bg-status-warning/60 transition-[width] duration-500"
                            style={{ width: `${widthPct * (s.fallback_events! / total)}%` }}
                            title={`fallback: ${s.fallback_events}`}
                          />
                        </>
                      ) : (
                        <div
                          className="h-full bg-primary transition-[width] duration-500"
                          style={{ width: `${widthPct}%` }}
                        />
                      )}
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

            {/* Strict/Fallback Mapping-Hint */}
            {(() => {
              const started = data.stages.find((s) => s.key === "quiz_started");
              const completed = data.stages.find((s) => s.key === "quiz_completed");
              const strictCount = (started?.real_events ?? 0) + (completed?.real_events ?? 0);
              const fallbackCount = (started?.fallback_events ?? 0) + (completed?.fallback_events ?? 0);
              const totalQuiz = strictCount + fallbackCount;
              if (totalQuiz === 0) {
                return (
                  <div className="rounded-lg border border-border-subtle bg-surface-sunken p-3 text-xs text-text-tertiary flex gap-2">
                    <Info className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>Noch keine Quiz-Events im Fenster. Strict (<code>quiz_started</code>/<code>quiz_completed</code> mit <code>package_id</code>) vs. Fallback (<code>lead_magnet_view</code> + <code>metadata.stage</code>) wird hier sichtbar, sobald Traffic eingeht.</span>
                  </div>
                );
              }
              const fallbackShare = Math.round(100 * fallbackCount / totalQuiz);
              const isHigh = fallbackShare > 40;
              return (
                <div
                  className={`rounded-lg border p-3 text-xs flex gap-2 ${
                    isHigh
                      ? "border-status-warning/40 bg-status-warning-subtle text-status-warning-foreground"
                      : "border-success/40 bg-success/10 text-text-primary"
                  }`}
                >
                  {isHigh ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
                  <div className="space-y-1">
                    <div className="font-semibold">
                      {isHigh
                        ? `Fallback-Anteil hoch: ${fallbackShare}% der Quiz-Events`
                        : `Tracking sauber: ${100 - fallbackShare}% der Quiz-Events sind package_id-konform`}
                    </div>
                    <div className="text-text-secondary">
                      {isHigh
                        ? "Viele Quiz-Events laufen über Fallback. Prüfe Slug→package_id Resolver oder direkten Traffic ohne Berufskontext."
                        : "Strict-Events erlauben paketgenaues GTM-Mapping und Conversion-Attribution."}
                      {" "}<span className="text-text-tertiary">Strict {strictCount} · Fallback {fallbackCount}.</span>
                    </div>
                  </div>
                </div>
              );
            })()}

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
