import { type ReactNode, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Info, Lightbulb } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

/**
 * EXAMFIT.CARD.SYSTEM.OS.1 — Welle C
 * <LearnLessonCard /> — verbindlicher visueller Lernkarten-Standard.
 *
 * - Mobile-first, ruhig, prüfungsnah.
 * - Header → Step/Mode → Frage → Aufgabe → Hinweis (collapsible) → Answer-Surface → Bottom-Actions.
 * - Stellt KEIN eigenes Input-System bereit. Antwortfläche kommt als `answerSurface`-Slot
 *   (in der Regel <LearnerAnswerSurface /> aus LIF.OS.1).
 * - Status-Tokens aus index.css: --status-done | --status-current | --status-recommendation
 *   | --status-error | --status-locked. Keine Hex-Werte.
 *
 * Reihenfolge der Bottom-Actions ist stabil und genormt:
 *   1) back   2) save   3) check   4) next
 * (Tests in __tests__/LearnLessonCard.test.tsx halten diese Reihenfolge aufrecht.)
 */

export type LearnLessonStatus = 'done' | 'current' | 'recommendation' | 'error' | 'locked';

export interface LearnLessonProgress {
  /** 1-basiert */
  current: number;
  total: number;
  /** wenn true: Prozent-Wert anzeigen (optional, Default false) */
  showPercent?: boolean;
  /** Maximal 8 Dots werden gerendert; danach nur Bar + "Frage X von Y". */
  showDots?: boolean;
}

export type LearnLessonActionKind = 'back' | 'save' | 'check' | 'next';

export interface LearnLessonAction {
  kind: LearnLessonActionKind;
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}

export interface LearnLessonCardProps {
  /** Titelzeile (z. B. „AI-Tutor zur Lektion", „MiniCheck", „Schritt 3"). */
  header: ReactNode;
  /** Optionaler Eyebrow (Lernschritt / Modus). */
  step?: ReactNode;
  /** Optional: visuelle Status-Marke (Done/Current/Empfehlung/Error/Locked). */
  status?: LearnLessonStatus;
  /** Prominent. Die zentrale Lernfrage. */
  question?: ReactNode;
  /** Erklärend. Aufgabenbeschreibung / Kontext. */
  task?: ReactNode;
  /** Sekundär & einklappbar. */
  hint?: ReactNode;
  /** Optional: Progress-Bar + Dots + „Frage X von Y". */
  progress?: LearnLessonProgress;
  /** Antwortfläche — i. d. R. <LearnerAnswerSurface />. */
  answerSurface?: ReactNode;
  /** Weiterer Inhalt zwischen Aufgabe und Answer-Surface (z. B. Tutor-Output). */
  children?: ReactNode;
  /** Reihenfolge wird intern stabilisiert: back · save · check · next. */
  actions?: LearnLessonAction[];
  className?: string;
  /** Testhook. */
  testId?: string;
}

const STATUS_CLASSES: Record<LearnLessonStatus, string> = {
  done: 'bg-status-done-subtle text-status-done-fg border-status-done-border',
  current: 'bg-status-current-subtle text-status-current-fg border-status-current-border',
  recommendation:
    'bg-status-recommendation-subtle text-status-recommendation-fg border-status-recommendation-border',
  error: 'bg-status-error-subtle text-status-error-fg border-status-error-border',
  locked: 'bg-status-locked-subtle text-status-locked-fg border-status-locked-border',
};

const STATUS_LABELS: Record<LearnLessonStatus, string> = {
  done: 'Erledigt',
  current: 'Aktiv',
  recommendation: 'Empfohlen',
  error: 'Korrektur',
  locked: 'Gesperrt',
};

const ACTION_ORDER: LearnLessonActionKind[] = ['back', 'save', 'check', 'next'];

const ACTION_DEFAULT_LABEL: Record<LearnLessonActionKind, string> = {
  back: 'Zurück',
  save: 'Speichern',
  check: 'Prüfen',
  next: 'Weiter',
};

const ACTION_VARIANT: Record<LearnLessonActionKind, string> = {
  back: 'bg-transparent text-text-secondary hover:bg-surface-raised border border-border',
  save: 'bg-surface-raised text-text-primary hover:bg-surface border border-border',
  check: 'bg-primary text-primary-foreground hover:bg-primary/90 border border-primary',
  next: 'bg-primary text-primary-foreground hover:bg-primary/90 border border-primary',
};

function sortActions(actions: LearnLessonAction[] = []): LearnLessonAction[] {
  // stabil: ACTION_ORDER-Reihenfolge; unbekannte Kinds hinten anhängen (defensiv)
  const known: LearnLessonAction[] = [];
  for (const kind of ACTION_ORDER) {
    const a = actions.find((x) => x.kind === kind);
    if (a) known.push(a);
  }
  const extras = actions.filter((a) => !ACTION_ORDER.includes(a.kind));
  return [...known, ...extras];
}

