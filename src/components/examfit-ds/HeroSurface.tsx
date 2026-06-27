import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — <HeroSurface />
 *
 * Bereichs-Verlaufsfläche. Token-driven, nutzt Tailwind `bg-hero-{area}` aus
 * den `--surface-hero-*`-Variablen. Sehr ruhig & dezent — kein Neon, kein Glow.
 *
 * - Keine Animation by default (`prefers-reduced-motion`-safe).
 * - Optionaler `parallax`-Slot rendert oben/rechts mit `mix-blend-overlay`,
 *   ohne `backdrop-filter` (sandbox/render-safe).
 */

export const HERO_AREAS = ['learn', 'exam', 'tutor', 'oral', 'shop'] as const;
export type HeroArea = (typeof HERO_AREAS)[number];

const AREA_BG: Record<HeroArea, string> = {
  learn: 'bg-hero-learn',
  exam: 'bg-hero-exam',
  tutor: 'bg-hero-tutor',
  oral: 'bg-hero-oral',
  shop: 'bg-hero-shop',
};

export interface HeroSurfaceProps {
  area: HeroArea;
  children?: ReactNode;
  /** Optionaler dekorativer Layer (Bild, SVG-Pattern, Texture). */
  parallax?: ReactNode;
  /** Card-Radius. Default: card-lg (24px). */
  radius?: 'card' | 'card-lg' | 'card-xl';
  className?: string;
  testId?: string;
}

const RADIUS_CLASS: Record<NonNullable<HeroSurfaceProps['radius']>, string> = {
  card: 'rounded-card',
  'card-lg': 'rounded-card-lg',
  'card-xl': 'rounded-card-xl',
};

export function HeroSurface({
  area,
  children,
  parallax,
  radius = 'card-lg',
  className,
  testId = 'examfit-hero-surface',
}: HeroSurfaceProps) {
  return (
    <section
      className={cn(
        'relative overflow-hidden border border-border/40 shadow-hero',
        AREA_BG[area],
        RADIUS_CLASS[radius],
        className,
      )}
      data-testid={testId}
      data-area={area}
    >
      {parallax && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-60 mix-blend-overlay"
          data-testid="examfit-hero-parallax"
        >
          {parallax}
        </div>
      )}
      <div className="relative z-10 p-5 sm:p-8">{children}</div>
    </section>
  );
}

export default HeroSurface;
