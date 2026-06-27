import { cn } from '@/lib/utils';

/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — <ProgressMeter />
 *
 * Vereinheitlicht Bar / Dots / Ring. Token-driven, status-* Farben,
 * korrekte ARIA-Semantik. Mobile-first: Dots nur bei total <= 8.
 */

export interface ProgressMeterProps {
  shape: 'bar' | 'dots' | 'ring';
  current: number;
  total: number;
  showPercent?: boolean;
  label?: string;
  className?: string;
  testId?: string;
}

function clampPct(current: number, total: number): number {
  const t = Math.max(1, total);
  const c = Math.min(Math.max(0, current), t);
  return Math.round((c / t) * 100);
}

export function ProgressMeter({
  shape,
  current,
  total,
  showPercent,
  label,
  className,
  testId = 'examfit-progress',
}: ProgressMeterProps) {
  const pct = clampPct(current, total);
  const announce = label ?? `Fortschritt ${pct}%`;

  if (shape === 'bar') {
    return (
      <div className={cn('flex flex-col gap-1.5', className)} data-testid={testId} data-shape="bar">
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>{announce}</span>
          {showPercent && <span className="tabular-nums font-medium text-text-primary">{pct}%</span>}
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={announce}
          className="h-1.5 w-full overflow-hidden rounded-full bg-track-subtle"
        >
          <div
            className="h-full bg-status-current transition-[width] duration-base ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  if (shape === 'dots') {
    const t = Math.max(1, Math.min(8, total));
    const c = Math.min(Math.max(0, current), t);
    return (
      <div
        className={cn('flex items-center gap-1.5', className)}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={announce}
        data-testid={testId}
        data-shape="dots"
      >
        {Array.from({ length: t }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-2 w-2 rounded-full transition-colors',
              i + 1 < c && 'bg-status-done',
              i + 1 === c && 'bg-status-current',
              i + 1 > c && 'bg-track-subtle',
            )}
          />
        ))}
      </div>
    );
  }

  // ring
  const size = 56;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - pct / 100);
  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={announce}
      data-testid={testId}
      data-shape="ring"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--track-subtle))"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--status-current))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="transition-[stroke-dashoffset] duration-base ease-out"
        />
      </svg>
      {showPercent && (
        <span className="absolute text-[11px] font-semibold tabular-nums text-text-primary">
          {pct}%
        </span>
      )}
    </div>
  );
}

export default ProgressMeter;