function ProgressRow({ progress }: { progress: LearnLessonProgress }) {
  const total = Math.max(1, progress.total);
  const current = Math.min(Math.max(1, progress.current), total);
  const pct = Math.round((current / total) * 100);
  const showDots = progress.showDots !== false && total <= 8;

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="learn-lesson-progress"
      aria-label={`Frage ${current} von ${total}`}
    >
      <div className="flex items-center justify-between text-xs text-text-secondary">
        <span>
          Frage <span className="font-semibold text-text-primary">{current}</span> von {total}
        </span>
        {progress.showPercent && (
          <span className="tabular-nums" data-testid="learn-lesson-progress-percent">
            {pct}%
          </span>
        )}
      </div>
      <div
        className="h-1.5 w-full rounded-full bg-track-subtle overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className="h-full bg-status-current transition-[width] duration-base ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      {showDots && (
        <div className="flex gap-1.5" data-testid="learn-lesson-progress-dots" aria-hidden="true">
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                i + 1 < current && 'bg-status-done',
                i + 1 === current && 'bg-status-current',
                i + 1 > current && 'bg-track-subtle',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function LearnLessonCard({
  header,
  step,
  status,
  question,
  task,
  hint,
  progress,
  answerSurface,
  children,
  actions,
  className,
  testId = 'learn-lesson-card',
}: LearnLessonCardProps) {
  const [hintOpen, setHintOpen] = useState(false);
  const orderedActions = sortActions(actions);

  return (
    <Card
      className={cn(
        'mx-auto w-full max-w-3xl border border-border bg-card shadow-sm',
        'p-4 sm:p-6 flex flex-col gap-4',
        className,
      )}
      data-testid={testId}
    >
      {/* Header zone — eyebrow + title + status */}
      <header className="flex flex-col gap-2">
        {(step || status) && (
          <div className="flex items-center justify-between gap-3">
            {step ? (
              <span
                className="text-xs uppercase tracking-wide text-text-tertiary font-medium"
                data-testid="learn-lesson-step"
              >
                {step}
              </span>
            ) : (
              <span />
            )}
            {status && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
                  STATUS_CLASSES[status],
                )}
                data-testid="learn-lesson-status"
                data-status={status}
              >
                {STATUS_LABELS[status]}
              </span>
            )}
          </div>
        )}
        <div
          className="text-base sm:text-lg font-semibold text-text-primary"
          data-testid="learn-lesson-header"
        >
          {header}
        </div>
        {progress && <ProgressRow progress={progress} />}
      </header>

      {/* Question — prominent */}
      {question && (
        <div
          className="text-xl sm:text-2xl font-semibold text-text-primary leading-snug"
          data-testid="learn-lesson-question"
        >
          {question}
        </div>
      )}

      {/* Task — explanatory */}
      {task && (
        <div
          className="text-sm sm:text-base text-text-secondary leading-relaxed"
          data-testid="learn-lesson-task"
        >
          {task}
        </div>
      )}

      {/* Children slot — z. B. Tutor-Output, Visual Block, MiniCheck-Output */}
      {children}

      {/* Hint — secondary, collapsible */}
      {hint && (
        <Collapsible open={hintOpen} onOpenChange={setHintOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface-raised/60 px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-raised transition-colors"
              data-testid="learn-lesson-hint-toggle"
              aria-expanded={hintOpen}
            >
              <span className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-status-recommendation" aria-hidden="true" />
                Hinweis anzeigen
              </span>
              {hintOpen ? (
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div
              className="mt-2 rounded-md border border-status-recommendation-border bg-status-recommendation-subtle p-3 text-sm text-status-recommendation-fg"
              data-testid="learn-lesson-hint"
            >
              <div className="flex gap-2">
                <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">{hint}</div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Answer-Surface — always reachable, mobile-first */}
      {answerSurface ? (
        <div data-testid="learn-lesson-answer-slot">{answerSurface}</div>
      ) : (
        // Info-Karte ohne Eingabefläche → einheitliche „Weiter zur Übung"-CTA,
        // damit der Lernfluss geschlossen wirkt (LIF.OS.1 · Wave-2-Polish).
        (() => {
          const nextAction = orderedActions.find((a) => a.kind === 'next');
          if (!nextAction) return null;
          return (
            <div
              className="rounded-lg border border-border bg-surface-raised/40 p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              data-testid="learn-lesson-next-cta"
            >
              <p className="text-sm text-text-secondary [text-wrap:balance]">
                Bereit für die nächste Aufgabe?
              </p>
              <button
                type="button"
                onClick={nextAction.onClick}
                disabled={nextAction.disabled || nextAction.busy}
                className={cn(
                  'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                  'min-h-11 w-full sm:w-auto whitespace-normal text-center [text-wrap:balance]',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  ACTION_VARIANT.next,
                )}
                data-testid="learn-lesson-next-cta-button"
              >
                <span>Weiter zur Übung</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })()
      )}

      {/* Bottom-Actions — stable order: back · save · check · next */}
      {orderedActions.length > 0 && (
        <div
          className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border/60"
          data-testid="learn-lesson-actions"
        >
          {orderedActions.map((a) => (
            <button
              key={a.kind}
              type="button"
              onClick={a.onClick}
              disabled={a.disabled || a.busy}
              data-action={a.kind}
              className={cn(
                'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                ACTION_VARIANT[a.kind],
                a.kind === 'back' && 'mr-auto',
              )}
            >
              {a.label ?? ACTION_DEFAULT_LABEL[a.kind]}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

export default LearnLessonCard;
