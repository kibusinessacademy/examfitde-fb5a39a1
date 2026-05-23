import { useMemo, useState } from 'react';
import { Bot, Loader2, Lock, Sparkles, AlertTriangle, BookOpen, Target, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAITutor, AI_MODES, AI_ROLES, type AIRole } from '@/hooks/useAITutor';
import { cn } from '@/lib/utils';

/**
 * MiniCheck Tutor Feedback v1
 *
 * Prüfungsnaher Tutor-Coach nach abgeschlossenem MiniCheck.
 * - Keine freien Prompts: 4 fixe Actions, alle kontextgebunden.
 * - Fail-closed wenn Mindestkontext (lessonId + curriculumId + competencyId) fehlt.
 * - Tutor erhält strukturierten [minicheck_context: …] Tag mit Score, Kompetenz und falsch
 *   beantworteten Frage-IDs — keine fertigen Antworten, keine Spoiler.
 * - Kein Touch an Unlock-/Progress-Guard.
 */

export interface MiniCheckWrongItem {
  questionId: string;
  questionText: string;
  selectedText: string;
  correctText: string;
  explanation?: string | null;
}

export interface MiniCheckTutorContext {
  curriculumId?: string | null;
  competencyId?: string | null;
  lessonId?: string | null;
  stepKey?: string | null;
  competencyCode?: string | null;
  competencyTitle?: string | null;
}

export interface MiniCheckTutorResult {
  passed: boolean;
  scorePercent: number;
  correct: number;
  total: number;
  wrongItems: MiniCheckWrongItem[];
}

interface MiniCheckTutorFeedbackProps {
  context: MiniCheckTutorContext;
  result: MiniCheckTutorResult;
  className?: string;
}

type ActionKey = 'explain_errors' | 'competency_context' | 'exam_pitfall' | 'what_to_repeat';

interface FeedbackAction {
  key: ActionKey;
  label: string;
  icon: typeof Bot;
  prompt: string;
  role: AIRole;
  /** Wenn true, nur sinnvoll bei vorhandenen Fehlern. */
  requiresWrong?: boolean;
}

const ACTIONS: ReadonlyArray<FeedbackAction> = [
  {
    key: 'explain_errors',
    label: 'Erkläre meine Fehler',
    icon: AlertTriangle,
    role: AI_ROLES.FEEDBACK,
    prompt:
      'Erkläre mir auf Basis der hinterlegten Lesson- und Kompetenzdaten, warum meine falsch beantworteten Mini-Check-Fragen falsch waren. Gehe pro Frage knapp auf den Denkfehler ein und nenne die richtige Begründung. Keine erfundenen Fakten.',
    requiresWrong: true,
  },
  {
    key: 'competency_context',
    label: 'Welche Kompetenz ist betroffen?',
    icon: Target,
    role: AI_ROLES.EXPLAINER,
    prompt:
      'Welche Kompetenz wird in diesem Mini-Check geprüft und was bedeutet das für meine Prüfungsvorbereitung? Stütze dich strikt auf die hinterlegte Kompetenz-Definition und Lesson-Inhalte.',
  },
  {
    key: 'exam_pitfall',
    label: 'Was ist die Prüfungsfalle?',
    icon: BookOpen,
    role: AI_ROLES.COACH,
    prompt:
      'Welche typische Prüfungsfalle steckt hinter den Fragen, die ich falsch beantwortet habe? Nutze nur hinterlegte Lesson-/Kompetenzdaten — keine generischen Tipps.',
    requiresWrong: true,
  },
  {
    key: 'what_to_repeat',
    label: 'Was sollte ich wiederholen?',
    icon: RotateCcw,
    role: AI_ROLES.COACH,
    prompt:
      'Welche Abschnitte aus dieser Lektion sollte ich gezielt wiederholen, basierend auf meinem Mini-Check-Ergebnis und der betroffenen Kompetenz? Beziehe dich nur auf die Lesson-Sections und Kompetenzen, die hier hinterlegt sind.',
  },
];

/**
 * Pure helper — exported for unit tests.
 * True wenn der Tutor sicher prüfungsnahes Feedback geben darf.
 */
export function hasSufficientFeedbackContext(ctx: MiniCheckTutorContext): boolean {
  return Boolean(ctx.lessonId && ctx.curriculumId && ctx.competencyId);
}

/**
 * Pure helper — exported for unit tests.
 * Baut den maschinenlesbaren Kontext-Tag, der dem Tutor mitgegeben wird.
 * Sendet nur IDs + Score-Metriken, keine Frage-/Antworttexte (Anti-Spoiler).
 */
