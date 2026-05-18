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
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, RefreshCw, TrendingDown, Activity, Info, Download } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toCsv, downloadCsv } from "@/lib/csv";

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
  question_source_invalid?: boolean;
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
  critical: "border-status-error-border bg-status-error-bg-subtle text-status-error-foreground",
  warning:  "border-status-warning-border bg-status-warning-bg-subtle text-status-warning-foreground",
  info:     "border-status-info-border bg-status-info-subtle text-status-info-foreground",
};

async function fetchFunnel(days: number, source: "all" | "blueprint" | "generic"): Promise<FunnelData> {
  const { data, error } = await supabase.rpc(
    "admin_get_pruefungsreife_funnel_v2" as never,
    { p_days: days, p_question_source: source === "all" ? null : source } as never,
  );
  if (error) {
    // Friendly normalization — keep raw message available via .cause for devtools.
    const friendly = /forbidden/i.test(error.message)
      ? "Du brauchst die Admin-Rolle, um den Prüfungsreife-Funnel zu sehen."
      : /function .* does not exist/i.test(error.message)
        ? "Funnel-Report v2 wurde noch nicht ausgerollt. Bitte Migration prüfen."
        : `Funnel konnte nicht geladen werden: ${error.message}`;
    // eslint-disable-next-line no-console
    console.warn("[PruefungsreifeFunnelCard] RPC v2 failed", { source, days, error });
    throw new Error(friendly);
  }
  return data as unknown as FunnelData;
}

const VALID_SOURCES = ["all", "blueprint", "generic"] as const;
type SourceValue = typeof VALID_SOURCES[number];

