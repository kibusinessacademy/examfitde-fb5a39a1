import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getBundleKpiImpact } from "@/lib/berufs-ki/outcome";

function fmt(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  return Number.isInteger(v) ? v.toLocaleString("de-DE") : v.toFixed(1);
}

export function KpiImpactPanel({ bundleId }: { bundleId: string }) {
  const q = useQuery({
    queryKey: ["outcome-bundle-kpi", bundleId],
    queryFn: () => getBundleKpiImpact(bundleId),
    enabled: !!bundleId,
  });

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">KPI Impact (normalisiert)</CardTitle></CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : q.error ? (
          <p className="text-sm text-destructive">Nicht ladbar: {(q.error as Error).message}</p>
        ) : (q.data?.metrics ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine messbaren KPIs im Bundle.</p>
        ) : (
          <div className="space-y-3">
            {(q.data?.metrics ?? []).map((m, i) => {
              const isImprovement = m.delta != null && m.delta > 0;
              const deltaColor = m.delta_pct == null ? "text-muted-foreground"
                : isImprovement ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400";
              return (
                <div key={`${m.metric_name}-${i}`} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{m.metric_name}</div>
                    <div className="flex items-center gap-2">
                      {m.confidence != null && <Badge variant="outline">conf {Number(m.confidence).toFixed(2)}</Badge>}
                      {m.horizon && <Badge variant="secondary">{m.horizon}</Badge>}
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-sm tabular-nums">
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Baseline</div>
                      <div>{fmt(m.baseline)} {m.unit ?? ""}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Target</div>
                      <div>{fmt(m.target)} {m.unit ?? ""}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Δ</div>
                      <div className={deltaColor}>
                        {fmt(m.delta)} {m.unit ?? ""}
                        {m.delta_pct != null && <span className="ml-1 text-xs">({m.delta_pct > 0 ? "+" : ""}{Number(m.delta_pct).toFixed(1)}%)</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {Array.isArray(q.data?.benchmarks) && q.data!.benchmarks.length > 0 && (
              <details className="mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer">Branchen-Benchmark anzeigen ({q.data!.benchmarks.length})</summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted/40 p-2">{JSON.stringify(q.data!.benchmarks, null, 2)}</pre>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
