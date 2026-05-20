/**
 * Phase 8.5 — Readiness-Verlauf (longitudinal, sachlich).
 */
import type { ReadinessTrend, StabilitySignal } from "@/lib/examiner/ExaminerLongitudinal";

interface Props {
  trend: ReadinessTrend;
  stability: StabilitySignal;
}

export function ReadinessTimeline({ trend, stability }: Props) {
  const points = (trend.series ?? []).slice(-12).map((p) => p.smoothed);
  const max = 100;
  return (
    <section aria-labelledby="readiness-timeline-h">
      <header className="flex items-baseline justify-between mb-2">
        <h3 id="readiness-timeline-h" className="text-sm font-semibold text-text-primary">
          Prüfungsreife im Verlauf
        </h3>
        <span className="text-xs text-text-tertiary">
          Stabilität: {stability.reading} · Tendenz: {trend.direction}
        </span>
      </header>
      <div className="flex items-end gap-1 h-16 border-b border-border-subtle">
        {points.length === 0 && (
          <span className="text-xs text-text-tertiary">Noch keine Verlaufsdaten erfasst.</span>
        )}
        {points.map((p, i) => (
          <div
            key={i}
            className="flex-1 bg-text-secondary/60 rounded-t"
            style={{ height: `${Math.max(2, (p / max) * 100)}%` }}
            title={`${p}/100`}
          />
        ))}
      </div>
    </section>
  );
}