export default function PruefungsreifeFunnelCard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [days, setDays] = useState(7);

  // URL-param persistence: ?question_source=blueprint|generic|all
  const rawSourceParam = (searchParams.get("question_source") ?? "").toLowerCase();
  const isInvalidUrlSource =
    rawSourceParam !== "" && !(VALID_SOURCES as readonly string[]).includes(rawSourceParam);
  const initialSource: SourceValue = (VALID_SOURCES as readonly string[]).includes(rawSourceParam)
    ? (rawSourceParam as SourceValue)
    : "all";
  const [source, setSource] = useState<SourceValue>(initialSource);

  // One-shot toast for invalid URL param.
  const toastedInvalid = useRef(false);
  useEffect(() => {
    if (isInvalidUrlSource && !toastedInvalid.current) {
      toastedInvalid.current = true;
      toast.warning(`Ungültiger Filter "${rawSourceParam}" — auf "Alle" zurückgesetzt.`);
    }
  }, [isInvalidUrlSource, rawSourceParam]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (source === "all") next.delete("question_source");
    else next.set("question_source", source);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["pruefungsreife-funnel-v2", days, source],
    queryFn: () => fetchFunnel(days, source),
    staleTime: 60_000,
    retry: false,
  });

  const maxCount = useMemo(
    () => Math.max(1, ...(data?.stages.map((s) => s.count) ?? [1])),
    [data],
  );

  // ---------- Exports ----------
  function exportCurrentCsv() {
    if (!data) return;
    const rows: Record<string, unknown>[] = [
      ...data.stages.map((s, i) => ({
        section: "stage",
        idx: i + 1,
        key: s.key,
        label: s.label,
        count: s.count,
        real_events: s.real_events ?? "",
        fallback_events: s.fallback_events ?? "",
      })),
      { section: "kpi", key: "completion_rate_pct", count: data.completion_rate_pct },
      { section: "kpi", key: "cta_rate_pct", count: data.cta_rate_pct },
      { section: "kpi", key: "checkout_rate_pct_total_unfiltered", count: data.checkout_rate_pct },
      { section: "kpi", key: "mc_score_avg_pct", count: data.mc_score?.avg_pct ?? "", real_events: data.mc_score?.samples ?? 0 },
      { section: "kpi", key: "self_score_avg", count: data.self_score_avg ?? "" },
      { section: "kpi", key: "package_resolved_pct", count: data.package_resolution.resolved_pct, real_events: data.package_resolution.resolved, fallback_events: data.package_resolution.fallback },
      { section: "dropoff", key: data.top_dropoff.stage ?? "—", count: data.top_dropoff.pct ?? 0 },
      ...data.top_slugs.map((r) => ({ section: "top_slug", key: r.slug, count: r.starts })),
      ...data.insights.map((ins, i) => ({ section: "insight", idx: i, key: ins.severity, label: ins.message })),
    ];
    downloadCsv(`pruefungsreife-funnel_${source}_${days}d_${new Date().toISOString().slice(0,10)}.csv`, toCsv(rows));
  }

  async function exportAllSegmentsCsv() {
    try {
      const segs: SourceValue[] = ["all", "blueprint", "generic"];
      const results = await Promise.all(segs.map((s) => fetchFunnel(days, s)));
      const rows = results.flatMap((d, idx) => {
        const seg = segs[idx];
        return [
          {
            segment: seg,
            window_days: d.window_days,
            landing_view: d.stages.find((s) => s.key === "landing_view")?.count ?? 0,
            quiz_started: d.stages.find((s) => s.key === "quiz_started")?.count ?? 0,
            quiz_completed: d.stages.find((s) => s.key === "quiz_completed")?.count ?? 0,
            cta_click: d.stages.find((s) => s.key === "cta_click")?.count ?? 0,
            checkout_start_total_unfiltered: d.stages.find((s) => s.key === "checkout_start")?.count ?? 0,
            completion_rate_pct: d.completion_rate_pct,
            cta_rate_pct: d.cta_rate_pct,
            checkout_rate_pct: d.checkout_rate_pct,
            mc_avg_pct: d.mc_score?.avg_pct ?? "",
            mc_samples: d.mc_score?.samples ?? 0,
            self_score_avg: d.self_score_avg ?? "",
            resolved_pct: d.package_resolution.resolved_pct,
            top_dropoff_stage: d.top_dropoff.stage ?? "",
            top_dropoff_pct: d.top_dropoff.pct ?? 0,
          },
        ];
      });
      downloadCsv(`pruefungsreife-segments_${days}d_${new Date().toISOString().slice(0,10)}.csv`, toCsv(rows));
      toast.success("Segment-Export bereit.");
    } catch (e: unknown) {
      toast.error(`Segment-Export fehlgeschlagen: ${(e as Error).message}`);
    }
  }

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
            variant="outline"
            className="h-7 px-2 text-xs gap-1"
            onClick={exportCurrentCsv}
            disabled={!data}
            data-testid="export-current-csv"
            title="Aktuelle Detail-Auswertung als CSV"
          >
            <Download className="h-3 w-3" />
            CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs gap-1"
            onClick={exportAllSegmentsCsv}
            disabled={!data}
            data-testid="export-segments-csv"
            title="Alle/Blueprint/Generic Segment-KPIs als CSV"
          >
            <Download className="h-3 w-3" />
            Segmente
          </Button>
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
          <div className="rounded-lg border border-status-error-border bg-status-error-bg-subtle p-3 text-sm">
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
            {/* Source-Filter (Phase 2: question_source blueprint vs generic) */}
            <div className="flex items-center gap-2 flex-wrap" data-testid="pruefungsreife-source-filter">
              <span className="text-xs text-text-tertiary uppercase tracking-wide">Fragenquelle:</span>
              <div className="inline-flex rounded-lg border border-border-subtle bg-surface-sunken p-0.5" role="tablist">
                {SOURCES.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="tab"
                    onClick={() => setSource(opt.value)}
                    aria-pressed={source === opt.value}
                    aria-selected={source === opt.value}
                    data-testid={`source-toggle-${opt.value}`}
                    data-active={source === opt.value ? "true" : "false"}
                    className={`px-2.5 h-7 text-xs rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      source === opt.value
                        ? "bg-surface-raised text-text-primary shadow-elev-1 font-medium"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {source !== "all" && (
                <Badge variant="outline" className="text-[10px] border-petrol-300 text-petrol-700" data-testid="source-active-badge">
                  Filter aktiv: question_source = <code className="ml-1">{source}</code>
                </Badge>
              )}
              {(data.question_source_invalid || isInvalidUrlSource) && (
                <Badge variant="outline" className="text-[10px] border-status-warning-border text-status-warning-foreground" data-testid="source-invalid-badge">
                  Ungültiger Filterwert ignoriert
                </Badge>
              )}
              <span className="text-[10px] text-text-tertiary basis-full">
                Hinweis: Filter wirkt nur auf Quiz/Result/CTA-Stages. <b>landing_view</b> und <b>checkout_start</b> bleiben total (unfiltered).
              </span>
            </div>

            {/* KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label="Starts" value={data.stages[1]?.count ?? 0} />
              <Kpi label="Abschluss" value={`${data.completion_rate_pct}%`} />
              <Kpi label="Result-CTA" value={`${data.cta_rate_pct}%`} />
              <Kpi label="Checkout-Start (total)" value={`${data.checkout_rate_pct}%`} hint="unfiltered — Quelle ohne question_source" />
            </div>

            {/* MC vs Self-Score (Phase 2) — MC nur bei samples > 0 */}
            {((data.mc_score?.samples ?? 0) > 0 || (data.self_score_avg !== null && data.self_score_avg !== undefined)) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(data.mc_score?.samples ?? 0) > 0 && (
                  <div className="rounded-lg border border-border-subtle bg-surface-sunken p-3" data-testid="mc-score-card">
                    <div className="text-[10px] uppercase tracking-wide text-text-tertiary">MC-Korrektheit Ø (Nebenachse)</div>
                    <div className="text-lg font-bold text-text-primary mt-0.5">
                      {data.mc_score?.avg_pct !== null && data.mc_score?.avg_pct !== undefined
                        ? `${data.mc_score.avg_pct}%`
                        : "—"}
                    </div>
                    <div className="text-[10px] text-text-tertiary mt-0.5">
                      {data.mc_score?.samples ?? 0} Sample(s)
                      {source === "generic" && " · Generic-Pfad hat keine MC-Stufe"}
                    </div>
                  </div>
                )}
                {(data.self_score_avg !== null && data.self_score_avg !== undefined) && (
                  <div className="rounded-lg border border-border-subtle bg-surface-sunken p-3">
                    <div className="text-[10px] uppercase tracking-wide text-text-tertiary">Ø Selbsteinschätzung</div>
                    <div className="text-lg font-bold text-text-primary mt-0.5">
                      {data.self_score_avg}
                    </div>
                    <div className="text-[10px] text-text-tertiary mt-0.5">
                      Score 0–100 · primäre Reife-Achse
                    </div>
                  </div>
                )}
              </div>
            )}

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
                  : fallbackPct > 40 ? "border-status-warning-border text-status-warning-foreground"
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
                            className="h-full bg-status-warning transition-[width] duration-500"
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
                      ? "border-status-warning-border bg-status-warning-bg-subtle text-status-warning-foreground"
                      : "border-success-border bg-success-bg-subtle text-text-primary"
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

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2" title={hint}>
      <div className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className="text-lg font-bold text-text-primary mt-0.5">
        {typeof value === "number" ? value.toLocaleString("de-DE") : value}
      </div>
      {hint && <div className="text-[9px] text-text-tertiary mt-0.5 leading-tight">{hint}</div>}
    </div>
  );
}
