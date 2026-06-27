import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles, Target } from 'lucide-react';
import { HeroSurface, FloatingChip, ProgressMeter } from '@/components/examfit-ds';
import { Button } from '@/components/ui/button';

/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — Wave 3 · <DashboardHero />
 *
 * Personalisierter Above-the-Fold-Header für /dashboard.
 * Reines Presentation-Layer — bekommt aggregierte Werte als Props.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  Willkommen zurück, {name}                   │
 *   │  Nächstes Lernziel · {label}    [Weiter →]   │
 *   │                                              │
 *   │  Prüfungsreife  ◯ {pct}%                     │
 *   └──────────────────────────────────────────────┘
 */

export interface DashboardHeroProps {
  /** Anzeige-Name. Fällt zurück auf „Lernende:r". */
  name?: string | null;
  /** Aktueller Beruf/Curriculum. */
  contextLabel?: string | null;
  /** Titel der nächsten Lektion / des nächsten Schritts. */
  nextGoalLabel?: string | null;
  /** Deep-Link auf den nächsten Schritt. */
  nextGoalHref?: string | null;
  /** 0..100 — Gesamt-Prüfungsreife. */
  readinessPct?: number;
  testId?: string;
}

export function DashboardHero({
  name,
  contextLabel,
  nextGoalLabel,
  nextGoalHref,
  readinessPct = 0,
  testId = 'dashboard-hero',
}: DashboardHeroProps) {
  const displayName = (name && name.trim()) || 'Lernende:r';
  const pct = Math.max(0, Math.min(100, Math.round(readinessPct)));
  const hasNext = Boolean(nextGoalLabel && nextGoalHref);

  return (
    <HeroSurface area="learn" radius="card-xl" testId={testId}>
      <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
        {/* Linke Spalte — Begrüßung + nächstes Lernziel */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <FloatingChip variant="ki" icon={<Sparkles className="h-3 w-3" />}>
              ExamFit
            </FloatingChip>
            {contextLabel && (
              <FloatingChip variant="kurs">{contextLabel}</FloatingChip>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl md:text-4xl font-display font-semibold leading-tight text-text-primary">
            Willkommen zurück, {displayName}
          </h1>

          {hasNext ? (
            <p className="text-sm sm:text-base text-text-secondary">
              <span className="font-medium text-text-primary">Dein nächstes Lernziel:</span>{' '}
              <span data-testid="dashboard-hero-next-goal">{nextGoalLabel}</span>
            </p>
          ) : (
            <p className="text-sm sm:text-base text-text-secondary">
              Wähle deinen Beruf — danach werden Lernpfad, Tutor und Prüfungssimulation aktiv.
            </p>
          )}

          <div className="pt-1">
            {hasNext ? (
              <Button
                asChild
                size="lg"
                className="min-h-11 w-full sm:w-auto"
                data-testid="dashboard-hero-cta"
              >
                <Link to={nextGoalHref!} data-cta-location="dashboard_hero_continue">
                  Weiterlernen
                  <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            ) : (
              <Button
                asChild
                size="lg"
                className="min-h-11 w-full sm:w-auto"
                data-testid="dashboard-hero-cta"
              >
                <Link to="/berufe" data-cta-location="dashboard_hero_choose_beruf">
                  Beruf wählen
                  <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Rechte Spalte — Prüfungsreife */}
        <div
          className="flex items-center gap-4 rounded-card border border-border/40 bg-card/60 p-4 md:flex-col md:items-start md:justify-center md:gap-3 md:min-w-[180px]"
          data-testid="dashboard-hero-readiness"
        >
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
            <span className="text-[11px] uppercase tracking-wide text-text-tertiary font-medium">
              Prüfungsreife
            </span>
          </div>
          <ProgressMeter
            shape="ring"
            current={pct}
            total={100}
            showPercent
            label={`Prüfungsreife ${pct} Prozent`}
          />
        </div>
      </div>
    </HeroSurface>
  );
}

export default DashboardHero;
