import { useMemo, useState } from 'react';
import { Bot, ChevronDown, ChevronUp, Lock, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAITutor, AI_MODES, AI_ROLES, type AIRole } from '@/hooks/useAITutor';
import { useTargetLanguage } from '@/hooks/i18n/useTranslatedContent';
import { LearnerAnswerSurface } from '@/components/learner/LearnerAnswerSurface';
import type { LearnerInteractionSpec } from '@/lib/lif/learner-interaction-contract';
import { cn } from '@/lib/utils';

/**
 * AI Tutor Context Surface v1
 *
 * Kontextgebundene Lernhilfe direkt an der Lesson.
 * - Keine freien Prompts aus dem Frontend.
 * - Kontext-Payload (curriculum_id, competency_id, lesson_id, step_key, ...) Pflicht.
 * - Fail-closed wenn Mindestkontext (lesson_id + curriculum_id + competency_id) fehlt.
 * - Keine Änderung an Progress, Mastery oder Unlock-Guard.
 */

export interface LessonTutorBoxContext {
  coursePackageId?: string | null;
  curriculumId?: string | null;
  competencyId?: string | null;
  lessonId?: string | null;
  stepKey?: string | null;
  sectionKey?: string | null;
  competencyTitle?: string | null;
  competencyCode?: string | null;
}

interface LessonTutorBoxProps {
  context: LessonTutorBoxContext;
  className?: string;
}

type ActionKey =
  | 'explain_simpler'
  | 'exam_example'
  | 'exam_pitfall'
  | 'quiz_me'
  | 'why_relevant';

interface TutorAction {
  key: ActionKey;
  label: string;
  prompt: string;
  role: AIRole;
}

const ACTIONS: ReadonlyArray<TutorAction> = [
  {
    key: 'explain_simpler',
    label: 'Erklär mir das einfacher',
    prompt:
      'Erkläre mir den Inhalt dieser Lektion in einfacheren Worten. Halte dich strikt an die Lesson- und Kompetenzdaten.',
    role: AI_ROLES.EXPLAINER,
  },
  {
    key: 'exam_example',
    label: 'Zeig mir ein Prüfungsbeispiel',
    prompt:
      'Zeig mir ein konkretes Prüfungsbeispiel zu dieser Kompetenz. Nutze nur die hinterlegten Lesson-/Kompetenzdaten und keine freien Beispiele.',
    role: AI_ROLES.COACH,
  },
  {
    key: 'exam_pitfall',
    label: 'Was ist hier die Prüfungsfalle?',
    prompt:
      'Welche typische Prüfungsfalle gibt es bei diesem Lerninhalt? Bleibe strikt im Rahmen der hinterlegten Lesson-/Kompetenzdaten.',
    role: AI_ROLES.COACH,
  },
  {
    key: 'quiz_me',
    label: 'Frag mich dazu ab',
    prompt:
      'Frage mich zu genau dieser Lektion und Kompetenz ab. Stelle eine Frage nach der anderen und gib mir nach jeder Antwort kurzes Feedback.',
    role: AI_ROLES.EXAMINER,
  },
  {
    key: 'why_relevant',
    label: 'Warum ist das prüfungsrelevant?',
    prompt:
      'Warum ist dieser Inhalt prüfungsrelevant? Stütze dich auf die hinterlegten Kompetenz- und Lesson-Daten.',
    role: AI_ROLES.EXPLAINER,
  },
];

/**
 * Pure helper — exported for unit tests.
 * Liefert true, wenn der Tutor mit dem aktuellen Kontext sicher antworten darf.
 * Mindestkontext: lessonId + curriculumId + competencyId.
 */
export function hasSufficientTutorContext(ctx: LessonTutorBoxContext): boolean {
  return Boolean(ctx.lessonId && ctx.curriculumId && ctx.competencyId);
}

