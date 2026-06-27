import { Link } from 'react-router-dom';
import { ArrowLeft, Home, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HeroSurface, ProgressMeter, FloatingChip } from '@/components/examfit-ds';

/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — Lesson HeroSurface Header (Wave 2)
 *
 * Ersetzt den alten `LessonHeader` durch eine DS2.0-Heldenfläche mit:
 *  - HeroSurface (area="learn") als ruhiger Verlaufs-Header
 *  - ProgressMeter (bar, showPercent) plus „Lektion X von Y"
 *  - Optional FloatingChip "time" für Restdauer
 *  - Back/Home-Buttons mit Touch-Target ≥ 44px
 *
 * Keine Curriculum-/Progress-Logik im Header — alles wird per Props übergeben.
 */

interface LessonHeroHeaderProps {
  courseId: string;
  courseTitle: string;
  moduleTitle: string;
  /** 0..100 */
  progress: number;
  currentIndex: number;
  totalLessons: number;
  /** Optionaler Restdauer-Chip, z. B. "≈ 8 Min." */
  estimatedTimeLabel?: string;
}

export default function LessonHeroHeader({
  courseId,
  courseTitle,
  moduleTitle,
  progress,
  currentIndex,
  totalLessons,
  estimatedTimeLabel,
}: LessonHeroHeaderProps) {
  const safeTotal = Math.max(1, totalLessons);
  const safeCurrent = Math.min(Math.max(0, currentIndex + 1), safeTotal);

  return (
    <header
      role="banner"
      aria-label="Lektions-Navigation"
      className="sticky top-0 z-50 border-b border-border bg-background/80"
      data-testid="lesson-hero-header"
    >
      <div className="container mx-auto px-3 sm:px-4 py-3">
        <HeroSurface area="learn" radius="card-lg" className="border-border/40">
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
                  aria-label="Kurs"
                >
                  {courseTitle}
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
