import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface WaveKpiBoardProps {
  kpi: any;
}

export default function WaveKpiBoard({ kpi }: WaveKpiBoardProps) {
  if (!kpi?.ok) return null;

  return (
    <>
      {/* Core KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Publish Rate</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{kpi.publish_rate_pct ?? 0}%</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Block Rate</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{kpi.block_rate_pct ?? 0}%</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Ø Dauer / Item</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{kpi.avg_duration_min ?? 0} min</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Median Dauer</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{kpi.median_duration_min ?? 0} min</CardContent>
        </Card>
      </div>

      {/* Jobs & Cost KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Jobs (total / failed)</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">
            {kpi.total_jobs ?? 0} / <span className="text-destructive">{kpi.failed_jobs ?? 0}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Job Failure Rate</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{kpi.job_failure_rate_pct ?? 0}%</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">AI Kosten</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">€{kpi.total_ai_cost_eur ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Ø Kosten / Item</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">€{kpi.avg_cost_per_item_eur ?? 0}</CardContent>
        </Card>
      </div>

      {/* Auto-Heal + AI calls */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">AI Calls</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{kpi.ai_calls ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Auto-Heal Runs</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{kpi.auto_heal_runs ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Auto-Heal Success</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{kpi.auto_heal_success ?? 0}</CardContent>
        </Card>
      </div>

      {/* Provider & Job Type Reports */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Model / Provider Report</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(kpi.by_model || []).map((p: any) => (
              <div key={p.model} className="flex items-center justify-between rounded border p-2 text-sm">
                <div className="font-medium truncate max-w-[200px]">{p.model}</div>
                <div className="text-muted-foreground text-xs">
                  {p.calls} calls · €{p.cost_eur} · {p.avg_latency_ms}ms
                </div>
              </div>
            ))}
            {(!kpi.by_model || kpi.by_model.length === 0) && (
              <div className="text-sm text-muted-foreground">Keine Provider-Daten verfügbar.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Job Type Report</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(kpi.by_job_type || []).map((j: any) => (
              <div key={j.job_type} className="flex items-center justify-between rounded border p-2 text-sm">
                <div className="font-medium">{j.job_type}</div>
                <div className="text-muted-foreground text-xs">
                  {j.total} total · {j.done} done · <span className="text-destructive">{j.failed} fail</span> · {j.active} active
                </div>
              </div>
            ))}
            {(!kpi.by_job_type || kpi.by_job_type.length === 0) && (
              <div className="text-sm text-muted-foreground">Keine Job-Daten verfügbar.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
