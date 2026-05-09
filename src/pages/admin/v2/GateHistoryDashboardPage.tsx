import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
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

export default function GateHistoryDashboardPage() {
  const [windowDays, setWindowDays] = useState(30);
  const [windowHours, setWindowHours] = useState(168);
  const [packageId, setPackageId] = useState("");
  const [laneFilter, setLaneFilter] = useState<string>("all");
  const [decisionFilter, setDecisionFilter] = useState<string>("all");

  function downloadFile(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportTimeline(format: "json" | "csv") {
    const rows = filteredTimeline;
    if (!rows.length) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (format === "json") {
      downloadFile(
        `gate-timeline-${packageId}-${stamp}.json`,
        JSON.stringify(rows, null, 2),
        "application/json",
      );
    } else {
      const headers = [
        "id",
        "decision",
        "prev_decision",
        "quality_score",
        "quality_badge",
        "bronze_locked",
        "recorded_at",
        "recorded_by",
        "inputs_json",
      ];
      const esc = (v: unknown) => {
        const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const body = rows
        .map((r) =>
          [
            r.id,
            r.decision,
            r.prev_decision,
            r.quality_score,
            r.quality_badge,
            r.bronze_locked,
            r.recorded_at,
            r.recorded_by,
            r.inputs,
          ]
            .map(esc)
            .join(","),
        )
        .join("\n");
      downloadFile(
        `gate-timeline-${packageId}-${stamp}.csv`,
        headers.join(",") + "\n" + body,
        "text/csv",
      );
    }
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
    queryKey: ["gate-timeline", packageId],
    queryFn: async () => {
      if (!packageId) return [] as TimelineRow[];
      const { data, error } = await supabase.rpc(
        "admin_get_gate_decision_package_timeline" as any,
        { p_package_id: packageId, p_limit: 50 },
      );
      if (error) throw error;
      return (data ?? []) as TimelineRow[];
    },
    enabled: !!packageId,
  });

  const chartData = pivotForChart(drift.data ?? []);
  const decisions = Array.from(
    new Set((drift.data ?? []).map((r) => r.decision)),
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
              <div className="flex gap-2 pt-1">
                <Input
                  placeholder="package_id (UUID)"
                  value={packageId}
                  onChange={(e) => setPackageId(e.target.value.trim())}
                  className="max-w-md text-xs font-mono"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => timeline.refetch()}
                  disabled={!packageId}
                >
                  Laden
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!packageId ? (
                <p className="text-sm text-muted-foreground">
                  Paket-UUID eingeben, um die Decision-Historie zu sehen.
                </p>
              ) : timeline.isLoading ? (
                <p className="text-sm text-muted-foreground">Lade…</p>
              ) : !timeline.data?.length ? (
                <p className="text-sm text-muted-foreground">
                  Keine Decisions für dieses Paket.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
                  {timeline.data.map((r) => (
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
