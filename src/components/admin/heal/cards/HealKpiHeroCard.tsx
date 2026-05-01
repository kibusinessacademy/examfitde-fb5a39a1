/**
 * HealKpiHeroCard — Heal-Cockpit Hero
 * ───────────────────────────────────
 * Zeigt 24h-KPIs (Auto-Heal-Quote, Success-Rate, MTTR) + Top-3 wiederkehrende Cluster
 * + Anzahl aktiver/eskalierender Pattern. Quelle: v_heal_kpi_overview.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Bot, Clock, Flame, ShieldCheck, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type KpiRow = {
  total_events_24h: number;
  success_24h: number;
  failed_24h: number;
  auto_24h: number;
  manual_24h: number;
  success_rate_pct: number;
  auto_heal_quote_pct: number;
  avg_duration_ms: number;
  top_clusters_24h: Array<{ cluster: string; count: number }>;
  active_pattern_count: number;
  high_severity_count: number;
  escalating_count: number;
  computed_at: string;
};

function fmtMs(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function tone(pct: number, good = 90, warn = 75): "ok" | "warn" | "bad" {
  if (pct >= good) return "ok";
  if (pct >= warn) return "warn";
  return "bad";
}

export function HealKpiHeroCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["heal-kpi-hero"],
    queryFn: async (): Promise<KpiRow | null> => {
      const { data, error } = await supabase
        .from("v_heal_kpi_overview" as never)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as KpiRow) ?? null;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Heal-Pulse 24h
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Heal-Pulse 24h</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Keine Daten in den letzten 24h.
        </CardContent>
      </Card>
    );
  }

  const successTone = tone(data.success_rate_pct, 92, 80);
  const autoTone = tone(data.auto_heal_quote_pct, 80, 60);

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Heal-Pulse 24h
          </CardTitle>
          <div className="flex items-center gap-1.5 flex-wrap">
            {data.high_severity_count > 0 && (
              <Badge variant="destructive" className="gap-1">
                <Flame className="h-3 w-3" />
                {data.high_severity_count} kritisch
              </Badge>
            )}
            {data.escalating_count > 0 && (
              <Badge variant="outline" className="gap-1 border-orange-500/50 text-orange-600 dark:text-orange-400">
                <TrendingUp className="h-3 w-3" />
                {data.escalating_count} eskalierend
              </Badge>
            )}
            <Badge variant="secondary">
              {data.active_pattern_count} aktive Pattern
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile
            icon={ShieldCheck}
            label="Erfolg"
            value={`${data.success_rate_pct}%`}
            sub={`${data.success_24h}/${data.total_events_24h}`}
            tone={successTone}
          />
          <KpiTile
            icon={Bot}
            label="Auto-Heal-Quote"
            value={`${data.auto_heal_quote_pct}%`}
            sub={`${data.auto_24h} auto · ${data.manual_24h} manuell`}
            tone={autoTone}
          />
          <KpiTile
            icon={Clock}
            label="Ø Heal-Dauer"
            value={fmtMs(data.avg_duration_ms)}
            sub="erfolgreiche Heals"
            tone="ok"
          />
          <KpiTile
            icon={Flame}
            label="Fehlschläge 24h"
            value={String(data.failed_24h)}
            sub={`bei ${data.total_events_24h} Events`}
            tone={data.failed_24h > 50 ? "bad" : data.failed_24h > 10 ? "warn" : "ok"}
          />
        </div>

        {data.top_clusters_24h?.length > 0 && (
          <div className="border-t pt-3">
            <div className="text-xs font-medium text-muted-foreground mb-1.5">
              Top-Cluster (24h)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.top_clusters_24h.map((c) => (
                <Badge key={c.cluster} variant="outline" className="font-mono text-xs">
                  {c.cluster}
                  <span className="ml-1.5 text-muted-foreground">{c.count}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub: string;
  tone: "ok" | "warn" | "bad";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-destructive";

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={`text-xl font-semibold ${toneClass}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}
