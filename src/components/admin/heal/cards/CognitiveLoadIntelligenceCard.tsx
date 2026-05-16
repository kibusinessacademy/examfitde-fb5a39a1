import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Health = {
  state_counts: Record<string, number> | null;
  overload_risk_total: number;
  avg_fatigue: number;
  avg_stability: number;
  open_signals_by_type: Record<string, number> | null;
  open_signals_by_severity: Record<string, number> | null;
  burnout_clusters: number;
  sessions_14d: number;
  computed_at: string;
};

export function CognitiveLoadIntelligenceCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "cognitive-load-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_cognitive_load_health" as never);
      if (error) throw error;
      return data as unknown as Health;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const states = data?.state_counts ?? {};
  const sigType = data?.open_signals_by_type ?? {};
  const sigSev = data?.open_signals_by_severity ?? {};

  const tone =
    (data?.overload_risk_total ?? 0) > 0 || (sigSev.critical ?? 0) > 0
      ? "destructive"
      : (data?.avg_fatigue ?? 0) >= 40
      ? "secondary"
      : "outline";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-4 w-4" />
          Cognitive Load &amp; Learning State (Bridge 14)
          <Badge variant={tone as "default" | "destructive" | "secondary" | "outline"} className="ml-auto">
            {data?.overload_risk_total ?? 0} at-risk
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
              <Kpi label="Avg fatigue" value={data.avg_fatigue} suffix="/100" />
              <Kpi label="Avg stability" value={data.avg_stability} suffix="/100" />
              <Kpi label="Burnout clusters" value={data.burnout_clusters} />
              <Kpi label="Sessions 14d" value={data.sessions_14d} />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Load distribution</p>
              <div className="flex flex-wrap gap-2">
                {["low", "normal", "elevated", "overload"].map((k) => (
                  <Badge
                    key={k}
                    variant={k === "overload" ? "destructive" : k === "elevated" ? "secondary" : "outline"}
                  >
                    {k}: {states[k] ?? 0}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Open signals (7d)</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(sigType).length === 0 && (
                  <span className="text-xs text-muted-foreground">No open signals</span>
                )}
                {Object.entries(sigType).map(([k, v]) => (
                  <Badge key={k} variant="outline">
                    {k}: {v}
                  </Badge>
                ))}
              </div>
              {Object.keys(sigSev).length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {Object.entries(sigSev).map(([k, v]) => (
                    <Badge
                      key={k}
                      variant={k === "critical" || k === "high" ? "destructive" : "secondary"}
                    >
                      {k}: {v}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground">
              SSOT-bounded · Lernsystem-Signale only · keine psychologische Diagnostik · DSGVO/EU AI Act safe
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
