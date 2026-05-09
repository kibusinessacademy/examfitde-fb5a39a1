import { useEffect, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

type DriftRow = { day: string; decision: string; decisions_count: number };
type LaneRow = {
  lane: string;
  decision: string;
  current_count: number;
  prev_count: number;
  delta_count: number;
  delta_pct: number | null;
};
type TimelineRow = {
  id: string;
  decision: string;
  prev_decision: string | null;
  quality_score: number | null;
  quality_badge: string | null;
  bronze_locked: boolean;
  recorded_at: string;
  recorded_by: string | null;
  inputs: Record<string, unknown> | null;
};

const DECISION_COLORS: Record<string, string> = {
  READY_TO_PUBLISH: "hsl(var(--chart-2))",
  REPAIR_REQUIRED: "hsl(var(--destructive))",
  BRONZE_LOCKED: "hsl(var(--chart-4))",
  NEEDS_REVIEW: "hsl(var(--chart-3))",
  AUTO_PUBLISHED: "hsl(var(--chart-1))",
};

function pivotForChart(rows: DriftRow[]) {
  const map = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    const e = map.get(r.day) ?? { day: r.day };
    e[r.decision] = (e[r.decision] as number | undefined) ?? 0;
    e[r.decision] = (e[r.decision] as number) + r.decisions_count;
    map.set(r.day, e);
  }
  return Array.from(map.values()).sort((a, b) =>
    String(a.day).localeCompare(String(b.day)),
  );
}

type ExportJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  format: "csv" | "json";
  total_rows: number | null;
  file_paths: string[];
  error: string | null;
  created_at: string;
  completed_at: string | null;
  package_id?: string | null;
  window_days?: number | null;
  lane?: string | null;
  decision?: string | null;
  started_at?: string | null;
};

type ExportFilters = {
  packageId: string;
  windowDays: number;
  lane: string | null;
  decision: string | null;
};