export default function LessonTutorBox({ context, className }: LessonTutorBoxProps) {
  const [open, setOpen] = useState(false);
  const [activeAction, setActiveAction] = useState<ActionKey | null>(null);
  const targetLang = useTargetLanguage();

  const sufficient = useMemo(() => hasSufficientTutorContext(context), [context]);

  const tutorContext = useMemo(
    () => ({
      curriculumId: context.curriculumId ?? undefined,
      competencyId: context.competencyId ?? undefined,
      lessonId: context.lessonId ?? undefined,
      lessonStep: context.stepKey ?? undefined,
      // Zusätzliche Felder im AITutorContext-Interface nicht typisiert;
      // wir senden sie als Bestandteil des bekannten Kontexts mit.
    }),
    [context],
  );

  const { messages, isLoading, sendMessage, setRole, clearMessages } = useAITutor({
    mode: AI_MODES.LEARNING,
    role: AI_ROLES.EXPLAINER,
    sessionType: 'lesson',
    context: tutorContext,
  });

  const handleAction = (action: TutorAction) => {
    if (!sufficient || isLoading) return;
    setActiveAction(action.key);
    setRole(action.role);
    const langDirective = targetLang !== 'de'
      ? `\n\n[language: respond in ${targetLang}]`
      : '';
    const tagged =
      `${action.prompt}${langDirective}\n\n[lesson_context: lesson_id=${context.lessonId} ` +
      `competency_id=${context.competencyId} step=${context.stepKey ?? '-'}` +
      (context.sectionKey ? ` section=${context.sectionKey}` : '') +
      ` ui_lang=${targetLang}]`;
    sendMessage(tagged);
  };

  // Letzte Assistant-Antwort zur kompakten Anzeige
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

  return (
    <Card
      className={cn('glass-card max-w-4xl mx-auto mb-8 border-primary/15', className)}
      data-testid="lesson-tutor-box"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-surface-raised/40 transition-colors rounded-t-lg"
            aria-expanded={open}
            aria-controls="lesson-tutor-panel"
          >
            <span className="flex items-center gap-3 min-w-0">
              <span className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Bot className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">AI-Tutor zur Lektion</span>
                <span className="block text-xs text-muted-foreground truncate">
                  {sufficient
                    ? 'Gezielte Hilfe zu diesem Lernschritt — kontextgebunden.'
                    : 'Tutor benötigt vollständigen Lesson-Kontext.'}
                </span>
              </span>
            </span>
            {open ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
            )}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent id="lesson-tutor-panel">
          <CardContent className="pt-0 pb-5 px-5 space-y-4">
            {!sufficient ? (
              <div
                className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning-bg-subtle p-4 text-sm"
                data-testid="lesson-tutor-fail-closed"
                role="status"
              >
                <Lock className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
                <p className="text-foreground">
                  Dazu habe ich in dieser Lektion noch keine geprüfte Grundlage.
                </p>
              </div>
            ) : (
              <>
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label="Tutor-Lernhilfen"
                  data-testid="lesson-tutor-actions"
                >
                  {ACTIONS.map((action) => (
                    <Button
                      key={action.key}
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isLoading}
                      onClick={() => handleAction(action)}
                      data-action={action.key}
                      className="rounded-full"
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                      {action.label}
                    </Button>
                  ))}
                  {messages.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isLoading}
                      onClick={() => {
                        clearMessages();
                        setActiveAction(null);
                      }}
                      className="rounded-full text-muted-foreground"
                    >
                      Zurücksetzen
                    </Button>
                  )}
                </div>

                <div
                  className="rounded-md border border-border bg-surface-raised p-4 min-h-[88px]"
                  data-testid="lesson-tutor-output"
                  aria-live="polite"
                  aria-busy={isLoading}
                >
                  {isLoading && !lastAssistant && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Tutor denkt nach …
                    </p>
                  )}
                  {!isLoading && !lastAssistant && (
                    <p className="text-sm text-muted-foreground">
                      Wähle eine Lernhilfe oben — der Tutor antwortet kontextgebunden auf deine Lektion.
                    </p>
                  )}
                  {lastAssistant && (
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown>{lastAssistant.content}</ReactMarkdown>
                    </div>
                  )}
                </div>

                {/* LIF.OS.1 — universal learner answer surface.
                    Sichtbar, sobald der Tutor mindestens eine Antwort/Frage gesendet hat.
                    Verhindert den „Schreib deine Antwort"-Zustand ohne Eingabefeld. */}
                {lastAssistant && (() => {
                  const lifSpec: LearnerInteractionSpec = {
                    surfaceId: `lesson_tutor.${activeAction ?? 'reply'}`,
                    expectedInput: 'text',
                    allowVoice: true,
                    answerLabel: '✍️ Deine Antwort an den Tutor',
                    placeholder: 'Schreib deine Antwort — der Tutor gibt dir präzises Feedback.',
                    minChars: 2,
                    maxChars: 2000,
                    actions: ['submit'],
                  };
                  const langDirective = targetLang !== 'de' ? `\n\n[language: respond in ${targetLang}]` : '';
                  return (
                    <LearnerAnswerSurface
                      spec={lifSpec}
                      busy={isLoading}
                      onSubmit={(payload) => {
                        if (payload.kind !== 'text') return;
                        const tagged =
                          `${payload.value.trim()}${langDirective}\n\n[lesson_context: lesson_id=${context.lessonId} ` +
                          `competency_id=${context.competencyId} step=${context.stepKey ?? '-'}` +
                          (context.sectionKey ? ` section=${context.sectionKey}` : '') +
                          ` ui_lang=${targetLang}]`;
                        sendMessage(tagged);
                      }}
                    />
                  );
                })()}

                {activeAction && (
                  <p className="text-xs text-muted-foreground">
                    Kontext: Kompetenz {context.competencyCode ?? '–'}
                    {context.competencyTitle ? ` · ${context.competencyTitle}` : ''}
                    {context.stepKey ? ` · Schritt ${context.stepKey}` : ''}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