export function buildMiniCheckContextTag(
  ctx: MiniCheckTutorContext,
  result: MiniCheckTutorResult,
): string {
  const wrongIds = result.wrongItems.map((w) => w.questionId).filter(Boolean).join(',');
  const verdict = result.passed ? 'passed' : result.scorePercent > 0 ? 'partial' : 'failed';
  return (
    `[minicheck_context: lesson_id=${ctx.lessonId} ` +
    `competency_id=${ctx.competencyId} ` +
    `step=${ctx.stepKey ?? '-'} ` +
    `score_percent=${result.scorePercent} ` +
    `correct=${result.correct}/${result.total} ` +
    `verdict=${verdict}` +
    (wrongIds ? ` wrong_qids=${wrongIds}` : '') +
    `]`
  );
}

export default function MiniCheckTutorFeedback({
  context,
  result,
  className,
}: MiniCheckTutorFeedbackProps) {
  const [activeAction, setActiveAction] = useState<ActionKey | null>(null);

  const sufficient = useMemo(() => hasSufficientFeedbackContext(context), [context]);
  const hasWrong = result.wrongItems.length > 0;

  const tutorContext = useMemo(
    () => ({
      curriculumId: context.curriculumId ?? undefined,
      competencyId: context.competencyId ?? undefined,
      lessonId: context.lessonId ?? undefined,
      lessonStep: context.stepKey ?? undefined,
      miniCheckScore: result.scorePercent,
    }),
    [context, result.scorePercent],
  );

  const { messages, isLoading, sendMessage, setRole } = useAITutor({
    mode: AI_MODES.LEARNING,
    role: AI_ROLES.FEEDBACK,
    sessionType: 'lesson',
    context: tutorContext,
  });

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

  const handleAction = (action: FeedbackAction) => {
    if (!sufficient || isLoading) return;
    if (action.requiresWrong && !hasWrong) return;
    setActiveAction(action.key);
    setRole(action.role);
    const tag = buildMiniCheckContextTag(context, result);
    sendMessage(`${action.prompt}\n\n${tag}`);
  };

  const verdictLabel = result.passed
    ? 'Bestanden'
    : result.scorePercent > 0
      ? 'Teilweise korrekt'
      : 'Noch nicht bestanden';

  if (!sufficient) {
    return (
      <Card
        className={cn('glass-card border-warning/30', className)}
        data-testid="minicheck-tutor-feedback"
      >
        <CardContent className="p-5">
          <div
            className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning-bg-subtle p-4 text-sm"
            data-testid="minicheck-tutor-fail-closed"
            role="status"
          >
            <Lock className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
            <p className="text-foreground">
              Dazu habe ich in dieser Lektion noch keine geprüfte Grundlage.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn('glass-card border-primary/15', className)}
      data-testid="minicheck-tutor-feedback"
    >
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Bot className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Tutor-Feedback zu deinem Mini-Check
            </p>
            <p className="text-xs text-muted-foreground">
              {verdictLabel} · {result.correct}/{result.total} richtig · Kompetenz{' '}
              {context.competencyCode ?? '–'}
              {context.competencyTitle ? ` · ${context.competencyTitle}` : ''}
            </p>
          </div>
        </div>

        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Tutor-Feedback Aktionen"
          data-testid="minicheck-tutor-actions"
        >
          {ACTIONS.map((action) => {
            const disabled = isLoading || (action.requiresWrong && !hasWrong);
            const Icon = action.icon;
            return (
              <Button
                key={action.key}
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => handleAction(action)}
                data-action={action.key}
                data-disabled-reason={
                  action.requiresWrong && !hasWrong ? 'no_wrong_answers' : undefined
                }
                className="rounded-full"
              >
                <Icon className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                {action.label}
              </Button>
            );
          })}
        </div>

        <div
          className="rounded-md border border-border bg-surface-raised p-4 min-h-[88px]"
          data-testid="minicheck-tutor-output"
          aria-live="polite"
          aria-busy={isLoading}
        >
          {isLoading && !lastAssistant && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Tutor analysiert deine Antworten …
            </p>
          )}
          {!isLoading && !lastAssistant && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {hasWrong
                ? 'Wähle eine Aktion — der Tutor erklärt deine Fehler im Lesson-Kontext.'
                : 'Alles richtig. Der Tutor kann dir die geprüfte Kompetenz und Wiederholungspunkte vertiefen.'}
            </p>
          )}
          {lastAssistant && (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown>{lastAssistant.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {activeAction && (
          <p className="text-xs text-muted-foreground">
            Kontext: Schritt {context.stepKey ?? '–'} · Score {result.scorePercent}%
          </p>
        )}
      </CardContent>
    </Card>
  );
}
