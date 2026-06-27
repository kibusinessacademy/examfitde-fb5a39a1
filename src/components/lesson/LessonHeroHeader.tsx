import { Link } from 'react-router-dom';
import { ArrowLeft, Home, Clock, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HeroSurface, ProgressMeter, FloatingChip } from '@/components/examfit-ds';
import { STEP_CONFIG, STEP_ORDER, type StepKey } from '@/lib/step-config';

/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — Lesson HeroSurface Header (Wave 2)
 *
 * Ruhiger DS2.0-Header mit:
 *  - HeroSurface (area="learn"), optionalem Hintergrundbild + Gradient-Fallback
 *  - Step/Modus-Chip aus STEP_CONFIG (z. B. "Schritt 3/7 · Anwenden")
 *  - Kompetenz-Titel + Modul-Untertitel
 *  - ProgressMeter (Lektion X von Y)
 *  - optionalem Time-Chip
 *
 * Nutzt nur bestehende examfit-ds Primitives. Keine neue Bildpipeline:
 * Caller liefert eine fertige URL (z. B. `course.thumbnail_url` oder Wert aus
 * der bestehenden `useBerufImages`-Pipeline). Bild ist immer optional —
 * Fallback ist die HeroSurface-Gradientfläche. Layout-Shift wird durch eine
 * fest reservierte Bildhöhe verhindert.
 */

interface LessonHeroHeaderProps {
  courseId: string;
  courseTitle: string;
  moduleTitle: string;
  /** Kompetenz-Titel (SSOT label). Optional — fällt auf Kurs-Titel zurück. */
  competencyTitle?: string | null;
  competencyCode?: string | null;
  /** Aktueller Step (einstieg | verstehen | …). Rendert Modus-Chip wenn gesetzt. */
  stepKey?: string | null;
  /** Optionales Hintergrundbild. Bei Fehlen zeigen wir nur den Gradient. */
  imageUrl?: string | null;
  /** 0..100 */
  progress: number;
  currentIndex: number;
  totalLessons: number;
  estimatedTimeLabel?: string;
}

export default function LessonHeroHeader({
  courseId,
  courseTitle,
  moduleTitle,
  competencyTitle,
  competencyCode,
  stepKey,
  imageUrl,
  progress,
  currentIndex,
  totalLessons,
  estimatedTimeLabel,
}: LessonHeroHeaderProps) {
  const safeTotal = Math.max(1, totalLessons);
  const safeCurrent = Math.min(Math.max(0, currentIndex + 1), safeTotal);
  void progress;

  const stepIdx = stepKey ? STEP_ORDER.indexOf(stepKey as StepKey) : -1;
  const stepConfig = stepKey ? STEP_CONFIG[stepKey] : undefined;
  const stepLabel = stepConfig?.label;
  const hasImage = Boolean(imageUrl);

  return (
    <header
      role="banner"
      aria-label="Lektions-Navigation"
      className="sticky top-0 z-50 border-b border-border bg-background/80"
      data-testid="lesson-hero-header"
    >
      <div className="container mx-auto px-3 sm:px-4 py-3">
        <HeroSurface area="learn" radius="card-lg" className="border-border/40 overflow-hidden">
          {/* Reserved image strip — always renders to prevent layout shift.
              Gradient-only when no image is provided. */}
          <div
            className="relative -mx-5 -mt-5 sm:-mx-8 sm:-mt-8 mb-3 h-20 sm:h-24 w-[calc(100%+2.5rem)] sm:w-[calc(100%+4rem)] bg-gradient-learn"
            data-testid="lesson-hero-image-slot"
            data-has-image={hasImage ? 'true' : 'false'}
            aria-hidden="true"
          >
            {hasImage && (
              <img
                src={imageUrl!}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover opacity-70"
                onError={(e) => {
                  // Fallback to gradient-only on broken URL — no layout shift.
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-card/85 via-card/30 to-transparent" />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11 bg-card/60 hover:bg-card"
              >
                <Link
                  to={`/course/${courseId}`}
                  aria-label={`Zurück zum Kurs: ${courseTitle}`}
                >
                  <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                </Link>
              </Button>
              <div className="min-w-0">
                <p
                  className="text-[11px] uppercase tracking-wide text-text-tertiary truncate"
                  aria-label="Kompetenz"
                >
                  {competencyCode ? `${competencyCode} · ` : ''}
                  {competencyTitle ?? courseTitle}
                </p>
                <h1
                  className="text-sm sm:text-base font-semibold text-text-primary truncate leading-tight"
                  aria-label="Aktuelles Modul"
                >
                  {moduleTitle}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {stepLabel && stepIdx >= 0 && (
                <FloatingChip
                  variant="course"
                  icon={<Layers className="h-3 w-3" />}
                  className="inline-flex"
                  testId="lesson-hero-step-chip"
                >
                  <span>Schritt {stepIdx + 1}/{STEP_ORDER.length} · {stepLabel}</span>
                </FloatingChip>
              )}
              {estimatedTimeLabel && (
                <FloatingChip
                  variant="time"
                  icon={<Clock className="h-3 w-3" />}
                  className="hidden sm:inline-flex"
                  testId="lesson-hero-time-chip"
                >
                  {estimatedTimeLabel}
                </FloatingChip>
              )}
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11 bg-card/60 hover:bg-card"
              >
                <Link to="/dashboard" aria-label="Zur Startseite">
                  <Home className="h-5 w-5" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-3">
            <ProgressMeter
              shape="bar"
              current={safeCurrent}
              total={safeTotal}
              showPercent
              label={`Lektion ${safeCurrent} von ${safeTotal}`}
              testId="lesson-hero-progress"
            />
          </div>
        </HeroSurface>
      </div>
    </header>
  );
}
