import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type InterventionEffect = {
  scenario_type: string;
  horizon_days: number;
  avg_delta: number;
  n: number;
};

type Health = {
  scenario_counts: Record<string, number> | null;
  status_counts: Record<string, number> | null;
  projected_failure_paths: number;
  avg_status_quo_prob: number;
  top_intervention_effects: InterventionEffect[];
  runs_24h: number;
  avg_duration_ms: number;
  computed_at: string;
};

export function PredictiveSimulationCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "predictive-simulation-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_predictive_simulation_health" as never);
      if (error) throw error;
      return data as unknown as Health;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const scenarios = data?.scenario_counts ?? {};
  const statuses = data?.status_counts ?? {};
  const effects = data?.top_intervention_effects ?? [];

  const tone =
    (data?.projected_failure_paths ?? 0) > 5
      ? "destructive"
      : (data?.projected_failure_paths ?? 0) > 0
      ? "secondary"
      : "outline";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4" />
          Predictive Scenario Simulation (Bridge 16)
          <Badge
            variant={tone as "default" | "destructive" | "secondary" | "outline"}
            className="ml-auto"
          >
            {data?.projected_failure_paths ?? 0} at-risk paths
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <Skeleton className="h-24 w-full" />}
        {error && (
          <p className="text-sm text-destructive">
            Failed: {(error as Error).message}
          </p>
        )}
        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Kpi label="Runs 24h" value={data.runs_24h} />
              <Kpi label="Avg latency" value={data.avg_duration_ms} suffix="ms" />
              <Kpi
                label="Status-quo prob"
                value={Math.round(data.avg_status_quo_prob * 100)}
                suffix="%"
              />
              <Kpi label="Failure paths" value={data.projected_failure_paths} />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Scenario coverage</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(scenarios).length === 0 && (
                  <span className="text-xs text-muted-foreground">No scenarios yet</span>
                )}
                {Object.entries(scenarios).map(([k, v]) => (
                  <Badge key={k} variant="outline">
                    {k}: {v}
                  </Badge>
                ))}
              </div>
              {Object.keys(statuses).length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {Object.entries(statuses).map(([k, v]) => (
                    <Badge
                      key={k}
                      variant={k === "failed" ? "destructive" : k === "completed" ? "secondary" : "outline"}
                    >
                      {k}: {v}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Top intervention effects (Δ vs status-quo)
              </p>
              {effects.length === 0 ? (
                <span className="text-xs text-muted-foreground">No comparative data yet</span>
              ) : (
                <div className="space-y-1">
                  {effects.map((e, i) => (
                    <div
                      key={`${e.scenario_type}-${e.horizon_days}-${i}`}
                      className="flex items-center justify-between text-xs rounded border border-border bg-card p-2"
                    >
                      <span className="font-medium">{e.scenario_type}</span>
                      <span className="text-muted-foreground">@{e.horizon_days}d</span>
                      <Badge
                        variant={e.avg_delta > 0 ? "secondary" : "destructive"}
                        className="tabular-nums"
                      >
                        {e.avg_delta > 0 ? "+" : ""}
                        {(e.avg_delta * 100).toFixed(1)}pp
                      </Badge>
                      <span className="text-muted-foreground">n={e.n}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground">
              Probabilistisch · Confidence-Band · explainable Drivers · keine deterministischen Versprechen
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
      <p className="text-lg font-semibold tabular-nums">
        {value}
        {suffix && <span className="text-xs text-muted-foreground ml-0.5">{suffix}</span>}
      </p>
    </div>
  );
}
