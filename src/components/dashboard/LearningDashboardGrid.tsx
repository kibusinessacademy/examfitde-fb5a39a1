import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Target,
  Sparkles,
  Mic,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import {
  HeroSurface,
  ImageCard,
  FloatingChip,
  ProgressMeter,
} from '@/components/examfit-ds';

/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — Learning Dashboard Grid (Wave 3)
 *
 * Sechs große DS2.0-Cards für die zentralen Lernflächen:
 *   1. Lernkurs · 2. Prüfung · 3. KI-Tutor · 4. Mündliche Prüfung
 *   5. Fortschritt (ProgressMeter Ring) · 6. Schwächen (Top-Gaps Liste)
 *
 * Read-only Presentation-Layer. Keine neuen Queries — bekommt aggregierte
 * Werte als Props vom Eltern-Dashboard.
 */

export interface LearningDashboardGridProps {
  /** 0..100 — Gesamtfortschritt. */
  overallProgress?: number;
  /** Kurze Schwächen-Liste (Top-Gaps), max. 4. */
  topWeaknesses?: string[];
  /** Optionales Restdauer-Label "≈ 12 Min." für Lernkurs-Card. */
  resumeTimeLabel?: string;
  /** Override-Routes (default auf konsolidierte /app/* SSOT). */
  routes?: Partial<{
    learn: string;
    exam: string;
    tutor: string;
    oral: string;
  }>;
}

const DEFAULT_ROUTES = {
  learn: '/app/lernpfad',
  exam: '/app/exam-trainer',
  tutor: '/app/tutor',
  oral: '/app/oral',
};

export function LearningDashboardGrid({
  overallProgress = 0,
  topWeaknesses = [],
  resumeTimeLabel,
  routes,
}: LearningDashboardGridProps) {
  const navigate = useNavigate();
  const r = { ...DEFAULT_ROUTES, ...(routes ?? {}) };

  return (
    <section
      aria-label="Lern-Hub"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      data-testid="learning-dashboard-grid"
    >
      <ImageCard
        title="Lernkurs"
        eyebrow="Weiterlernen"
        description="Adaptiver Lernpfad — geh genau dort weiter, wo du aufgehört hast."
        fallbackArea="learn"
        actionLabel="Lernpfad öffnen"
        onClick={() => navigate(r.learn)}
        topRight={
          resumeTimeLabel ? (
            <FloatingChip variant="time">{resumeTimeLabel}</FloatingChip>
          ) : (
            <FloatingChip variant="course" icon={<BookOpen className="h-3 w-3" />}>
              Kurs
            </FloatingChip>
          )
        }
      />

      <ImageCard
        title="Prüfung"
        eyebrow="Simulation"
        description="Prüfungsnahe Simulation mit Zeitlimit — wie am Prüfungstag."
        fallbackArea="exam"
        actionLabel="Prüfung starten"
        onClick={() => navigate(r.exam)}
        topRight={
          <FloatingChip variant="exam" icon={<Target className="h-3 w-3" />}>
            Prüfung
          </FloatingChip>
        }
      />

      <ImageCard
        title="KI-Tutor"
        eyebrow="Erklärungen mit Quellen"
        description="Frag deinen Tutor — Antworten ausschließlich aus deinem Curriculum."
        fallbackArea="tutor"
        actionLabel="Tutor öffnen"
        onClick={() => navigate(r.tutor)}
        topRight={
          <FloatingChip variant="tutor" icon={<Sparkles className="h-3 w-3" />}>
            Tutor
          </FloatingChip>
        }
      />

      <ImageCard
        title="Mündliche Prüfung"
        eyebrow="Voice-Trainer"
        description="Trainiere das Fachgespräch mit Mikrofon oder per Texteingabe."
        fallbackArea="oral"
        actionLabel="Mündlich üben"
        onClick={() => navigate(r.oral)}
        topRight={
          <FloatingChip variant="oral" icon={<Mic className="h-3 w-3" />}>
            Oral
          </FloatingChip>
        }
      />

      {/* Fortschritts-Karte (eigene Hero-Komposition, kein Bild). */}
      <HeroSurface
        area="learn"
        radius="card-lg"
        className="min-h-[220px]"
        testId="dashboard-progress-card"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-text-tertiary font-medium">
              Fortschritt
            </p>
            <h3 className="text-base sm:text-lg font-semibold text-text-primary leading-tight">
              Dein Lernstand
            </h3>
            <p className="text-sm text-text-secondary mt-1">
              Gesamt-Readiness über alle Kompetenzen.
            </p>
          </div>
          <FloatingChip variant="course" icon={<TrendingUp className="h-3 w-3" />}>
            Live
          </FloatingChip>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <ProgressMeter
            shape="ring"
            current={Math.round(overallProgress)}
            total={100}
            showPercent
            label={`Gesamtfortschritt ${Math.round(overallProgress)} Prozent`}
          />
          <div className="flex-1">
            <ProgressMeter
              shape="bar"
              current={Math.round(overallProgress)}
              total={100}
              label="Gesamtfortschritt"
            />
          </div>
        </div>
      </HeroSurface>

      {/* Schwächen-Karte */}
      <HeroSurface
        area="oral"
        radius="card-lg"
        className="min-h-[220px]"
        testId="dashboard-weaknesses-card"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-text-tertiary font-medium">
              Schwächen
            </p>
            <h3 className="text-base sm:text-lg font-semibold text-text-primary leading-tight">
              Top-Lücken
            </h3>
            <p className="text-sm text-text-secondary mt-1">
              Hier ist der Hebel am größten — jetzt gezielt schließen.
            </p>
          </div>
          <FloatingChip
            variant="oral"
            icon={<AlertTriangle className="h-3 w-3" />}
          >
            Fokus
          </FloatingChip>
        </div>
        <ul
          className="mt-4 space-y-1.5"
          data-testid="dashboard-weaknesses-list"
        >
          {topWeaknesses.length === 0 ? (
            <li className="text-sm text-text-secondary italic">
              Noch keine Lücken erkannt — starte deinen ersten MiniCheck.
            </li>
          ) : (
            topWeaknesses.slice(0, 4).map((w, i) => (
              <li
                key={i}
                className="text-sm text-text-primary flex items-start gap-2"
              >
                <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-status-recommendation shrink-0" />
                <span className="truncate">{w}</span>
              </li>
            ))
          )}
        </ul>
      </HeroSurface>
    </section>
  );
}

export default LearningDashboardGrid;
