import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, TrendingUp, Clock, Euro, Target, AlertTriangle, CheckCircle } from "lucide-react";

interface Forecast {
  id: string;
  course_id: string;
  course_title: string;
  forecast_total_jobs: number;
  forecast_content_jobs: number;
  forecast_pipeline_jobs: number;
  forecast_cost_eur: number;
  forecast_cost_content_eur: number;
  forecast_cost_pipeline_eur: number;
  forecast_duration_hours: number;
  forecast_start_at: string | null;
  forecast_end_at: string | null;
  actual_jobs_completed: number;
  actual_jobs_failed: number;
  actual_jobs_pending: number;
  actual_cost_eur: number;
  actual_started_at: string | null;
  actual_completed_at: string | null;
  actual_duration_hours: number | null;
  status: string;
  notes: string | null;
  updated_at: string;
}

const fmtEur = (v: number) => Number(v || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const fmtHours = (v: number | null) => v != null ? `${Number(v).toFixed(1)}h` : "—";
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const statusBadge = (s: string) => {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    planned: { variant: "secondary", label: "Geplant" },
    in_progress: { variant: "default", label: "Läuft" },
    completed: { variant: "outline", label: "Fertig ✅" },
    failed: { variant: "destructive", label: "Fehler" },
  };
  const m = map[s] || { variant: "secondary" as const, label: s };
  return <Badge variant={m.variant}>{m.label}</Badge>;
};

