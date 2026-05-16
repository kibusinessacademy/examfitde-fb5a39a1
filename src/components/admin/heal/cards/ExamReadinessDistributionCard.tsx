import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GraduationCap } from "lucide-react";

type Row = {
  curriculum_id: string;
  ready_count: number;
  partial_count: number;
  at_risk_count: number;
  critical_count: number;
  not_started_count: number;
  total_learners: number;
  avg_score: number;
};

export function ExamReadinessDistributionCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-readiness-distribution"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc("admin_get_readiness_distribution" as any, {
        p_curriculum_id: null,
      });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
  });

  const totals = (data ?? []).reduce(
    (acc, r) => ({
      ready: acc.ready + (r.ready_count ?? 0),
      partial: acc.partial + (r.partial_count ?? 0),
      at_risk: acc.at_risk + (r.at_risk_count ?? 0),
      critical: acc.critical + (r.critical_count ?? 0),
      not_started: acc.not_started + (r.not_started_count ?? 0),
      total: acc.total + (r.total_learners ?? 0),
    }),
    { ready: 0, partial: 0, at_risk: 0, critical: 0, not_started: 0, total: 0 },
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <GraduationCap className="h-4 w-4 text-primary" />
          Exam Readiness v2 — Verteilung
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : totals.total === 0 ? (
          <p className="text-xs text-muted-foreground">
            Noch keine Snapshots — Worker erzeugt diese nach erstem Mastery-Update.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-2">
              <Stat label="READY" value={totals.ready} tone="success" />
              <Stat label="PARTIAL" value={totals.partial} tone="warning" />
              <Stat label="AT_RISK" value={totals.at_risk} tone="warning" />
              <Stat label="CRITICAL" value={totals.critical} tone="destructive" />
              <Stat label="NOT_STARTED" value={totals.not_started} tone="muted" />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{totals.total} Learner gesamt</span>
              <span>
                Ø Score:{" "}
                {data && data.length > 0
                  ? Math.round(
                      data.reduce((a, r) => a + (r.avg_score ?? 0) * (r.total_learners ?? 0), 0) /
                        Math.max(totals.total, 1),
                    )
                  : 0}
              </span>
            </div>
            <div className="space-y-1 pt-2 border-t border-border">
              {(data ?? []).slice(0, 5).map((r) => (
                <div key={r.curriculum_id} className="flex items-center justify-between text-xs">
                  <code className="text-muted-foreground truncate max-w-[180px]">
                    {r.curriculum_id.slice(0, 8)}…
                  </code>
                  <div className="flex gap-1">
                    <Badge variant="outline" className="h-5 text-[10px]">
                      R {r.ready_count}
                    </Badge>
                    <Badge variant="outline" className="h-5 text-[10px]">
                      AR {r.at_risk_count}
                    </Badge>
                    <Badge variant="outline" className="h-5 text-[10px]">
                      C {r.critical_count}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  const cls =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : "text-muted-foreground";
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2 text-center">
      <div className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
