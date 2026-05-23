import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, GraduationCap, Target } from 'lucide-react';
import { STEP_CONFIG, STEP_ORDER } from '@/lib/step-config';

interface LessonHeroProps {
  /** Raw lesson title, e.g. "LF06-K01: Grundlagen von …" */
  rawTitle: string;
  /** Raw lesson content JSONB (may be null/string/object). */
  content: unknown;
  /** Competency code, e.g. "LF06-K01" */
  competencyCode: string | null;
  /** Competency title (preferred fallback for H1) */
  competencyTitle: string | null;
  /** Course/curriculum title for breadcrumb meta */
  courseTitle: string;
  /** Current step key */
  step: string;
  /** Lesson sort_order within module (1-based for display) */
  lessonNumber: number;
  totalLessons: number;
  /** exam_relevance_score 0..100 */
  examRelevanceScore: number | null;
  /** Whether this lesson is already completed for the current user */
  isCompleted: boolean;
}

/**
 * SSOT-respecting reformulation of the lesson header.
 * - Reads ONLY from existing lesson/competency data (no hardcoded copy).
 * - Replaces curriculum-coded title with a clean H1.
 * - Surfaces objectives + exam relevance from lesson.content.
 */
export default function LessonHero({
  rawTitle,
  content,
  competencyCode,
  competencyTitle,
  courseTitle,
  step,
  lessonNumber,
  totalLessons,
  examRelevanceScore,
  isCompleted,
}: LessonHeroProps) {
  const stepInfo = STEP_CONFIG[step] || STEP_CONFIG.einstieg;
  const StepIcon = stepInfo.icon;

  // Derive learner-facing H1: strip "LFxx-Kyy:" prefix → fall back to competency title → fall back to raw title.
  const cleanedFromTitle = rawTitle.replace(/^\s*LF\d+\s*[-·.]?\s*K?\d*\s*:\s*/i, '').trim();
  const h1 = cleanedFromTitle || competencyTitle || rawTitle;

  // Code line: "LF06 · Kompetenz K01" derived from competency.code "LF06-K01"
  let codeLine: string | null = null;
  if (competencyCode) {
    const m = competencyCode.match(/^(LF\d+)[-·.]?(K\d+)?/i);
    if (m) {
      const lf = m[1].toUpperCase();
      const k = m[2] ? `Kompetenz ${m[2].toUpperCase()}` : null;
      codeLine = [lf, k].filter(Boolean).join(' · ');
    } else {
      codeLine = competencyCode;
    }
  }

  // Step number among canonical step order — purely visual.
  const stepIdx = STEP_ORDER.indexOf(step as typeof STEP_ORDER[number]);
  const stepNumber = stepIdx >= 0 ? stepIdx + 1 : null;
  const stepTotal = STEP_ORDER.length;

  // Pull learner-facing extras from content JSONB if available (non-fatal if absent).
  const c = (content && typeof content === 'object' ? (content as Record<string, unknown>) : {}) as Record<string, unknown>;
  const objectives = Array.isArray(c.objectives)
    ? (c.objectives as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim().length > 0).slice(0, 4)
    : [];
  const examTriggers = Array.isArray(c.exam_triggers)
    ? (c.exam_triggers as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim().length > 0).slice(0, 3)
    : [];

  const relevanceLabel =
    examRelevanceScore == null
      ? null
      : examRelevanceScore >= 70
        ? 'Hoch'
        : examRelevanceScore >= 40
          ? 'Mittel'
          : 'Niedrig';

  return (
    <header className="max-w-4xl mx-auto mb-6">
      {/* Meta line — internal codes demoted to context */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground mb-3">
        <span className="truncate">{courseTitle}</span>
        {codeLine && (
          <>
            <span aria-hidden="true">·</span>
            <span className="truncate">{codeLine}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span>
          Lektion {lessonNumber} von {totalLessons}
        </span>
        {stepNumber && (
          <>
            <span aria-hidden="true">·</span>
            <span>
              Schritt {stepNumber} von {stepTotal}
            </span>
          </>
        )}
      </div>

      {/* Step badge + completed inline */}
      <div className="flex items-center gap-2 mb-3">
        <Badge className={`${stepInfo.bgColor} ${stepInfo.color} border-0`}>
          <StepIcon className="h-4 w-4 mr-1" aria-hidden="true" />
          {stepInfo.label}
        </Badge>
        {isCompleted && (
          <Badge className="bg-success-bg-subtle text-success border-0" data-testid="lesson-hero-completed">
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
            Abgeschlossen
          </Badge>
        )}
      </div>

      {/* Learner-facing H1 */}
      <h1 className="text-2xl md:text-3xl font-display font-bold leading-tight" data-testid="lesson-hero-h1">
        {h1}
      </h1>
      <p className="text-muted-foreground mt-2">{stepInfo.description}</p>

      {/* Lernziele — only when content provides them */}
      {objectives.length > 0 && (
        <Card className="mt-5 border-border/60" data-testid="lesson-hero-objectives">
          <CardContent className="p-4 md:p-5">
            <div className="flex items-center gap-2 text-sm font-medium mb-3">
              <Target className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>Was du in diesem Schritt lernst</span>
            </div>
            <ul className="space-y-2">
              {objectives.map((o, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Prüfungsrelevanz — only when score or triggers available */}
      {(relevanceLabel || examTriggers.length > 0) && (
        <Card className="mt-3 border-border/60" data-testid="lesson-hero-exam-relevance">
          <CardContent className="p-4 md:p-5">
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              <GraduationCap className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>Prüfungsrelevanz{relevanceLabel ? `: ${relevanceLabel}` : ''}</span>
            </div>
            {examTriggers.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Typische Prüfungsthemen: {examTriggers.join(' · ')}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </header>
  );
}
