import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useShuttleMode, ShuttleQuestion, ShuttleFeedback, ShuttleStats } from '@/hooks/useShuttleMode';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, Zap, CheckCircle2, XCircle, ArrowRight, Trophy, Loader2, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Question Card ──
function QuestionCard({
  question,
  onSubmit,
  disabled,
}: {
  question: ShuttleQuestion;
  onSubmit: (idx: number) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  const handleSelect = (idx: number) => {
    if (disabled) return;
    setSelected(idx);
    onSubmit(idx);
  };

  // Reset selection when question changes
  useEffect(() => {
    setSelected(null);
  }, [question.id]);

  return (
    <div className="flex flex-col gap-4 w-full max-w-lg mx-auto px-4">
      <div className="bg-card rounded-xl p-5 shadow-sm border">
        <p className="text-base font-medium text-foreground leading-relaxed">
          {question.question_text}
        </p>
        {question.difficulty && (
          <span className={cn(
            "inline-block mt-2 text-xs px-2 py-0.5 rounded-full font-medium",
            question.difficulty === 'easy' && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
            question.difficulty === 'medium' && "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
            question.difficulty === 'hard' && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
          )}>
            {question.difficulty === 'easy' ? 'Leicht' : question.difficulty === 'medium' ? 'Mittel' : 'Schwer'}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {question.options.map((option, idx) => (
          <button
            key={idx}
            onClick={() => handleSelect(idx)}
            disabled={disabled}
            className={cn(
              "w-full text-left p-4 rounded-lg border transition-all",
              "hover:border-primary/50 hover:bg-primary/5",
              "active:scale-[0.98]",
              selected === idx
                ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                : "border-border bg-card",
              disabled && "opacity-60 cursor-not-allowed"
            )}
          >
            <span className="text-sm text-foreground">{typeof option === 'string' ? option : (option as any)?.text || JSON.stringify(option)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Feedback Card ──
function FeedbackCard({
  feedback,
  question,
  onNext,
  onExplain,
}: {
  feedback: ShuttleFeedback;
  question: ShuttleQuestion;
  onNext: () => void;
  onExplain?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 w-full max-w-lg mx-auto px-4">
      <div className={cn(
        "rounded-xl p-5 border-2 flex items-start gap-3",
        feedback.is_correct
          ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800"
          : "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
      )}>
        {feedback.is_correct ? (
          <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
        ) : (
          <XCircle className="h-6 w-6 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        )}
        <div>
          <p className={cn(
            "font-semibold text-base",
            feedback.is_correct ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"
          )}>
            {feedback.is_correct ? 'Richtig!' : 'Leider falsch'}
          </p>
          {!feedback.is_correct && feedback.correct_option_text && (
            <p className="text-sm text-muted-foreground mt-1">
              Richtige Antwort: <span className="font-medium text-foreground">{feedback.correct_option_text}</span>
            </p>
          )}
        </div>
      </div>

      {feedback.explanation && (
        <div className="bg-card rounded-xl p-4 border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Erklärung</p>
          <p className="text-sm text-foreground leading-relaxed">{feedback.explanation}</p>
        </div>
      )}

      {!feedback.is_correct && feedback.trap_tags && feedback.trap_tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {feedback.trap_tags.map((tag, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 font-medium">
              ⚠ {tag}
            </span>
          ))}
        </div>
      )}

      {/* Phase 3: Explain My Mistake — AI-powered inline feedback */}
      {!feedback.is_correct && !feedback.ai_explanation && onExplain && (
        <Button
          onClick={onExplain}
          variant="outline"
          className="w-full border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/20"
          disabled={feedback.ai_explanation_loading}
        >
          {feedback.ai_explanation_loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              KI erklärt...
            </>
          ) : (
            <>
              <Lightbulb className="mr-2 h-4 w-4" />
              Fehler erklären lassen
            </>
          )}
        </Button>
      )}

      {feedback.ai_explanation && (
        <div className="bg-amber-50 dark:bg-amber-900/10 rounded-xl p-4 border border-amber-200 dark:border-amber-800">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">KI-Erklärung</p>
          </div>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{feedback.ai_explanation}</p>
        </div>
      )}

      <Button onClick={onNext} className="w-full" size="lg">
        Nächste Frage <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}

// ── Summary Card ──
function SummaryCard({ stats, onRestart, onExit }: { stats: ShuttleStats; onRestart: () => void; onExit: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto px-4 text-center">
      <Trophy className="h-16 w-16 text-primary" />
      <div>
        <h2 className="text-2xl font-bold text-foreground">Shuttle beendet!</h2>
        <p className="text-muted-foreground mt-1">Gut gemacht 💪</p>
      </div>

      <div className="grid grid-cols-3 gap-4 w-full">
        <div className="bg-card rounded-xl p-3 border text-center">
          <p className="text-2xl font-bold text-foreground">{stats.questions_answered}</p>
          <p className="text-xs text-muted-foreground">Fragen</p>
        </div>
        <div className="bg-card rounded-xl p-3 border text-center">
          <p className="text-2xl font-bold text-green-600">{stats.correct_count}</p>
          <p className="text-xs text-muted-foreground">Richtig</p>
        </div>
        <div className="bg-card rounded-xl p-3 border text-center">
          <p className="text-2xl font-bold text-primary">{stats.accuracy}%</p>
          <p className="text-xs text-muted-foreground">Quote</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 w-full">
        <Button onClick={onRestart} className="w-full" size="lg">
          <Zap className="mr-2 h-4 w-4" /> Nochmal
        </Button>
        <Button onClick={onExit} variant="outline" className="w-full">
          Zurück zum Dashboard
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ──
export default function ShuttleModePage() {
  const [searchParams] = useSearchParams();
  const curriculumId = searchParams.get('curriculum') || undefined;
  const navigate = useNavigate();
  const [lastSelectedAnswer, setLastSelectedAnswer] = useState<number | null>(null);

  const {
    phase,
    currentQuestion,
    feedback,
    stats,
    startSession,
    submitAnswer,
    nextQuestion,
    endSession,
    explainMistake,
    reset,
  } = useShuttleMode(curriculumId);

  // Auto-start on mount if curriculum is set
  useEffect(() => {
    if (curriculumId && phase === 'idle') {
      startSession();
    }
  }, [curriculumId, phase, startSession]);

  const handleSubmit = (idx: number) => {
    setLastSelectedAnswer(idx);
    submitAnswer(idx);
  };

  const handleExplain = () => {
    if (currentQuestion && lastSelectedAnswer !== null) {
      explainMistake(currentQuestion.id, lastSelectedAnswer);
    }
  };

  const handleExit = () => {
    navigate('/dashboard');
  };

  const handleRestart = () => {
    reset();
    setLastSelectedAnswer(null);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Minimal Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <button onClick={() => { endSession(); handleExit(); }} className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Shuttle</span>
        </div>
        <div className="text-sm text-muted-foreground tabular-nums">
          {stats.questions_answered > 0 && (
            <span>{stats.correct_count}/{stats.questions_answered} richtig</span>
          )}
        </div>
      </header>

      {/* Progress Bar */}
      {phase !== 'idle' && phase !== 'ended' && stats.questions_answered > 0 && (
        <Progress value={stats.accuracy} className="h-1 rounded-none" />
      )}

      {/* Content */}
      <main className="flex-1 flex items-center justify-center py-8">
        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Laden...</p>
          </div>
        )}

        {phase === 'question' && currentQuestion && (
          <QuestionCard
            question={currentQuestion}
            onSubmit={handleSubmit}
            disabled={false}
          />
        )}

        {phase === 'feedback' && feedback && currentQuestion && (
          <FeedbackCard
            feedback={feedback}
            question={currentQuestion}
            onNext={nextQuestion}
            onExplain={handleExplain}
          />
        )}

        {phase === 'ended' && (
          <SummaryCard
            stats={stats}
            onRestart={handleRestart}
            onExit={handleExit}
          />
        )}

        {phase === 'error' && (
          <div className="text-center px-4">
            <p className="text-muted-foreground">Keine Fragen verfügbar.</p>
            <Button onClick={handleExit} variant="outline" className="mt-4">
              Zurück
            </Button>
          </div>
        )}

        {phase === 'idle' && !curriculumId && (
          <div className="text-center px-4">
            <Zap className="h-12 w-12 text-primary mx-auto mb-4" />
            <h2 className="text-xl font-bold text-foreground mb-2">Shuttle Mode</h2>
            <p className="text-muted-foreground mb-4">Wähle einen Kurs, um zu starten.</p>
            <Button onClick={handleExit} variant="outline">
              Zum Dashboard
            </Button>
          </div>
        )}
      </main>

      {/* Footer with end button during active session */}
      {(phase === 'question' || phase === 'feedback') && (
        <footer className="px-4 py-3 border-t bg-card/50 backdrop-blur-sm">
          <Button
            onClick={endSession}
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
          >
            Session beenden ({stats.questions_answered} Fragen)
          </Button>
        </footer>
      )}
    </div>
  );
}
