import { CheckCircle2, Lock } from 'lucide-react';
import { STEP_ORDER, STEP_CONFIG } from '@/lib/step-config';

interface StepIndicatorProps {
  currentStep: string;
  /** @deprecated Title rendering moved to LessonHero. Kept for backwards-compat callers. */
  lessonTitle?: string;
  /** Optional: which steps are already completed for this lesson group. */
  completedSteps?: string[];
}

/**
 * Visible step labels with state per-step (done / current / locked).
 * Renders icons + labels; on small screens labels collapse to abbreviated form.
 */
export default function StepIndicator({ currentStep, completedSteps = [] }: StepIndicatorProps) {
  const currentIdx = STEP_ORDER.indexOf(currentStep as typeof STEP_ORDER[number]);

  return (
    <nav
      aria-label="Lernschritte"
      className="max-w-4xl mx-auto mb-6"
    >
      <ol className="flex items-stretch justify-between gap-1 md:gap-2 overflow-x-auto">
        {STEP_ORDER.map((key, idx) => {
          const config = STEP_CONFIG[key];
          const Icon = config.icon;
          const isActive = key === currentStep;
          const isPast = currentIdx > idx || completedSteps.includes(key);
          const isLocked = !isActive && !isPast;

          const stateLabel = isActive ? 'Jetzt aktiv' : isPast ? 'Abgeschlossen' : 'Gesperrt';

          return (
            <li
              key={key}
              className="flex-1 min-w-0"
              aria-current={isActive ? 'step' : undefined}
            >
              <div
                className={[
                  'flex flex-col items-center gap-1 rounded-md px-2 py-2 text-center transition-all',
                  isActive ? 'bg-primary/10 ring-1 ring-primary/40' : '',
                  isPast ? 'text-foreground' : '',
                  isLocked ? 'opacity-60' : '',
                ].join(' ')}
              >
                <div
                  className={[
                    'w-9 h-9 rounded-full flex items-center justify-center',
                    isActive ? config.bgColor : isPast ? 'bg-success-bg-subtle' : 'bg-muted',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  {isPast ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : isLocked ? (
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Icon className={`h-4 w-4 ${config.color}`} />
                  )}
                </div>
                <div className="min-w-0 w-full">
                  <div
                    className={[
                      'text-xs font-medium truncate',
                      isActive ? 'text-foreground' : 'text-muted-foreground',
                    ].join(' ')}
                  >
                    {idx + 1}. {config.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground hidden sm:block">
                    {stateLabel}
                  </div>
                </div>
                <span className="sr-only">
                  Schritt {idx + 1}: {config.label} – {stateLabel}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** @deprecated Import STEP_CONFIG from '@/lib/step-config' instead */
export { STEP_CONFIG as stepConfig } from '@/lib/step-config';
