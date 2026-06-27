import { useCallback, useState, type ReactNode } from 'react';
import { Star, Clock } from 'lucide-react';
import { ImageCard, FloatingChip } from '@/components/examfit-ds';

/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — CompetenceImageCard (Wave 3)
 *
 * Wiederverwendbare Kompetenz-Karte mit ImageCard-Layout für die drei
 * Lernmodi: Kurs · Prüfung · Tutor. FloatingChips für Favorit und Restdauer
 * sitzen oben rechts (topRight-Slot).
 *
 * Hart-Regel: kein Hex, keine LIF-Antwortlogik. Reines Presentation-Layer.
 */

export type CompetenceMode = 'course' | 'exam' | 'tutor';

const MODE_ACTION_LABEL: Record<CompetenceMode, string> = {
  course: 'Kurs öffnen',
  exam: 'Prüfung starten',
  tutor: 'Mit Tutor üben',
};

const MODE_FALLBACK: Record<CompetenceMode, 'learn' | 'exam' | 'tutor'> = {
  course: 'learn',
  exam: 'exam',
  tutor: 'tutor',
};

const MODE_EYEBROW: Record<CompetenceMode, string> = {
  course: 'Lernkurs',
  exam: 'Prüfungs-Topic',
  tutor: 'Tutor-Thema',
};

export interface CompetenceImageCardProps {
  mode: CompetenceMode;
  title: ReactNode;
  description?: ReactNode;
  image?: string | null;
  imageAlt?: string;
  /** Geschätzte Dauer-Label, z. B. "20 Min." — versteckt wenn leer. */
  estimatedTimeLabel?: string;
  /** Initial-Favorit-Status. Default = false. Lokaler Toggle. */
  initialFavorite?: boolean;
  onToggleFavorite?: (next: boolean) => void;
  onClick?: () => void;
  className?: string;
  testId?: string;
}

export function CompetenceImageCard({
  mode,
  title,
  description,
  image,
  imageAlt,
  estimatedTimeLabel,
  initialFavorite = false,
  onToggleFavorite,
  onClick,
  className,
  testId = 'competence-image-card',
}: CompetenceImageCardProps) {
  const [fav, setFav] = useState(initialFavorite);

  const handleFavClick = useCallback(
    (e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
      e.stopPropagation();
      e.preventDefault();
      const next = !fav;
      setFav(next);
      onToggleFavorite?.(next);
    },
    [fav, onToggleFavorite],
  );

  return (
    <ImageCard
      title={title}
      eyebrow={MODE_EYEBROW[mode]}
      description={description}
      image={image ?? undefined}
      imageAlt={imageAlt ?? ''}
      fallbackArea={MODE_FALLBACK[mode]}
      actionLabel={MODE_ACTION_LABEL[mode]}
      onClick={onClick}
      className={className}
      testId={testId}
      topRight={
        <>
          {/* Span+role=button vermeidet ungültiges Button-in-Button-Nesting,
              wenn die äußere ImageCard interaktiv (onClick) gerendert wird. */}
          <span
            role="button"
            tabIndex={0}
            onClick={handleFavClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                const next = !fav;
                setFav(next);
                onToggleFavorite?.(next);
              }
            }}
            aria-label={fav ? 'Favorit entfernen' : 'Als Favorit markieren'}
            aria-pressed={fav}
            className="inline-flex cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
            data-testid="competence-fav-toggle"
          >
            <FloatingChip
              variant="fav"
              icon={<Star className={`h-3 w-3 ${fav ? 'fill-current' : ''}`} />}
            >
              {fav ? 'Favorit' : 'Merken'}
            </FloatingChip>
          </span>
          {estimatedTimeLabel && (
            <FloatingChip
              variant="time"
              icon={<Clock className="h-3 w-3" />}
              testId="competence-time-chip"
            >
              {estimatedTimeLabel}
            </FloatingChip>
          )}
        </>
      }
    />
  );
}

export default CompetenceImageCard;
