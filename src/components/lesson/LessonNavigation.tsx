import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRight, CheckCircle, Loader2, Sparkles } from 'lucide-react';
import { STEP_CONFIG, STEP_LABELS } from '@/lib/step-config';

interface Lesson {
  id: string;
  title: string;
  step: string;
}

interface LessonNavigationProps {
  prevLesson: Lesson | null;
  nextLesson: Lesson | null;
  courseId: string;
  isCompleted: boolean;
  completing: boolean;
  currentStep?: string;
  onComplete: () => void;
  onNavigate: (lesson: Lesson) => void;
}

export default function LessonNavigation({
  prevLesson,
  nextLesson,
  courseId,
  isCompleted,
  completing,
  onComplete,
  onNavigate,
}: LessonNavigationProps) {
  const nextStepLabel = nextLesson ? STEP_LABELS[nextLesson.step] || nextLesson.step : null;
  const nextStepDesc = nextLesson ? STEP_CONFIG[nextLesson.step]?.description ?? null : null;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Status row — completed badge sits next to the next-step CTA */}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {prevLesson && (
            <Button variant="outline" onClick={() => onNavigate(prevLesson)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Vorherige Lektion</span>
              <span className="sm:hidden">Zurück</span>
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {isCompleted ? (
            <Badge
              className="bg-success-bg-subtle text-success border-0 py-2 px-3"
              data-testid="lesson-completed-badge"
            >
              <CheckCircle className="h-4 w-4 mr-2" aria-hidden="true" />
              Schritt abgeschlossen
            </Badge>
          ) : (
            <Button
              onClick={onComplete}
              disabled={completing}
              variant="outline"
              data-testid="lesson-complete-btn"
            >
              {completing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              Als abgeschlossen markieren
            </Button>
          )}

          {nextLesson ? (
            <Button
              onClick={() => onNavigate(nextLesson)}
              className={isCompleted ? 'gradient-primary text-primary-foreground shadow-glow-sm gap-2' : 'gap-2'}
              variant={isCompleted ? 'default' : 'outline'}
              data-testid="lesson-next-cta"
            >
              {isCompleted && <Sparkles className="h-4 w-4" aria-hidden="true" />}
              <span className="flex flex-col items-start leading-tight text-left">
                <span className="text-[11px] opacity-80">Nächster Schritt</span>
                <span>
                  {nextStepLabel
                    ? `Weiter: ${nextStepLabel}${nextStepDesc ? ` – ${nextStepDesc}` : ''}`
                    : 'Weiter'}
                </span>
              </span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : isCompleted ? (
            <Link to={`/course/${courseId}`}>
              <Button className="gradient-accent text-accent-foreground gap-2">
                <CheckCircle className="h-4 w-4" />
                <span>Modul abschließen</span>
              </Button>
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
