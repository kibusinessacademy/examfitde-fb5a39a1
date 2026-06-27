import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — <FloatingChip />
 *
 * Pill-Chip mit Icon-Slot. Schwebt z. B. auf Hero-/Image-Cards. Token-driven,
 * variant steuert die semantische Farbe (status-*).
 */

export const CHIP_VARIANTS = [
  'exam',
  'course',
  'tutor',
  'oral',
  'fav',
  'time',
  'ihk',
  'neutral',
] as const;
export type FloatingChipVariant = (typeof CHIP_VARIANTS)[number];

const VARIANT_CLASS: Record<FloatingChipVariant, string> = {
  exam: 'bg-status-current-subtle text-status-current-fg border-status-current-border',
  course: 'bg-status-done-subtle text-status-done-fg border-status-done-border',
  tutor: 'bg-status-info-subtle text-status-info-fg border-status-info-border',
  oral: 'bg-status-recommendation-subtle text-status-recommendation-fg border-status-recommendation-border',
  fav: 'bg-status-recommendation-subtle text-status-recommendation-fg border-status-recommendation-border',
  time: 'bg-status-locked-subtle text-status-locked-fg border-status-locked-border',
  ihk: 'bg-status-info-subtle text-status-info-fg border-status-info-border',
  neutral: 'bg-card/85 text-text-secondary border-border',
};

export interface FloatingChipProps {
  variant?: FloatingChipVariant;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}

export function FloatingChip({
  variant = 'neutral',
  icon,
  children,
  className,
  testId = 'examfit-floating-chip',
}: FloatingChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1',
        'text-[11px] sm:text-xs font-medium shadow-sm',
        VARIANT_CLASS[variant],
        className,
      )}
      data-testid={testId}
      data-variant={variant}
    >
      {icon && <span className="shrink-0" aria-hidden="true">{icon}</span>}
      <span className="whitespace-nowrap">{children}</span>
    </span>
  );
}

export default FloatingChip;
