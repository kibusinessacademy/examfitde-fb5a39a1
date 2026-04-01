import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  RefreshCw, Activity, AlertTriangle, CheckCircle2, XCircle,
  Clock, Package, TrendingUp, Shield, Cpu, FileText, Zap,
  ArrowRight, Calendar,
} from "lucide-react";
import { useState } from "react";

function useDailyOpsReport(action: string) {
  return useQuery({
    queryKey: ["daily-ops-report", action],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("daily-ops-report", {
        body: { action },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 120_000,
    refetchInterval: 300_000,
  });
}

type Signal = "green" | "yellow" | "red" | "neutral";

const signalColor: Record<Signal, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-destructive",
  neutral: "bg-muted-foreground",
};

const signalLabel: Record<Signal, string> = {
  green: "Stabil",
  yellow: "Beobachten",
  red: "Kritisch",
  neutral: "Keine Daten",
};

const signalBadge: Record<Signal, string> = {
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  yellow: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  red: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
};

function SignalDot({ signal }: { signal: Signal }) {
  return <span className={cn("inline-block h-2.5 w-2.5 rounded-full", signalColor[signal])} />;
}

function KpiBox({ label, value, sub, signal, onClick }: { label: string; value: string | number; sub?: string; signal?: Signal; onClick?: () => void }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-3 transition-all",
        onClick && "cursor-pointer hover:ring-2 hover:ring-primary/30 active:scale-[0.98]"
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {signal && <SignalDot signal={signal} />}
      </div>
      <div className="mt-1 text-xl font-bold text-foreground">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export default function DailyOpsReport() {
  const [view, setView] = useState<"latest" | "live">("latest");
  const { data, isLoading, refetch, isRefetching } = useDailyOpsReport(view === "live" ? "generate" : "latest");

  if (isLoading) return <Skeleton className="h-[600px] w-full rounded-2xl" />;
  if (!data) return <div className="text-sm text-muted-foreground p-4">Noch kein Tagesbericht vorhanden.</div>;

  const d = data as any;
  const ps = d.production_status || {};
  const pipe = d.pipeline || {};
  const cost = d.cost || {};
  const tp = d.throughput || {};
  const e2e = d.e2e_status || {};
  const fc = d.forecasts || {};
  const overall = (d.overall_signal || "neutral") as Signal;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-bold text-foreground">Daily Operations Report</h2>
            <p className="text-xs text-muted-foreground">
              <Calendar className="inline h-3 w-3 mr-1" />
              {d.report_date || "—"} · {d.generated_at ? new Date(d.generated_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : ""} UTC
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={cn("text-xs py-1 px-3 border", signalBadge[overall])}>
            <SignalDot signal={overall} />
            <span className="ml-1.5">{signalLabel[overall]}</span>
          </Badge>
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button onClick={() => setView("latest")} className={cn("px-2.5 py-1 transition-colors", view === "latest" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted")}>Letzter</button>
            <button onClick={() => setView("live")} className={cn("px-2.5 py-1 transition-colors", view === "live" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted")}>Live</button>
          </div>
          <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isRefetching} className="h-8 w-8">
            <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* 1. Overall KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiBox label="Runner-Slots" value={`${ps.runner_slots_active || 0} / ${ps.runner_slots_max || 5}`} signal={(ps.runner_signal || "neutral") as Signal} sub={`${ps.runner_utilization_pct || 0}% Auslastung`} />
        <KpiBox label="Pending Jobs" value={ps.pending_jobs ?? 0} />
        <KpiBox label="Completed (gesamt)" value={ps.completed_jobs_total ?? 0} />
        <KpiBox label="Durchsatz" value={`${tp.per_hour ?? 0}/h`} sub="letzte 2h" />
      </div>

      {/* 2. Active Builds */}
      {d.active_builds?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Cpu className="h-4 w-4 text-blue-500" />
              Aktive Builds ({d.active_builds.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.active_builds.map((b: any, i: number) => (
              <div key={i} className="rounded-lg border border-border p-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground truncate max-w-[60%]">{b.title}</span>
                  <Badge variant="outline" className="text-[10px]">{b.completed_steps}/{b.total_steps} Steps</Badge>
                </div>
                <Progress value={b.total_steps > 0 ? (b.completed_steps / b.total_steps) * 100 : 0} className="h-1.5 mt-1.5" />
                <div className="text-[10px] text-muted-foreground mt-1">Aktuell: {b.current_step || "—"}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 3. Throughput */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Durchsatz
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {(tp.hourly_breakdown || []).map((h: any, i: number) => (
                <div key={i} className="rounded-lg border border-border p-2 text-center">
                  <div className="text-[10px] text-muted-foreground">{h.label}</div>
                  <div className="text-lg font-bold text-foreground">{h.count}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 4. Cost */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Kosten
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <KpiBox label="Letzte 24h" value={`€${cost.last_24h ?? 0}`} />
              <KpiBox label="Gesamt" value={`€${cost.total ?? 0}`} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 5. Blocked */}
      {d.blocked_packages?.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <XCircle className="h-4 w-4" />
              Blockierte Pakete ({d.blocked_packages.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.blocked_packages.map((b: any, i: number) => (
              <div key={i} className="rounded-lg border border-destructive/20 bg-destructive/5 p-2.5 text-xs">
                <div className="font-medium text-foreground">{b.title}</div>
                <div className="text-muted-foreground mt-0.5">Ursache: {b.blocked_reason || "—"}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 6. Fake WIP */}
      {d.fake_wip?.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-4 w-4" />
              Fake-WIP ({d.fake_wip.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Pakete im Status 'building' ohne aktiven Job: {d.fake_wip.map((f: any) => f.title).join(", ")}
          </CardContent>
        </Card>
      )}

      {/* 7. Pipeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            Pipeline ({pipe.total || 0} Pakete)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
            {[
              { l: "Building", v: pipe.building, c: "text-blue-500" },
              { l: "Queued", v: pipe.queued, c: "text-muted-foreground" },
              { l: "Blocked", v: pipe.blocked, c: "text-destructive" },
              { l: "Done", v: pipe.done, c: "text-amber-500" },
              { l: "Published", v: pipe.published, c: "text-emerald-500" },
              { l: "Failed", v: pipe.failed, c: "text-destructive" },
            ].map((item, i) => (
              <div key={i} className="text-center rounded-lg border border-border p-2">
                <div className="text-[10px] text-muted-foreground">{item.l}</div>
                <div className={cn("text-lg font-bold", item.c)}>{item.v ?? 0}</div>
              </div>
            ))}
          </div>
          {/* Queue by priority */}
          {pipe.queue_by_priority && Object.keys(pipe.queue_by_priority).length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-[10px] text-muted-foreground mb-1.5">Queue nach Priorität</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(pipe.queue_by_priority)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([prio, count]) => (
                    <Badge key={prio} variant="outline" className="text-[10px]">
                      Prio {prio}: {count as number}
                    </Badge>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 8. End-to-End + ETA */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4" />
              End-to-End-Status
              <SignalDot signal={(e2e.signal || "neutral") as Signal} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2">
              <KpiBox label="Done" value={e2e.done_packages ?? 0} />
              <KpiBox label="Published" value={e2e.published_packages ?? 0} />
              <KpiBox label="Council" value={e2e.council_reviews ?? 0} />
            </div>
            {(e2e.published_packages ?? 0) === 0 && (
              <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                End-to-End-Validierung steht aus – noch kein Paket vollständig veröffentlicht
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Prognose
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {fc.current_builds && (
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">Aktive Builds</div>
                <div className="grid grid-cols-3 gap-1.5 text-xs">
                  <div className="rounded border border-border p-1.5 text-center">
                    <div className="text-[9px] text-emerald-600">Optimistisch</div>
                    <div className="font-medium text-foreground">{fc.current_builds.optimistic}</div>
                  </div>
                  <div className="rounded border border-border p-1.5 text-center">
                    <div className="text-[9px] text-amber-600">Realistisch</div>
                    <div className="font-medium text-foreground">{fc.current_builds.realistic}</div>
                  </div>
                  <div className="rounded border border-border p-1.5 text-center">
                    <div className="text-[9px] text-destructive">Konservativ</div>
                    <div className="font-medium text-foreground">{fc.current_builds.conservative}</div>
                  </div>
                </div>
              </div>
            )}
            {fc.total_production && (
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">Gesamtproduktion ({pipe.remaining ?? 0} Pakete)</div>
                <div className="grid grid-cols-3 gap-1.5 text-xs">
                  <div className="rounded border border-border p-1.5 text-center">
                    <div className="text-[9px] text-emerald-600">Optimistisch</div>
                    <div className="font-medium text-foreground">{fc.total_production.optimistic.days}</div>
                    <div className="text-[9px] text-muted-foreground">{fc.total_production.optimistic.cost}</div>
                  </div>
                  <div className="rounded border border-border p-1.5 text-center">
                    <div className="text-[9px] text-amber-600">Realistisch</div>
                    <div className="font-medium text-foreground">{fc.total_production.realistic.days}</div>
                    <div className="text-[9px] text-muted-foreground">{fc.total_production.realistic.cost}</div>
                  </div>
                  <div className="rounded border border-border p-1.5 text-center">
                    <div className="text-[9px] text-destructive">Konservativ</div>
                    <div className="font-medium text-foreground">{fc.total_production.conservative.days}</div>
                    <div className="text-[9px] text-muted-foreground">{fc.total_production.conservative.cost}</div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 9. Priorities */}
      {d.priorities?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Operative Prioritäten
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.priorities.map((p: any, i: number) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-border p-2.5 text-xs">
                <Badge variant={p.priority === "P1" ? "destructive" : p.priority === "P2" ? "default" : "secondary"} className="text-[10px] shrink-0">
                  {p.priority}
                </Badge>
                <span className="text-foreground">{p.label}</span>
                {p.count !== null && <Badge variant="outline" className="ml-auto text-[10px]">{p.count}</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 10. Executive Summary */}
      {d.executive_summary && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Executive Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs leading-relaxed text-foreground">{d.executive_summary}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
