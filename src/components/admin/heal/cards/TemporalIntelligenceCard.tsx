import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Health = {
  phase_counts: Record<string, number> | null;
  focus_counts: Record<string, number> | null;
  countdown_risk_total: number;
  final_week_learners: number;
  late_new_lf_count: number;
  overdue_reviews_total: number;
  avg_decay: number;
  learners_with_exam_date: number;
  computed_at: string;
};

const PHASE_ORDER = ["unscheduled", "early", "build", "sharpen", "taper", "final", "post"];

export function TemporalIntelligenceCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "temporal-intelligence-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_temporal_intelligence_health" as never);
      if (error) throw error;
      return data as unknown as Health;
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const phases = data?.phase_counts ?? {};
  const focus = data?.focus_counts ?? {};

  const tone =
    (data?.countdown_risk_total ?? 0) > 0 || (data?.overdue_reviews_total ?? 0) > 20
      ? "destructive"
      : (data?.final_week_learners ?? 0) > 0
      ? "secondary"
      : "outline";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" />
          Temporal &amp; Exam Window (Bridge 15)
          <Badge
            variant={tone as "default" | "destructive" | "secondary" | "outline"}
            className="ml-auto"
          >
            {data?.countdown_risk_total ?? 0} ≤14d
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
              <Kpi label="With exam date" value={data.learners_with_exam_date} />
              <Kpi label="Final week" value={data.final_week_learners} />
              <Kpi label="Overdue reviews" value={data.overdue_reviews_total} />
              <Kpi label="Avg decay" value={data.avg_decay} suffix="/100" />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Phase distribution</p>
              <div className="flex flex-wrap gap-2">
                {PHASE_ORDER.map((k) => (
                  <Badge
                    key={k}
                    variant={
                      k === "final" || k === "taper"
                        ? "destructive"
                        : k === "sharpen"
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {k}: {phases[k] ?? 0}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Recommended focus</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(focus).length === 0 && (
                  <span className="text-xs text-muted-foreground">No data</span>
                )}
                {Object.entries(focus).map(([k, v]) => (
                  <Badge key={k} variant="outline">
                    {k}: {v}
                  </Badge>
                ))}
              </div>
            </div>

            {data.late_new_lf_count > 0 && (
              <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
                <span className="font-medium">Time-pressure signal:</span>{" "}
                {data.late_new_lf_count} neue LFs in final week — Trainer-Alert-Kandidaten.
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              Transparente zeitbezogene Lernsteuerung · keine Panik-Nudges · explainable Phase-Mapping
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
