interface PipelinePerformanceBoardProps {
  data?: {
    lessons_last_hour: number;
    lessons_last_12h: number;
    avg_lessons_per_hour_12h: number;
    cooldown_loss: Array<{
      provider: string;
      model: string;
      cooldown_events: number;
      cooldown_minutes_lost_12h: number;
    }>;
    provider_fail_rates: Array<{
      provider: string;
      model: string;
      total_jobs: number;
      failed_jobs: number;
      success_jobs: number;
      fail_rate_pct: number;
    }>;
    building_eta: Array<{
      package_id: string;
      title: string;
      build_progress: number;
      real_lessons: number;
      total_lessons: number;
      remaining_lessons: number;
      global_lessons_per_hour: number;
      eta_hours_content_only: number | null;
      updated_at: string;
    }>;
  };
}

export default function PipelinePerformanceBoard({ data }: PipelinePerformanceBoardProps) {
  const cooldownLoss = data?.cooldown_loss ?? [];
  const failRates = data?.provider_fail_rates ?? [];
  const eta = data?.building_eta ?? [];

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold tracking-tight">Pipeline Performance</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-sm text-muted-foreground">Lessons letzte Stunde</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{data?.lessons_last_hour ?? 0}</div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-sm text-muted-foreground">Lessons letzte 12h</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{data?.lessons_last_12h ?? 0}</div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-sm text-muted-foreground">Ø Lessons / Stunde</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{data?.avg_lessons_per_hour_12h ?? 0}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 font-medium text-foreground">Cooldown Loss (12h)</div>
          <div className="space-y-2">
            {cooldownLoss.length === 0 && (
              <div className="text-sm text-muted-foreground">Keine Cooldown-Verluste</div>
            )}
            {cooldownLoss.map((row, idx) => (
              <div key={`${row.provider}-${row.model}-${idx}`} className="rounded-xl border border-border p-3">
                <div className="font-medium text-sm text-foreground">{row.provider}/{row.model}</div>
                <div className="text-xs text-muted-foreground">
                  {row.cooldown_events} Events · {row.cooldown_minutes_lost_12h} min verloren
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 font-medium text-foreground">Provider Fail Rate (12h)</div>
          <div className="space-y-2">
            {failRates.length === 0 && (
              <div className="text-sm text-muted-foreground">Keine Provider-Daten</div>
            )}
            {failRates.map((row, idx) => (
              <div key={`${row.provider}-${row.model}-${idx}`} className="rounded-xl border border-border p-3">
                <div className="font-medium text-sm text-foreground">{row.provider}/{row.model}</div>
                <div className="text-xs text-muted-foreground">
                  Fail {row.fail_rate_pct}% · {row.failed_jobs}/{row.total_jobs} failed · {row.success_jobs} ok
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 font-medium text-foreground">Building Package ETA</div>
        <div className="space-y-2">
          {eta.length === 0 && (
            <div className="text-sm text-muted-foreground">Keine Building-Pakete</div>
          )}
          {eta.map((row) => (
            <div key={row.package_id} className="rounded-xl border border-border p-3">
              <div className="font-medium text-sm text-foreground">{row.title}</div>
              <div className="flex items-center gap-3 mt-1">
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(100, (row.real_lessons / Math.max(row.total_lessons, 1)) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {row.real_lessons}/{row.total_lessons}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Progress {row.build_progress}% · Remaining {row.remaining_lessons} ·
                ETA ~ {row.eta_hours_content_only != null ? `${row.eta_hours_content_only}h` : "–"} ·
                Ø {row.global_lessons_per_hour}/h
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
