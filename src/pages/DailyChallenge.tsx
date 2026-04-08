import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDailyChallenge } from '@/hooks/useDailyChallenge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, Flame, CheckCircle2, XCircle, ArrowRight, Trophy, Loader2, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function DailyChallengePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const curriculumId = searchParams.get('curriculum') ?? undefined;

  const {
    phase,
    state,
    currentQuestion,
    currentIndex,
    lastFeedback,
    progress,
    loadChallenge,
    submitAnswer,
    nextQuestion,
  } = useDailyChallenge(curriculumId);

  useEffect(() => {
    if (curriculumId) loadChallenge();
  }, [curriculumId, loadChallenge]);

  if (!curriculumId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <p className="text-muted-foreground">Kein Curriculum ausgewählt.</p>
      </div>
    );
  }

  // ── Loading ──
  if (phase === 'loading' || phase === 'idle') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Completed ──
  if (phase === 'completed') {
    const pct = state.totalQuestions > 0 ? Math.round((state.correctCount / state.totalQuestions) * 100) : 0;
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background p-6 gap-6">
        <Trophy className="h-16 w-16 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Daily Challenge geschafft!</h1>
        <div className="text-center space-y-2">
          <p className="text-4xl font-bold text-primary">{state.correctCount}/{state.totalQuestions}</p>
          <p className="text-muted-foreground">richtig ({pct}%)</p>
        </div>

        {/* Streak */}
        <div className="flex items-center gap-3 bg-card rounded-xl p-4 border shadow-sm">
          <Flame className="h-8 w-8 text-orange-500" />
          <div>
            <p className="text-2xl font-bold text-foreground">{state.streak.current} Tage</p>
            <p className="text-sm text-muted-foreground">
              Streak • Rekord: {state.streak.longest} Tage
            </p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Insgesamt {state.streak.total_completed} Challenges abgeschlossen
        </p>

        <div className="flex gap-3 mt-4">
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Zurück
          </Button>
          <Button onClick={() => navigate('/shuttle' + (curriculumId ? `?curriculum=${curriculumId}` : ''))}>
            Shuttle Mode starten
          </Button>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (phase === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background p-6 gap-4">
        <XCircle className="h-12 w-12 text-destructive" />
        <p className="text-foreground">Fehler beim Laden der Challenge.</p>
        <Button onClick={loadChallenge}>Erneut versuchen</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b bg-card">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            <span className="font-semibold text-foreground">Daily Challenge</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Frage {currentIndex + 1} von {state.totalQuestions}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Flame className="h-4 w-4 text-orange-500" />
          <span className="text-sm font-bold text-foreground">{state.streak.current}</span>
        </div>
      </div>

      {/* Progress */}
      <div className="px-4 py-2">
        <Progress value={progress} className="h-2" />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        {currentQuestion && phase === 'active' && (
          <QuestionCard
            question={currentQuestion}
            onSubmit={submitAnswer}
            disabled={false}
          />
        )}

        {lastFeedback && phase === 'feedback' && currentQuestion && (
          <FeedbackCard
            question={currentQuestion}
            feedback={lastFeedback}
            onNext={nextQuestion}
            isLast={state.answers.length >= state.totalQuestions}
          />
        )}
      </div>
    </div>
  );
}

// ── Question Card ──
function QuestionCard({
  question,
  onSubmit,
  disabled,
}: {
  question: { id: string; question_text: string; options: string[]; difficulty: string };
  onSubmit: (idx: number) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    setSelected(null);
  }, [question.id]);

  const handleSelect = (idx: number) => {
    if (disabled || selected !== null) return;
    setSelected(idx);
    onSubmit(idx);
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-lg mx-auto">
      <div className="bg-card rounded-xl p-5 shadow-sm border">
        <p className="text-base font-medium text-foreground leading-relaxed">
          {question.question_text}
        </p>
        <span className={cn(
          "inline-block mt-2 text-xs px-2 py-0.5 rounded-full font-medium",
          question.difficulty === 'easy' && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
          question.difficulty === 'medium' && "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
          question.difficulty === 'hard' && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
        )}>
          {question.difficulty === 'easy' ? 'Leicht' : question.difficulty === 'medium' ? 'Mittel' : 'Schwer'}
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        {(question.options || []).map((opt, idx) => (
          <button
            key={idx}
            onClick={() => handleSelect(idx)}
            disabled={disabled || selected !== null}
            className={cn(
              "w-full text-left px-4 py-3 rounded-lg border transition-all text-sm",
              selected === idx
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card text-foreground hover:border-primary/50"
            )}
          >
            <span className="font-medium mr-2 text-muted-foreground">{String.fromCharCode(65 + idx)}.</span>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Feedback Card ──
function FeedbackCard({
  question,
  feedback,
  onNext,
  isLast,
}: {
  question: { question_text: string; options: string[] };
  feedback: { is_correct: boolean; correct_answer: number; explanation: string };
  onNext: () => void;
  isLast: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 w-full max-w-lg mx-auto">
      <div className={cn(
        "rounded-xl p-5 border shadow-sm",
        feedback.is_correct
          ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800"
          : "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
      )}>
        <div className="flex items-center gap-2 mb-3">
          {feedback.is_correct
            ? <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            : <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />}
          <span className={cn(
            "font-semibold",
            feedback.is_correct ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
          )}>
            {feedback.is_correct ? 'Richtig!' : 'Leider falsch'}
          </span>
        </div>

        {!feedback.is_correct && question.options[feedback.correct_answer] && (
          <p className="text-sm text-foreground mb-2">
            <span className="font-medium">Richtige Antwort:</span>{' '}
            {question.options[feedback.correct_answer]}
          </p>
        )}

        {feedback.explanation && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {feedback.explanation}
          </p>
        )}
      </div>

      <Button onClick={onNext} className="w-full">
        {isLast ? (
          <>
            <Trophy className="h-4 w-4 mr-2" />
            Ergebnis ansehen
          </>
        ) : (
          <>
            Nächste Frage
            <ArrowRight className="h-4 w-4 ml-2" />
          </>
        )}
      </Button>
    </div>
  );
}
