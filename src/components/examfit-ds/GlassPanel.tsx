import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — <GlassPanel />
 *
 * Leichter Frost-Container. Nutzt `--glass-bg` + Border-Token. KEIN
 * `backdrop-filter` als Default — der ist in der Renderer-Sandbox teuer und
 * crash-anfällig. Wer opt-in will, kann `enableBackdropBlur` setzen (Allowlist).
 */

export interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  /** Opt-in: nur in Browser-Kontexten verwenden, nicht in Render-Pipelines. */
  enableBackdropBlur?: boolean;
  radius?: 'card' | 'card-lg' | 'card-xl';
  testId?: string;
}

const RADIUS_CLASS: Record<NonNullable<GlassPanelProps['radius']>, string> = {
  card: 'rounded-card',
  'card-lg': 'rounded-card-lg',
  'card-xl': 'rounded-card-xl',
};

export function GlassPanel({
  children,
  className,
  enableBackdropBlur = false,
  radius = 'card',
  testId = 'examfit-glass-panel',
}: GlassPanelProps) {
  return (
    <div
      className={cn(
        'border shadow-sm',
        RADIUS_CLASS[radius],
        className,
      )}
      style={{
        background: 'var(--glass-bg)',
        borderColor: 'var(--glass-border)',
        ...(enableBackdropBlur ? { backdropFilter: 'blur(var(--glass-blur))' } : {}),
      }}
      data-testid={testId}
      data-backdrop-blur={enableBackdropBlur ? 'on' : 'off'}
    >
      {children}
    </div>
  );
}

export default GlassPanel;
