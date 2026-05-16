/**
 * Bridge 9 — Cohort & Population Intelligence
 *
 * Zeigt:
 *  • Cohort-Readiness-Verteilung pro Curriculum (snapshot)
 *  • Population-Failure-Patterns (HIGH/CRITICAL Cluster)
 *  • Exam-Readiness-Benchmarks (Aggregate über Cohorts)
 *
 * SSOT-only — Daten ausschließlich über admin_get_*-RPCs.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface CohortRow {
  cohort_type: string;
  cohort_key: string;
  curriculum_id: string | null;
  snapshot_date: string;
  learner_count: number;
  avg_readiness: number | null;
  pct_at_risk: number | null;
  pct_ready: number | null;
}

interface PatternRow {
  cluster_key: string;
  cluster_label: string;
  lf_code: string | null;
  risk_bucket: string;
  learner_count: number;
  fail_rate: number | null;
  confidence_label: string;
  sample_size: number;
}

interface BenchmarkRow {
  curriculum_id: string;
  snapshot_date: string;
  benchmark_avg_readiness: number | null;
  benchmark_pass_rate: number | null;
  benchmark_pct_at_risk: number | null;
  total_learners: number;
  cohort_count: number;
}

const num = (n: number | null | undefined, suffix = "") =>
  n == null ? "—" : `${Number(n).toFixed(1)}${suffix}`;

export function CohortPopulationIntelligenceCard() {
  const cohorts = useQuery({
    queryKey: ["cohort-readiness-distribution"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_cohort_readiness_distribution" as any,
        { p_limit: 25 },
      );
      if (error) throw error;
      return (data ?? []) as CohortRow[];
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const patterns = useQuery({
    queryKey: ["population-failure-patterns"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_population_failure_patterns" as any,
        { p_limit: 25 },
      );
      if (error) throw error;
      return (data ?? []) as PatternRow[];
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const benchmarks = useQuery({
    queryKey: ["exam-readiness-benchmarks"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_exam_readiness_benchmarks" as any,
        { p_limit: 25 },
      );
      if (error) throw error;
      return (data ?? []) as BenchmarkRow[];
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const loading = cohorts.isLoading || patterns.isLoading || benchmarks.isLoading;
  const hasAny =
    (cohorts.data?.length ?? 0) +
      (patterns.data?.length ?? 0) +
      (benchmarks.data?.length ?? 0) >
    0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-primary" />
          Cohort &amp; Population Intelligence
          <Badge variant="outline" className="ml-2 text-xs">Bridge 9</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Gruppenverhalten, Risikocluster, Curriculum-Benchmarks. SSOT:{" "}
          <code>cohort_snapshots</code> · <code>population_risk_clusters</code>.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !hasAny ? (
          <p className="text-sm text-muted-foreground">
            Noch keine Cohort-Snapshots. <code>fn_recompute_population_intelligence()</code>{" "}
            via service_role ausführen, um den ersten Snapshot zu erzeugen.
          </p>
        ) : (
          <>
            {/* Cohort Readiness */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Cohort Readiness Distribution
              </h4>
              {(cohorts.data?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">Keine Snapshots in 90d.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b">
                        <th className="text-left py-1.5 pr-3">Cohort</th>
                        <th className="text-right py-1.5 pr-3">Learner</th>
                        <th className="text-right py-1.5 pr-3">Ø Readiness</th>
                        <th className="text-right py-1.5 pr-3">% At-Risk</th>
                        <th className="text-right py-1.5 pr-3">% Ready</th>
                        <th className="text-right py-1.5">Datum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cohorts.data!.slice(0, 10).map((r) => (
                        <tr key={`${r.cohort_key}:${r.snapshot_date}`} className="border-b last:border-0">
                          <td className="py-1.5 pr-3 font-mono truncate max-w-[280px]">{r.cohort_key}</td>
                          <td className="py-1.5 pr-3 text-right">{r.learner_count}</td>
                          <td className="py-1.5 pr-3 text-right">{num(r.avg_readiness)}</td>
                          <td className="py-1.5 pr-3 text-right">{num(r.pct_at_risk, "%")}</td>
                          <td className="py-1.5 pr-3 text-right">{num(r.pct_ready, "%")}</td>
                          <td className="py-1.5 text-right text-muted-foreground">{r.snapshot_date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Population Failure Patterns */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Population Failure Patterns
              </h4>
              {(patterns.data?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">Keine kritischen Cluster.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b">
                        <th className="text-left py-1.5 pr-3">Cluster</th>
                        <th className="text-left py-1.5 pr-3">Risk</th>
                        <th className="text-right py-1.5 pr-3">n</th>
                        <th className="text-right py-1.5 pr-3">Fail Rate</th>
                        <th className="text-left py-1.5">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patterns.data!.slice(0, 10).map((r) => (
                        <tr key={r.cluster_key} className="border-b last:border-0">
                          <td className="py-1.5 pr-3 truncate max-w-[260px]">{r.cluster_label}</td>
                          <td className="py-1.5 pr-3">
                            <Badge
                              variant="outline"
                              className={
                                r.risk_bucket === "CRITICAL"
                                  ? "border-destructive text-destructive"
                                  : r.risk_bucket === "HIGH"
                                  ? "border-orange-500 text-orange-500"
                                  : ""
                              }
                            >
                              {r.risk_bucket}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-3 text-right">{r.sample_size}</td>
                          <td className="py-1.5 pr-3 text-right">{num(r.fail_rate, "%")}</td>
                          <td className="py-1.5 text-muted-foreground">{r.confidence_label}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Benchmarks */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Exam Readiness Benchmarks
              </h4>
              {(benchmarks.data?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">Noch keine Benchmark-Aggregate.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b">
                        <th className="text-left py-1.5 pr-3">Curriculum</th>
                        <th className="text-right py-1.5 pr-3">Ø Readiness</th>
                        <th className="text-right py-1.5 pr-3">Ø Pass Rate</th>
                        <th className="text-right py-1.5 pr-3">Ø At-Risk</th>
                        <th className="text-right py-1.5 pr-3">Learner</th>
                        <th className="text-right py-1.5">Datum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchmarks.data!.slice(0, 10).map((r) => (
                        <tr key={`${r.curriculum_id}:${r.snapshot_date}`} className="border-b last:border-0">
                          <td className="py-1.5 pr-3 font-mono truncate max-w-[220px]">
                            {r.curriculum_id?.slice(0, 8)}…
                          </td>
                          <td className="py-1.5 pr-3 text-right">{num(r.benchmark_avg_readiness)}</td>
                          <td className="py-1.5 pr-3 text-right">{num(r.benchmark_pass_rate, "%")}</td>
                          <td className="py-1.5 pr-3 text-right">{num(r.benchmark_pct_at_risk, "%")}</td>
                          <td className="py-1.5 pr-3 text-right">{r.total_learners}</td>
                          <td className="py-1.5 text-right text-muted-foreground">{r.snapshot_date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
