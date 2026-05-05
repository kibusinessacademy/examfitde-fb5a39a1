import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DollarSign, TrendingUp, TrendingDown, Users, AlertTriangle,
  Package, RefreshCw, Shield, XCircle, Zap,
} from "lucide-react";

function useRevenueTower() {
  return useQuery({
    queryKey: ["admin", "revenue-tower"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-revenue-tower", { body: {} });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

const toneColors: Record<string, string> = {
  green: "text-green-600 bg-green-500/10 border-green-500/30",
  yellow: "text-yellow-700 bg-yellow-500/10 border-yellow-500/30",
  red: "text-destructive bg-destructive-bg-subtle border-destructive/30",
};

function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = score >= 80 ? "text-green-500" : score >= 50 ? "text-yellow-500" : "text-destructive";
  return (
    <svg width={size} height={size} className="block mx-auto">
      <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={6} className="stroke-muted" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={6} className={`stroke-current ${color}`}
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
        transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x="50%" y="50%" textAnchor="middle" dy="0.35em" className="fill-foreground text-lg font-bold">{score}</text>
    </svg>
  );
}

export default function RevenueCommandCenter() {
  const { data, isLoading, refetch, isRefetching } = useRevenueTower();

  if (isLoading) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (!data) return null;

  const { revenue, churn, affiliates, publish_blockers, refunds, issues, health_score } = data;
  const healthTone = health_score >= 80 ? "green" : health_score >= 50 ? "yellow" : "red";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Revenue Command Center
          </h2>
          <p className="text-xs text-muted-foreground">SSOT für Umsatz, Churn & Business-Impact</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={cn("h-4 w-4", isRefetching && "animate-spin")} />
        </Button>
      </div>

      {/* Health + KPI Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Card className={cn("border", toneColors[healthTone])}>
          <CardContent className="p-3 text-center">
            <ScoreRing score={health_score} size={64} />
            <p className="text-[10px] mt-1 font-medium">Revenue Health</p>
          </CardContent>
        </Card>
        {[
          { label: "Heute", value: `€${revenue.today.toFixed(0)}`, sub: `${revenue.orders_today} Orders` },
          { label: "7 Tage", value: `€${revenue.week.toFixed(0)}`, sub: `${revenue.orders_week} Orders` },
          { label: "30 Tage", value: `€${revenue.month.toFixed(0)}`, sub: `${revenue.orders_month} Orders` },
          { label: "Ø Order", value: `€${revenue.avg_order.toFixed(0)}`, sub: "pro Bestellung" },
          { label: "Churn-Risiko", value: String(churn.high_risk), sub: `€${churn.estimated_revenue_at_risk.toFixed(0)} at risk`, tone: churn.high_risk > 5 ? "red" : churn.high_risk > 0 ? "yellow" : "green" as const },
          { label: "Refunds", value: String(refunds.count), sub: `€${refunds.total_eur.toFixed(0)}`, tone: refunds.count > 5 ? "red" : refunds.count > 0 ? "yellow" : "green" },
        ].map((kpi, i) => (
          <Card key={i} className={cn("border", kpi.tone ? toneColors[kpi.tone] : "")}>
            <CardContent className="p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
              <p className="text-xl font-bold">{kpi.value}</p>
              <p className="text-[10px] text-muted-foreground">{kpi.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Churn Intelligence */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-orange-500" />
              Churn-Risiko
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-3 text-xs">
              <div className="flex-1 rounded-lg bg-destructive-bg-subtle p-2 text-center">
                <p className="text-lg font-bold text-destructive">{churn.high_risk}</p>
                <p className="text-muted-foreground">{"Hoch (>70%)"}</p>
              </div>
              <div className="flex-1 rounded-lg bg-yellow-500/10 p-2 text-center">
                <p className="text-lg font-bold text-yellow-700">{churn.medium_risk}</p>
                <p className="text-muted-foreground">Mittel</p>
              </div>
            </div>
            {churn.top_risks?.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {churn.top_risks.map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs rounded-md bg-muted/50 p-2">
                    <span className="font-mono truncate max-w-[120px]">{r.user_id?.slice(0, 8)}…</span>
                    <Badge variant={r.score > 80 ? "destructive" : "default"} className="text-[10px]">{r.score}%</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Publish Blockers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Package className="h-4 w-4 text-orange-500" />
              Publish-Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-3 text-xs">
              <div className="flex-1 rounded-lg bg-orange-500/10 p-2 text-center">
                <p className="text-lg font-bold text-orange-600">{publish_blockers.ready}</p>
                <p className="text-muted-foreground">Publish-Ready</p>
              </div>
              <div className="flex-1 rounded-lg bg-destructive-bg-subtle p-2 text-center">
                <p className="text-lg font-bold text-destructive">{publish_blockers.blocked}</p>
                <p className="text-muted-foreground">Blockiert</p>
              </div>
            </div>
            {publish_blockers.opportunity_cost > 0 && (
              <div className="text-xs text-destructive font-medium flex items-center gap-1">
                <TrendingDown className="h-3 w-3" />
                ~€{publish_blockers.opportunity_cost} Opportunity Cost
              </div>
            )}
            {publish_blockers.ready_items?.map((item: any, i: number) => (
              <div key={i} className="text-xs rounded-md bg-muted/50 p-2">
                <span className="font-medium">{item.title}</span>
                {item.track && <Badge variant="outline" className="text-[10px] ml-2">{item.track}</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Affiliates */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Affiliate-Netzwerk
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-xs text-center">
              <div className="rounded-lg bg-primary/10 p-2">
                <p className="text-lg font-bold text-primary">{affiliates.active}</p>
                <p className="text-muted-foreground">Aktive</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-2">
                <p className="text-lg font-bold">€{affiliates.total_earnings?.toFixed(0) || 0}</p>
                <p className="text-muted-foreground">Verdient</p>
              </div>
              <div className="rounded-lg bg-orange-500/10 p-2">
                <p className="text-lg font-bold text-orange-600">€{affiliates.pending_payouts?.toFixed(0) || 0}</p>
                <p className="text-muted-foreground">Offen</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Issues */}
      {issues?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Business-Issues ({issues.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {issues.map((issue: any, i: number) => (
              <div key={i} className={cn("rounded-lg border p-3 text-xs",
                issue.severity === "critical" ? "border-destructive/30 bg-destructive-bg-subtle" :
                issue.severity === "high" ? "border-orange-500/30 bg-orange-500/5" :
                "border-border bg-muted/30"
              )}>
                <div className="flex items-center gap-2 font-medium">
                  {issue.severity === "critical" ? <XCircle className="h-3.5 w-3.5 text-destructive" /> :
                   <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />}
                  {issue.title}
                </div>
                <p className="text-muted-foreground mt-1">{issue.detail}</p>
                <p className="text-primary mt-1 font-medium">→ {issue.recommendation}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
