import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, CheckCircle2, XCircle, Zap, TrendingUp,
  RefreshCw, Shield, Clock, Package, Sparkles,
} from "lucide-react";

function useDailyBriefing() {
  return useQuery({
    queryKey: ["daily-command-briefing"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("daily-command-briefing", {
        body: { action: "generate" },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

const severityStyles: Record<string, string> = {
  critical: "bg-destructive-bg-subtle text-destructive border-destructive/30",
  high: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  medium: "bg-yellow-500/10 text-yellow-700 border-yellow-500/30",
  low: "bg-muted text-muted-foreground border-border",
};

const severityIcons: Record<string, React.ReactNode> = {
  critical: <XCircle className="h-4 w-4" />,
  high: <AlertTriangle className="h-4 w-4" />,
  medium: <Clock className="h-4 w-4" />,
  low: <Shield className="h-4 w-4" />,
};

export default function DailyCommandBriefing() {
  const { data, isLoading, refetch, isRefetching } = useDailyBriefing();

  if (isLoading) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (!data) return null;

  const criticalItems = data.critical_items || [];
  const healedItems = data.healed_items || [];
  const blockedItems = data.blocked_items || [];
  const actions = data.recommended_actions || [];
  const topLever = data.top_lever;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Tagesbriefing
          </h2>
          <p className="text-xs text-muted-foreground">
            {data.briefing_date} · {healedItems.length} geheilt · €{data.revenue_today?.toFixed(2) || "0"} Umsatz heute
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={cn("h-4 w-4", isRefetching && "animate-spin")} />
        </Button>
      </div>

      {/* Top Lever */}
      {topLever && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Zap className="h-4 w-4" />
              Größter Hebel heute
            </div>
            <p className="mt-1 text-sm font-medium text-foreground">{topLever.label}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Critical */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" />
              Heute kritisch ({criticalItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {criticalItems.length === 0 ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-600" /> Keine kritischen Probleme
              </p>
            ) : (
              criticalItems.map((item: any, i: number) => (
                <div key={i} className={cn("rounded-lg border p-2.5 text-xs", severityStyles[item.severity] || severityStyles.low)}>
                  <div className="flex items-center gap-1.5 font-medium">
                    {severityIcons[item.severity]}
                    {item.label}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Healed */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Heute geheilt ({healedItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {healedItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">Keine Auto-Heal-Aktionen in 24h</p>
            ) : (
              healedItems.slice(0, 5).map((item: any, i: number) => (
                <div key={i} className="rounded-lg border border-green-500/20 bg-green-500/5 p-2.5 text-xs">
                  <p className="font-medium text-green-700 dark:text-green-400">{item.action?.replace("auto_heal:", "")}</p>
                  <p className="text-muted-foreground mt-0.5">{item.detail}</p>
                </div>
              ))
            )}
            {data.dry_run_count_24h > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {data.dry_run_count_24h} Dry-Runs
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* Blocked / Publish-Ready */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Package className="h-4 w-4 text-orange-500" />
              Publish-Blocker ({blockedItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {blockedItems.length === 0 ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-600" /> Alles veröffentlicht
              </p>
            ) : (
              blockedItems.slice(0, 5).map((item: any, i: number) => (
                <div key={i} className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-2.5 text-xs">
                  <p className="font-medium text-orange-700 dark:text-orange-400">{item.title}</p>
                  <p className="text-muted-foreground mt-0.5">Track: {item.track || "–"}</p>
                </div>
              ))
            )}
            {data.revenue_at_risk > 0 && (
              <div className="text-xs text-destructive font-medium flex items-center gap-1 mt-1">
                <TrendingUp className="h-3 w-3" />
                ~€{data.revenue_at_risk} entgangener Umsatz
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recommended Actions */}
      {actions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Empfohlene Maßnahmen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {actions.map((action: any, i: number) => (
                <Badge
                  key={i}
                  variant={action.priority === "high" ? "destructive" : action.priority === "medium" ? "default" : "secondary"}
                  className="text-xs py-1 px-2.5"
                >
                  {action.label}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