export default function CourseProductionForecastPage() {
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("course_production_forecasts" as any)
      .select("*, courses!inner(title)")
      .order("forecast_cost_eur", { ascending: false });

    if (data) {
      setForecasts(
        (data as any[]).map((d) => ({
          ...d,
          course_title: (d as any).courses?.title || "—",
        }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await supabase.rpc("refresh_course_forecast_actuals" as any);
    await load();
    setRefreshing(false);
  };

  const totalForecastCost = forecasts.reduce((a, f) => a + Number(f.forecast_cost_eur), 0);
  const totalActualCost = forecasts.reduce((a, f) => a + Number(f.actual_cost_eur), 0);
  const totalJobs = forecasts.reduce((a, f) => a + f.forecast_total_jobs, 0);
  const totalCompleted = forecasts.reduce((a, f) => a + f.actual_jobs_completed, 0);
  const totalFailed = forecasts.reduce((a, f) => a + f.actual_jobs_failed, 0);
  const totalPending = forecasts.reduce((a, f) => a + f.actual_jobs_pending, 0);
  const overallProgress = totalJobs > 0 ? Math.round((totalCompleted / totalJobs) * 100) : 0;

  if (loading) return <div className="flex justify-center py-16"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Kurs-Produktionskosten & Budgetplanung</h2>
          <p className="text-sm text-muted-foreground">Soll/Ist-Vergleich pro Kurs – AI-Generierung bis Publish-Ready</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          Aktualisieren
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Euro className="h-5 w-5 text-primary" />
              <div>
                <div className="text-sm text-muted-foreground">Budget (Soll)</div>
                <div className="text-2xl font-bold">{fmtEur(totalForecastCost)}</div>
                <div className="text-xs text-muted-foreground">3 Kurse gesamt</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-sm text-muted-foreground">Ist-Kosten</div>
                <div className="text-2xl font-bold">{fmtEur(totalActualCost)}</div>
                <div className="text-xs text-muted-foreground">
                  {totalActualCost > 0
                    ? `${((totalActualCost / totalForecastCost) * 100).toFixed(0)}% vom Budget`
                    : "Tracking startet mit AI-Usage-Log"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Target className="h-5 w-5 text-amber-500" />
              <div>
                <div className="text-sm text-muted-foreground">Fortschritt</div>
                <div className="text-2xl font-bold">{overallProgress}%</div>
                <Progress value={overallProgress} className="mt-1 h-2" />
                <div className="text-xs text-muted-foreground mt-1">
                  {totalCompleted}/{totalJobs} Jobs
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-sm text-muted-foreground">Status</div>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {totalCompleted > 0 && (
                    <Badge variant="outline" className="text-green-600">
                      <CheckCircle className="h-3 w-3 mr-1" />{totalCompleted}
                    </Badge>
                  )}
                  {totalPending > 0 && (
                    <Badge variant="secondary">{totalPending} offen</Badge>
                  )}
                  {totalFailed > 0 && (
                    <Badge variant="destructive">
                      <AlertTriangle className="h-3 w-3 mr-1" />{totalFailed}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-Course Detail Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Soll/Ist pro Kurs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kurs</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Soll €</TableHead>
                  <TableHead className="text-right">Ist €</TableHead>
                  <TableHead className="text-right">Δ €</TableHead>
                  <TableHead className="text-right">Soll h</TableHead>
                  <TableHead className="text-right">Ist h</TableHead>
                  <TableHead className="text-center">Jobs</TableHead>
                  <TableHead className="text-center">Fortschritt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forecasts.map((f) => {
                  const totalActJobs = f.actual_jobs_completed + f.actual_jobs_failed + f.actual_jobs_pending;
                  const progress = f.forecast_total_jobs > 0 ? Math.round((f.actual_jobs_completed / f.forecast_total_jobs) * 100) : 0;
                  const costDelta = Number(f.actual_cost_eur) - Number(f.forecast_cost_eur);

                  return (
                    <TableRow key={f.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium text-sm">{f.course_title}</div>
                          <div className="text-xs text-muted-foreground">
                            {f.forecast_content_jobs} Content + {f.forecast_pipeline_jobs} Pipeline
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{statusBadge(f.status)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{fmtEur(f.forecast_cost_eur)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{fmtEur(f.actual_cost_eur)}</TableCell>
                      <TableCell className={`text-right font-mono text-sm ${costDelta > 0 ? "text-red-500" : costDelta < 0 ? "text-green-500" : ""}`}>
                        {f.actual_cost_eur > 0 ? (costDelta > 0 ? "+" : "") + fmtEur(costDelta) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{fmtHours(f.forecast_duration_hours)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{fmtHours(f.actual_duration_hours)}</TableCell>
                      <TableCell className="text-center">
                        <div className="text-xs space-y-0.5">
                          <div className="text-green-600">{f.actual_jobs_completed} ✓</div>
                          {f.actual_jobs_failed > 0 && <div className="text-red-500">{f.actual_jobs_failed} ✗</div>}
                          <div className="text-muted-foreground">{f.actual_jobs_pending} ⏳</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Progress value={progress} className="h-2 w-20" />
                          <span className="text-xs text-muted-foreground">{progress}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Cost Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kostenstruktur (Soll)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kurs</TableHead>
                  <TableHead className="text-right">Content (AI-Gen)</TableHead>
                  <TableHead className="text-right">Pipeline (QC/IHK/Seal)</TableHead>
                  <TableHead className="text-right">Gesamt</TableHead>
                  <TableHead className="text-right">€ / Lesson</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>Ende (Soll)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forecasts.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium text-sm">{f.course_title}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtEur(f.forecast_cost_content_eur)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtEur(f.forecast_cost_pipeline_eur)}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-bold">{fmtEur(f.forecast_cost_eur)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {f.forecast_content_jobs > 0 ? fmtEur(Number(f.forecast_cost_content_eur) / f.forecast_content_jobs) : "—"}
                    </TableCell>
                    <TableCell className="text-sm">{fmtDate(f.forecast_start_at)}</TableCell>
                    <TableCell className="text-sm">{fmtDate(f.forecast_end_at)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold border-t-2">
                  <TableCell>GESAMT</TableCell>
                  <TableCell className="text-right font-mono">
                    {fmtEur(forecasts.reduce((a, f) => a + Number(f.forecast_cost_content_eur), 0))}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {fmtEur(forecasts.reduce((a, f) => a + Number(f.forecast_cost_pipeline_eur), 0))}
                  </TableCell>
                  <TableCell className="text-right font-mono">{fmtEur(totalForecastCost)}</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Annahmen & Notizen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {forecasts.map((f) => (
            <div key={f.id} className="text-sm">
              <span className="font-medium">{f.course_title}:</span>{" "}
              <span className="text-muted-foreground">{f.notes || "—"}</span>
            </div>
          ))}
          <div className="border-t pt-3 mt-3 text-xs text-muted-foreground space-y-1">
            <p>• Kostenmodell: ~€0,02/Lesson (GPT-4o, Ø 3.500 Tokens) + €5 Pipeline-Overhead (IHK-Upgrade, QC, Seal)</p>
            <p>• Durchsatz: 10 Jobs/min (5 parallel, 30s Cron-Tick), ~55s Ø Verarbeitungszeit</p>
            <p>• Ist-Kosten werden aus ai_usage_log aggregiert (sobald Daten vorliegen)</p>
            <p>• Letzte Aktualisierung: {forecasts[0] ? new Date(forecasts[0].updated_at).toLocaleString("de-DE") : "—"}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
