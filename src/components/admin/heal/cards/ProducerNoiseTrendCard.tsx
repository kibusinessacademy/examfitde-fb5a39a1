/**
 * ProducerNoiseTrendCard
 * ──────────────────────────────────────────────────────────────────────
 * 60-Min-Trend für Producer-Noise nach cluster_heal_nudge_2026_05_06.
 * Datenquelle: admin_get_producer_noise_trend(p_minutes) +
 *              admin_get_producer_noise_anomalies(p_minutes).
 * Aggregiert auf 5-Min-Buckets, refetch alle 60s.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo } from "react";

type TrendRow = {
  bucket_minute: string;
  action_type: string;
  producer: string;
  job_type: string;
  n: number;
};

type AnomalyRow = {
  action_type: string;
  producer: string;
  recent_n: number;
  prior_n: number;
  ratio: number | null;
  severity: "info" | "warning" | "critical";
};

const ACTION_LABELS: Record<string, string> = {
  producer_blocked_package_progress: "Blocked Progress",
  producer_precheck_skip: "Precheck Skip",
  ssot_payload_warn: "SSOT Warn",
  cluster_heal_nudge_2026_05_06: "Cluster Heal",
};

export function ProducerNoiseTrendCard() {
  const trendQ = useQuery({
    queryKey: ["producer-noise-trend", 60],
    queryFn: async (): Promise<TrendRow[]> => {
      const { data, error } = await (supabase as any).rpc(
        "admin_get_producer_noise_trend",
        { p_minutes: 60 },
      );
      if (error) throw error;
      return (data ?? []) as TrendRow[];
    },
    refetchInterval: 60_000,
  });

  const anomalyQ = useQuery({
    queryKey: ["producer-noise-anomalies", 60],
    queryFn: async (): Promise<AnomalyRow[]> => {
      const { data, error } = await (supabase as any).rpc(
        "admin_get_producer_noise_anomalies",
        { p_minutes: 60 },
      );
      if (error) throw error;
      return (data ?? []) as AnomalyRow[];
    },
    refetchInterval: 60_000,
  });

  const summary = useMemo(() => {
    const rows = trendQ.data ?? [];
    const totals = new Map<string, number>();
    for (const r of rows) {
      totals.set(r.action_type, (totals.get(r.action_type) ?? 0) + Number(r.n));
    }
    return totals;
  }, [trendQ.data]);

  const topProducers = useMemo(() => {
    const rows = trendQ.data ?? [];
    const m = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.action_type}::${r.producer}`;
      m.set(key, (m.get(key) ?? 0) + Number(r.n));
    }
    return Array.from(m.entries())
      .map(([k, n]) => {
        const [action, producer] = k.split("::");
        return { action, producer, n };
      })
      .sort((a, b) => b.n - a.n)
      .slice(0, 8);
  }, [trendQ.data]);

  const anomalies = anomalyQ.data ?? [];
  const critical = anomalies.filter((a) => a.severity === "critical");
  const warnings = anomalies.filter((a) => a.severity === "warning");

  if (trendQ.isLoading) return <Skeleton className="h-64 w-full" />;
  if (trendQ.error) {
    return (
      <Card>
        <CardContent className="p-4 text-xs text-destructive">
          Producer-Noise-Trend konnte nicht geladen werden.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Producer-Noise Trend (60 min)
          </span>
          <div className="flex items-center gap-1.5">
            {critical.length > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {critical.length} critical
              </Badge>
            )}
            {warnings.length > 0 && (
              <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">
                <TrendingUp className="h-3 w-3 mr-1" />
                {warnings.length} warn
              </Badge>
            )}
            {critical.length === 0 && warnings.length === 0 && (
              <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                <TrendingDown className="h-3 w-3 mr-1" />
                stable
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Totals per action_type */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {Object.entries(ACTION_LABELS).map(([k, label]) => {
            const n = summary.get(k) ?? 0;
            const tone =
              k === "cluster_heal_nudge_2026_05_06"
                ? "border-primary/30 bg-primary/5 text-primary"
                : n === 0
                ? "border-border bg-card"
                : n > 200
                ? "border-warning/30 bg-warning-bg-subtle text-warning"
                : "border-border bg-card";
            return (
              <div key={k} className={`rounded-md border p-2 ${tone}`}>
                <div className="text-[10px] uppercase tracking-wide opacity-80">
                  {label}
                </div>
                <div className="text-xl font-bold">{n}</div>
              </div>
            );
          })}
        </div>

        {/* Anomalies */}
        {anomalies.length > 0 && (
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">
              Anomalien (recent vs prior 60min)
            </div>
            {anomalies.slice(0, 6).map((a, i) => (
              <div
                key={i}
                className={`flex items-center justify-between text-[11px] rounded px-2 py-1 ${
                  a.severity === "critical"
                    ? "bg-destructive-bg-subtle text-destructive"
                    : "bg-warning-bg-subtle text-warning"
                }`}
              >
                <span className="font-mono truncate">
                  {a.action_type} · {a.producer}
                </span>
                <span className="font-mono shrink-0">
                  {a.prior_n} → {a.recent_n} ({a.ratio ?? "∞"}×)
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Top Producers */}
        {topProducers.length > 0 && (
          <div className="space-y-0.5">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">
              Top-Producer (60 min)
            </div>
            {topProducers.map((p, i) => (
              <div
                key={i}
                className="flex justify-between text-[11px] font-mono text-muted-foreground"
              >
                <span className="truncate">
                  {ACTION_LABELS[p.action] ?? p.action} · {p.producer}
                </span>
                <span>{p.n}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ProducerNoiseTrendCard;
