import { type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — <ImageCard />
 *
 * Große Bildkarte für Navigation/Übersicht (z. B. Dashboard-Kacheln,
 * Kompetenz-Tiles, Bereichs-Einstiege). NICHT für Lernschritt-Inputs —
 * dafür ist LearnLessonCard zuständig.
 *
 * - `image` ist optional; ohne Bild rendert die Karte gradient-fallback (kein Shift).
 * - Hover-Lift via `hover:shadow-card-hover` + sanftes translate-y.
 * - Komplett token-driven, keine Hex-Werte.
 */

export interface ImageCardProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Bild-URL. Fehlt sie, wird ein gradient-Fallback (`fallbackArea`) gezeigt. */
  image?: string | null;
  imageAlt?: string;
  /** Fallback-Verlauf, wenn `image` fehlt. */
  fallbackArea?: 'learn' | 'exam' | 'tutor' | 'oral' | 'shop';
  /** Footer-Aktion: Text + optional onClick. Rein navigatorisch. */
  actionLabel?: string;
  onClick?: () => void;
  /** Slot rechts oben für FloatingChips o. Ä. */
  topRight?: ReactNode;
  className?: string;
  testId?: string;
}

const FALLBACK_CLASS: Record<NonNullable<ImageCardProps['fallbackArea']>, string> = {
  learn: 'bg-hero-learn',
  exam: 'bg-hero-exam',
  tutor: 'bg-hero-tutor',
  oral: 'bg-hero-oral',
  shop: 'bg-hero-shop',
};

export function ImageCard({
  title,
  eyebrow,
  description,
  image,
  imageAlt = '',
  fallbackArea = 'learn',
  actionLabel,
  onClick,
  topRight,
  className,
  testId = 'examfit-image-card',
}: ImageCardProps) {
  const isInteractive = typeof onClick === 'function';
  const Tag: 'button' | 'div' = isInteractive ? 'button' : 'div';

  return (
    <Tag
      {...(isInteractive ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'group relative w-full overflow-hidden text-left',
        'rounded-card-lg border border-border bg-card shadow-card',
        // Wave 4 — premium tactile lift + premium focus glow.
        // `premium-lift` / `premium-focus` sind reduced-motion-safe (CSS-Layer).
        isInteractive && 'premium-lift premium-focus cursor-pointer focus-visible:outline-none',
        className,
      )}
      data-testid={testId}
      data-interactive={isInteractive ? 'true' : 'false'}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden">
        {image ? (
          <img
            src={image}
            alt={imageAlt}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-slow ease-out group-hover:scale-[1.03]"
            data-testid="examfit-image-card-img"
          />
        ) : (
          <div
            className={cn('h-full w-full', FALLBACK_CLASS[fallbackArea])}
            data-testid="examfit-image-card-fallback"
            aria-hidden="true"
          />
        )}
        {topRight && (
          <div className="absolute right-3 top-3 z-10 flex flex-wrap items-center gap-1.5">
            {topRight}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 p-4 sm:p-5">
        {eyebrow && (
          <span className="text-[11px] uppercase tracking-wide text-text-tertiary font-medium">
            {eyebrow}
          </span>
        )}
        <h3 className="text-base sm:text-lg font-semibold text-text-primary leading-tight">
          {title}
        </h3>
        {description && (
          <p className="text-sm text-text-secondary leading-relaxed line-clamp-2">
            {description}
          </p>
        )}
        {actionLabel && (
          <span
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary"
            data-testid="examfit-image-card-action"
          >
            {actionLabel}
            <ArrowRight className="h-4 w-4 transition-transform duration-base ease-out group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        )}
      </div>
    </Tag>
  );
}

export default ImageCard;
