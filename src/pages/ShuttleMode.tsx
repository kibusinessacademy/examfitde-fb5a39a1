import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useShuttleMode, ShuttleMode as ShuttleModeType } from '@/hooks/useShuttleMode';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Loader2, Zap } from 'lucide-react';
import { ShuttleHeader } from '@/components/shuttle/ShuttleHeader';
import { ShuttleEntryCard } from '@/components/shuttle/ShuttleEntryCard';
import { ShuttleQuestionCard } from '@/components/shuttle/ShuttleQuestionCard';
import { ShuttleFeedbackCard } from '@/components/shuttle/ShuttleFeedbackCard';
import { ShuttleSessionSummary } from '@/components/shuttle/ShuttleSessionSummary';

export default function ShuttleModePage() {
  const [searchParams] = useSearchParams();
  const curriculumId = searchParams.get('curriculum') || undefined;
  const navigate = useNavigate();
  const [lastSelectedAnswer, setLastSelectedAnswer] = useState<number | null>(null);
  const [showEntry, setShowEntry] = useState(true);

  const {
    phase, mode, setMode,
    currentQuestion, feedback, stats,
    dashboardSummary,
    startSession, submitAnswer, nextQuestion,
    endSession, explainMistake, fetchDashboard, reset,
  } = useShuttleMode(curriculumId);

  // Fetch dashboard summary on mount
  useEffect(() => {
    if (curriculumId) {
      fetchDashboard();
    }
  }, [curriculumId, fetchDashboard]);

  const handleStart = useCallback((selectedMode: ShuttleModeType) => {
    setShowEntry(false);
    startSession(selectedMode);
  }, [startSession]);

  // Auto-start if mode specified in URL
  useEffect(() => {
    const urlMode = searchParams.get('mode') as ShuttleModeType | null;
    const autoStart = searchParams.get('autostart');
    if (curriculumId && autoStart === 'true' && urlMode) {
      handleStart(urlMode);
    }
  }, []);

  const handleSubmit = (idx: number) => {
    setLastSelectedAnswer(idx);
    submitAnswer(idx);
  };

  const handleExplain = () => {
    if (currentQuestion && lastSelectedAnswer !== null) {
      explainMistake(currentQuestion.id, lastSelectedAnswer);
    }
  };

  const handleExit = () => navigate('/dashboard');

  const handleRestart = () => {
    reset();
    setLastSelectedAnswer(null);
    setShowEntry(true);
    fetchDashboard();
  };

  // No curriculum fallback
  if (!curriculumId) {
    return (
      <div
        data-density="comfortable"
        className="min-h-screen bg-background flex items-center justify-center"
      >
        <div className="text-center px-4 max-w-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-mint-100 dark:bg-mint-900/40 shadow-elev-1">
            <Zap className="h-8 w-8 text-petrol-600 dark:text-mint-300" />
          </div>
          <h2 className="text-xl font-bold text-text-primary mb-2 font-display">Shuttle Mode</h2>
          <p className="text-text-secondary mb-4">Wähle einen Kurs, um zu starten.</p>
          <Button onClick={handleExit} variant="outline">
            Zum Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-density="comfortable" className="min-h-screen bg-background flex flex-col">
      {/* Header (only during active session) */}
      {!showEntry && phase !== 'idle' && phase !== 'ended' && (
        <>
          <ShuttleHeader stats={stats} onEnd={endSession} onBack={handleExit} />
          {stats.questions_answered > 0 && (
            <Progress
              value={stats.accuracy}
              className="h-1 rounded-none [&>div]:bg-mint-500 transition-all duration-base ease-out-expo"
            />
          )}
        </>
      )}

      {/* Content */}
      <main className="flex-1 flex items-center justify-center py-8">
        {/* Entry Screen */}
        {showEntry && phase === 'idle' && (
          <ShuttleEntryCard
            mode={mode}
            onModeChange={setMode}
            onStart={handleStart}
            summary={dashboardSummary}
          />
        )}

        {/* Loading */}
        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-3 animate-fade-in">
            <Loader2 className="h-8 w-8 animate-spin text-petrol-600 dark:text-mint-400" />
            <p className="text-sm text-text-secondary">Laden...</p>
          </div>
        )}

        {/* Question */}
        {phase === 'question' && currentQuestion && (
          <ShuttleQuestionCard
            question={currentQuestion}
            onSubmit={handleSubmit}
            disabled={false}
          />
        )}

        {/* Feedback */}
        {phase === 'feedback' && feedback && currentQuestion && (
          <ShuttleFeedbackCard
            feedback={feedback}
            question={currentQuestion}
            onNext={nextQuestion}
            onExplain={handleExplain}
          />
        )}

        {/* Session Complete */}
        {phase === 'ended' && (
          <ShuttleSessionSummary
            stats={stats}
            mode={mode}
            onRestart={handleRestart}
            onExit={handleExit}
          />
        )}

        {/* Error */}
        {phase === 'error' && (
          <div className="text-center px-4 max-w-sm animate-fade-in">
            <p className="text-text-secondary mb-4">Keine Fragen verfügbar.</p>
            <div className="flex flex-col gap-2">
              <Button onClick={handleRestart} variant="outline">
                Erneut versuchen
              </Button>
              <Button onClick={handleExit} variant="ghost">
                Zurück
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Footer with end button during active session */}
      {!showEntry && (phase === 'question' || phase === 'feedback') && (
        <footer className="px-4 py-3 border-t border-border-subtle bg-surface/80 backdrop-blur-md">
          <Button
            onClick={endSession}
            variant="ghost"
            size="sm"
            className="w-full text-text-tertiary hover:text-text-primary"
          >
            Session beenden ({stats.questions_answered} Fragen · +{stats.xp_earned} XP)
          </Button>
        </footer>
      )}
    </div>
  );
}
