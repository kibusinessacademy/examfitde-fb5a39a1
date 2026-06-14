/**
 * JourneyStepper — KIMI.3.1 Orientation Aid
 * ------------------------------------------------------------------
 * Leichtgewichtiger horizontaler Stepper, der dem Lerner zeigt,
 * wo er innerhalb der Haupt-Journey steht. Reine Präsentation —
 * kein State, keine Navigation. Wird auf Übergangs-Seiten platziert,
 * die laut KIMI.3 ORIENTATION_LOSS-Findings haben.
 */
import { Check } from 'lucide-react';

export interface JourneyStep {
  /** Kurzlabel, z. B. "Beruf". */
  label: string;
  /** Optionaler Statushinweis, z. B. Berufsname nach Auswahl. */
  hint?: string;
}

interface Props {
  steps: JourneyStep[];
  /** 0-basierter Index des aktuellen Schritts. */
  currentIndex: number;
  className?: string;
  testId?: string;
}

export function JourneyStepper({ steps, currentIndex, className = '', testId = 'journey-stepper' }: Props) {
  const total = steps.length;
  const current = Math.min(Math.max(currentIndex, 0), total - 1);
  return (
    <nav
      aria-label="Lern-Journey-Fortschritt"
      data-testid={testId}
      className={`w-full ${className}`}
    >
      <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        Schritt {current + 1} von {total}
        {steps[current]?.hint ? <span className="ml-2 normal-case tracking-normal text-foreground/80">· {steps[current].hint}</span> : null}
      </div>
      <ol className="flex w-full items-center gap-1.5">
        {steps.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={step.label} className="flex flex-1 items-center gap-1.5 min-w-0">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition ${
                  done
                    ? 'border-primary bg-primary text-primary-foreground'
                    : active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-muted/40 text-muted-foreground'
                }`}
                aria-current={active ? 'step' : undefined}
              >
                {done ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
              </span>
              <span
                className={`truncate text-[11px] sm:text-xs ${
                  active ? 'font-medium text-foreground' : done ? 'text-foreground/70' : 'text-muted-foreground'
                }`}
              >
                {step.label}
              </span>
              {i < total - 1 && (
                <span
                  aria-hidden
                  className={`mx-0.5 hidden h-px flex-1 sm:block ${done ? 'bg-primary/60' : 'bg-border'}`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** SSOT für die ExamFit-Haupt-Journey. Reihenfolge entspricht KIMI.3 J1. */
export const MAIN_LEARNER_JOURNEY: JourneyStep[] = [
  { label: 'Beruf' },
  { label: 'Konto' },
  { label: 'Lernpfad' },
  { label: 'Tutor' },
  { label: 'MiniCheck' },
  { label: 'Prüfung' },
];

/** Verkürzte Variante für Lern-Loop ab Lernpfad (in-app). */
export const IN_APP_LEARNING_LOOP: JourneyStep[] = [
  { label: 'Lernpfad' },
  { label: 'Tutor' },
  { label: 'MiniCheck' },
  { label: 'Prüfung' },
];