export default function GateHistoryDashboardPage() {
  const qc = useQueryClient();
  const [windowDays, setWindowDays] = useState(30);
  const [windowHours, setWindowHours] = useState(168);
  const [packageId, setPackageId] = useState("");
  const [laneFilter, setLaneFilter] = useState<string>("all");
  const [decisionFilter, setDecisionFilter] = useState<string>("all");
  const [timelineWindowDays, setTimelineWindowDays] = useState(30);
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [completedToastFor, setCompletedToastFor] = useState<string | null>(null);

  // Active export job — realtime-first (Postgres CDC), 15s polling fallback only.
  const exportJob = useQuery({
    queryKey: ["gate-export-job", activeJobId],
    queryFn: async () => {
      if (!activeJobId) return null;
      const { data, error } = await supabase.rpc(
        "admin_get_gate_export_job" as any,
        { p_job_id: activeJobId },
      );
      if (error) throw error;
      return data as ExportJob;
    },
    enabled: !!activeJobId,
    refetchInterval: (q) => {
      const s = (q.state.data as ExportJob | null)?.status;
      // Realtime drives updates; polling is just a slow safety net.
      return s === "done" || s === "failed" ? false : 15_000;
    },
  });

  // Recent export history (last 10) — admin-gated RPC.
  const exportHistory = useQuery({
    queryKey: ["gate-export-history"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_gate_export_jobs" as any,
        { p_limit: 10 },
      );
      if (error) throw error;
      return (data ?? []) as ExportJob[];
    },
    refetchInterval: 60_000,
  });

  // Realtime: subscribe to gate_export_jobs INSERT/UPDATE → refresh history + active.
  useEffect(() => {
    const ch = supabase
      .channel("gate-export-jobs")
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "gate_export_jobs" },
        (payload: any) => {
          qc.invalidateQueries({ queryKey: ["gate-export-history"] });
          if (activeJobId && payload?.new?.id === activeJobId) {
            qc.invalidateQueries({ queryKey: ["gate-export-job", activeJobId] });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel?.(ch);
    };
  }, [qc, activeJobId]);

  // Toast on completion (no auto-opens — list parts in history card instead).
  useEffect(() => {
    const j = exportJob.data;
    if (!j || !activeJobId || completedToastFor === j.id) return;
    if (j.status === "failed") {
      setCompletedToastFor(j.id);
      toast.error(`Export fehlgeschlagen: ${j.error ?? "unbekannt"}`);
      return;
    }
    if (j.status !== "done") return;
    setCompletedToastFor(j.id);
    const parts = j.file_paths?.length ?? 0;
    toast.success(
      `Export fertig: ${j.total_rows ?? 0} Zeilen in ${parts} Datei(en) — Download in der Export-Historie`,
      { duration: 15_000 },
    );
  }, [exportJob.data, activeJobId, completedToastFor]);

  const requestExport = useCallback(
    async (format: "json" | "csv", filters: ExportFilters) => {
      if (!filters.packageId) return;
      if (
        activeJobId &&
        exportJob.data &&
        (exportJob.data.status === "queued" || exportJob.data.status === "running")
      ) {
        toast.warning("Es läuft bereits ein Export. Bitte warten.");
        return;
      }
      const t = toast.loading(`Export wird in die Job-Queue gestellt…`);
      try {
        const { data, error } = await supabase.rpc(
          "admin_request_gate_export" as any,
          {
            p_package_id: filters.packageId,
            p_window_days: filters.windowDays,
            p_lane: filters.lane,
            p_decision: filters.decision,
            p_format: format,
          },
        );
        if (error) throw error;
        const jobId = data as string;
        setActiveJobId(jobId);
        setCompletedToastFor(null);
        toast.dismiss(t);
        toast.info(
          `Export-Job ${jobId.slice(0, 8)} gestartet — Worker läuft jede Minute.`,
        );
        qc.invalidateQueries({ queryKey: ["gate-export-history"] });
      } catch (e: any) {
        toast.dismiss(t);
        toast.error(`Konnte Export nicht starten: ${e?.message ?? "Unbekannt"}`);
      }
    },
    [activeJobId, exportJob.data, qc],
  );

  async function exportTimeline(format: "json" | "csv") {
    return requestExport(format, {
      packageId,
      windowDays: timelineWindowDays,
      lane: laneFilter === "all" ? null : laneFilter,
      decision: decisionFilter === "all" ? null : decisionFilter,
    });
  }

  async function downloadPart(path: string) {
    const { data, error } = await supabase.storage
      .from("gate-exports")
      .createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) {
      toast.error(`Download-Link konnte nicht erstellt werden: ${error?.message ?? ""}`);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function retryJob(j: ExportJob) {
    if (!j.package_id) {
      toast.error("Retry nicht möglich: Paket-ID fehlt.");
      return;
    }
    await requestExport(j.format, {
      packageId: j.package_id,
      windowDays: j.window_days ?? 30,
      lane: j.lane ?? null,
      decision: j.decision ?? null,
    });
  }

  const drift = useQuery({
    queryKey: ["gate-drift", windowDays],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_gate_decision_drift" as any,
        { p_window_days: windowDays },
      );
      if (error) throw error;
      return (data ?? []) as DriftRow[];
    },
  });

  const lane = useQuery({
    queryKey: ["gate-lane-pivot", windowHours],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_gate_decision_lane_pivot" as any,
        { p_window_hours: windowHours },
      );
      if (error) throw error;
      return (data ?? []) as LaneRow[];
    },
  });

  const timeline = useQuery({
    queryKey: [
      "gate-timeline",
      packageId,
      timelineWindowDays,
      laneFilter,
      decisionFilter,
      page,
    ],
    queryFn: async () => {
      if (!packageId) return { rows: [] as TimelineRow[], total: 0 };
      const { data, error } = await supabase.rpc(
        "admin_get_gate_decision_package_timeline_filtered" as any,
        {
          p_package_id: packageId,
          p_window_days: timelineWindowDays,
          p_lane: laneFilter === "all" ? null : laneFilter,
          p_decision: decisionFilter === "all" ? null : decisionFilter,
          p_limit: PAGE_SIZE,
          p_offset: page * PAGE_SIZE,
        },
      );
      if (error) throw error;
      const rows = (data ?? []) as (TimelineRow & { total_rows: number })[];
      return {
        rows: rows.map(({ total_rows: _t, ...r }) => r),
        total: Number(rows[0]?.total_rows ?? 0),
      };
    },
    enabled: !!packageId,
  });

  const chartData = pivotForChart(drift.data ?? []);
  const decisions = Array.from(
    new Set((drift.data ?? []).map((r) => r.decision)),
  );

  const filteredTimeline = timeline.data?.rows ?? [];
  const totalRows = timeline.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  const timelineLanes = Array.from(
    new Set(
      filteredTimeline
        .map((r) => (r.inputs as Record<string, unknown> | null)?.lane as string | undefined)
        .filter(Boolean) as string[],
    ),
  );
  const timelineDecisions = Array.from(
    new Set(filteredTimeline.map((r) => r.decision)),
  );

  return (
    <div className="space-y-4 p-4 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold">Gate Decision History</h1>
        <p className="text-sm text-muted-foreground">
          Drilldown pro Paket · Lane-Pivot · Drift über Zeit
        </p>
      </div>

      <Tabs defaultValue="drift">
        <TabsList>
          <TabsTrigger value="drift">Drift über Zeit</TabsTrigger>
          <TabsTrigger value="lane">Lane-Pivot</TabsTrigger>
          <TabsTrigger value="package">Pro Paket</TabsTrigger>
        </TabsList>

        <TabsContent value="drift" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Decisions pro Tag</CardTitle>
              <div className="flex gap-1 pt-1">
                {[7, 14, 30, 60, 90].map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    variant={windowDays === d ? "default" : "outline"}
                    onClick={() => setWindowDays(d)}
                    className="h-7 text-xs"
                  >
                    {d}d
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {drift.isLoading ? (
                <p className="text-sm text-muted-foreground">Lade…</p>
              ) : !chartData.length ? (
                <p className="text-sm text-muted-foreground">Keine Daten.</p>
              ) : (
                <div className="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {decisions.map((d) => (
                        <Area
                          key={d}
                          type="monotone"
                          dataKey={d}
                          stackId="1"
                          stroke={DECISION_COLORS[d] ?? "hsl(var(--muted-foreground))"}
                          fill={DECISION_COLORS[d] ?? "hsl(var(--muted-foreground))"}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lane" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Lane × Decision (mit Δ vs. Vorperiode)</CardTitle>
              <div className="flex gap-1 pt-1">
                {[24, 168, 720].map((h) => (
                  <Button
                    key={h}
                    size="sm"
                    variant={windowHours === h ? "default" : "outline"}
                    onClick={() => setWindowHours(h)}
                    className="h-7 text-xs"
                  >
                    {h === 24 ? "24h" : h === 168 ? "7d" : "30d"}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {lane.isLoading ? (
                <p className="text-sm text-muted-foreground">Lade…</p>
              ) : !lane.data?.length ? (
                <p className="text-sm text-muted-foreground">Keine Daten.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-1.5 px-2">Lane</th>
                        <th className="text-left py-1.5 px-2">Decision</th>
                        <th className="text-right py-1.5 px-2">Aktuell</th>
                        <th className="text-right py-1.5 px-2">Vorher</th>
                        <th className="text-right py-1.5 px-2">Δ</th>
                        <th className="text-right py-1.5 px-2">Δ %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lane.data.map((r, i) => (
                        <tr key={i} className="border-b">
                          <td className="py-1.5 px-2 font-mono">{r.lane}</td>
                          <td className="py-1.5 px-2">{r.decision}</td>
                          <td className="text-right py-1.5 px-2 tabular-nums">
                            {r.current_count}
                          </td>
                          <td className="text-right py-1.5 px-2 tabular-nums text-muted-foreground">
                            {r.prev_count}
                          </td>
                          <td className="text-right py-1.5 px-2">
                            <Badge
                              variant={
                                r.delta_count > 0
                                  ? "default"
                                  : r.delta_count < 0
                                  ? "destructive"
                                  : "secondary"
                              }
                              className="font-mono text-[10px]"
                            >
                              {r.delta_count > 0 ? "+" : ""}
                              {r.delta_count}
                            </Badge>
                          </td>
                          <td className="text-right py-1.5 px-2 tabular-nums">
                            {r.delta_pct != null ? `${r.delta_pct.toFixed(1)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="package" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Timeline pro Paket</CardTitle>
              <div className="flex flex-wrap gap-2 pt-1 items-end">
                <Input
                  placeholder="package_id (UUID)"
                  value={packageId}
                  onChange={(e) => setPackageId(e.target.value.trim())}
                  className="max-w-md text-xs font-mono"
                  data-testid="gate-history-package-input"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => timeline.refetch()}
                  disabled={!packageId}
                >
                  Laden
                </Button>
                <select
                  value={laneFilter}
                  onChange={(e) => { setLaneFilter(e.target.value); setPage(0); }}
                  className="h-8 text-xs border rounded-md px-2 bg-background"
                  data-testid="gate-history-lane-filter"
                  aria-label="Lane filter"
                >
                  <option value="all">Alle Lanes</option>
                  {timelineLanes.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                <select
                  value={decisionFilter}
                  onChange={(e) => { setDecisionFilter(e.target.value); setPage(0); }}
                  className="h-8 text-xs border rounded-md px-2 bg-background"
                  aria-label="Decision filter"
                >
                  <option value="all">Alle Decisions</option>
                  {timelineDecisions.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <select
                  value={timelineWindowDays}
                  onChange={(e) => { setTimelineWindowDays(parseInt(e.target.value, 10)); setPage(0); }}
                  className="h-8 text-xs border rounded-md px-2 bg-background"
                  aria-label="Zeitfenster"
                >
                  {[7, 30, 90, 180, 365].map((d) => (
                    <option key={d} value={d}>{d}d</option>
                  ))}
                </select>
                <div className="ml-auto flex items-center gap-1">
                  {activeJobId && exportJob.data && exportJob.data.status !== "done" && exportJob.data.status !== "failed" ? (
                    <Badge variant="secondary" className="text-[10px] mr-1" data-testid="gate-export-job-status">
                      Export {exportJob.data.status}…
                    </Badge>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => exportTimeline("csv")}
                    disabled={!packageId}
                    data-testid="gate-history-export-csv"
                  >
                    CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => exportTimeline("json")}
                    disabled={!packageId}
                    data-testid="gate-history-export-json"
                  >
                    JSON
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!packageId ? (
                <p className="text-sm text-muted-foreground">
                  Paket-UUID eingeben, um die Decision-Historie zu sehen.
                </p>
              ) : timeline.isLoading ? (
                <p className="text-sm text-muted-foreground">Lade…</p>
              ) : !filteredTimeline.length ? (
                <p className="text-sm text-muted-foreground">
                  Keine Decisions für die gewählten Filter.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-[600px] overflow-y-auto" data-testid="gate-history-timeline-list">
                  {filteredTimeline.map((r) => (
                    <div key={r.id} className="border rounded-md p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="font-mono">
                            {r.decision}
                          </Badge>
                          {r.prev_decision ? (
                            <span className="text-muted-foreground">
                              ← {r.prev_decision}
                            </span>
                          ) : null}
                          {r.bronze_locked ? (
                            <Badge variant="secondary" className="text-[10px]">
                              bronze-locked
                            </Badge>
                          ) : null}
                        </div>
                        <span className="text-muted-foreground">
                          {new Date(r.recorded_at).toLocaleString("de-DE")}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.quality_score != null ? (
                          <Badge variant="outline">score {r.quality_score}</Badge>
                        ) : null}
                        {r.quality_badge ? (
                          <Badge variant="outline">{r.quality_badge}</Badge>
                        ) : null}
                        {r.recorded_by ? (
                          <Badge variant="outline" className="font-mono">
                            {r.recorded_by}
                          </Badge>
                        ) : null}
                      </div>
                      {r.inputs ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[10px] text-muted-foreground">
                            inputs snapshot
                          </summary>
                          <pre className="text-[10px] mt-1 bg-muted p-1.5 rounded overflow-x-auto">
                            {JSON.stringify(r.inputs, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              {packageId && totalRows > 0 ? (
                <div className="flex items-center justify-between mt-3 text-xs" data-testid="gate-history-pager">
                  <div className="text-muted-foreground tabular-nums">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalRows)} von {totalRows}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0 || timeline.isFetching}
                    >
                      ← Zurück
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={page >= pageCount - 1 || timeline.isFetching}
                    >
                      Weiter →
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card data-testid="gate-export-history-card">
            <CardHeader>
              <CardTitle className="text-base">Export-Historie (letzte 10)</CardTitle>
              <p className="text-xs text-muted-foreground">
                Status, Größe und Download pro Datei. Retry für fehlgeschlagene Jobs.
              </p>
            </CardHeader>
            <CardContent>
              {exportHistory.isLoading ? (
                <p className="text-sm text-muted-foreground">Lade…</p>
              ) : !(exportHistory.data?.length) ? (
                <p className="text-sm text-muted-foreground">Noch keine Exporte.</p>
              ) : (
                <div className="space-y-1.5" data-testid="gate-export-history-list">
                  {exportHistory.data.map((j) => {
                    const statusVariant =
                      j.status === "done"
                        ? "success"
                        : j.status === "failed"
                          ? "danger"
                          : j.status === "running"
                            ? "info"
                            : "muted";
                    return (
                      <div
                        key={j.id}
                        className="border rounded-md p-2 text-xs"
                        data-testid="gate-export-history-row"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <Badge variant={statusVariant as any} data-testid="gate-export-history-status">
                              {j.status}
                            </Badge>
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {j.format.toUpperCase()}
                            </Badge>
                            {j.total_rows != null ? (
                              <Badge variant="outline">{j.total_rows.toLocaleString("de-DE")} Zeilen</Badge>
                            ) : null}
                            {j.lane ? <Badge variant="outline">lane: {j.lane}</Badge> : null}
                            {j.decision ? <Badge variant="outline">{j.decision}</Badge> : null}
                          </div>
                          <span className="text-muted-foreground tabular-nums">
                            {new Date(j.created_at).toLocaleString("de-DE")}
                            {j.completed_at ? (
                              <> · {Math.max(0, Math.round((+new Date(j.completed_at) - +new Date(j.created_at)) / 1000))}s</>
                            ) : null}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-1 flex-wrap">
                          {j.status === "done" && (j.file_paths?.length ?? 0) > 0
                            ? (j.file_paths ?? []).map((p, i) => (
                                <Button
                                  key={p}
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-[11px]"
                                  onClick={() => downloadPart(p)}
                                  data-testid="gate-export-history-download"
                                >
                                  ↓ Teil {i + 1}
                                </Button>
                              ))
                            : null}
                          {j.status === "failed" ? (
                            <>
                              <span
                                className="text-destructive truncate max-w-[420px]"
                                title={j.error ?? ""}
                              >
                                {j.error ?? "Fehler"}
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px] ml-auto"
                                onClick={() => retryJob(j)}
                                disabled={!j.package_id}
                                data-testid="gate-export-history-retry"
                              >
                                ↻ Retry
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
