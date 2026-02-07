import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  useExamSimulation, 
  useExamBlueprints, 
  useStartExamSession,
  useActiveExamSession,
  type ExamResult 
} from '@/hooks/useExamSimulation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { 
  Clock, 
  ChevronLeft, 
  ChevronRight, 
  Flag,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Import refactored components
import { BlueprintSelector } from '@/components/exam/BlueprintSelector';
import { QuestionCard } from '@/components/exam/QuestionCard';
import { ResultsScreen } from '@/components/exam/ResultsScreen';
import { TutorPanel } from '@/components/tutor/TutorPanel';
import { AI_MODES, type AIMode } from '@/hooks/useAITutor';

// Map exam mode to AI tutor mode
function getAIMode(examMode: string): AIMode {
  switch (examMode) {
    case 'timed_exam':
      return AI_MODES.EXAM;
    case 'practice':
      return AI_MODES.PRACTICE;
    case 'simulation':
    default:
      return AI_MODES.LEARNING;
  }
}

export default function ExamSimulation() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  
  const [examResult, setExamResult] = useState<ExamResult | null>(null);
  const [showFinishDialog, setShowFinishDialog] = useState(false);
  
  const { data: blueprints, isLoading: blueprintsLoading } = useExamBlueprints();
  const { data: activeSession } = useActiveExamSession();
  const startExam = useStartExamSession();
  
  const currentSessionId = sessionId || activeSession?.id;
  
  const {
    session,
    questions,
    currentQuestion,
    currentIndex,
    totalQuestions,
    answeredCount,
    isComplete,
    showResult,
    lastAnswer,
    isLoading,
    isSubmitting,
    isFinishing,
    handleAnswer,
    handleNext,
    handlePrevious,
    handleFinish,
    goToQuestion,
  } = useExamSimulation(currentSessionId);
  
  // Redirect to active session if exists
  useEffect(() => {
    if (activeSession && !sessionId) {
      navigate(`/exam-simulation/${activeSession.id}`, { replace: true });
    }
  }, [activeSession, sessionId, navigate]);
  
  // Handle start exam
  const handleStartExam = async (blueprintId: string, mode: 'simulation' | 'practice' | 'timed_exam') => {
    const newSessionId = await startExam.mutateAsync({ blueprintId, mode });
    navigate(`/exam-simulation/${newSessionId}`);
  };
  
  // Handle finish
  const handleFinishExam = async () => {
    const result = await handleFinish();
    if (result) {
      setExamResult(result);
    }
    setShowFinishDialog(false);
  };
  
  // No session - show blueprint selector
  if (!currentSessionId) {
    return (
      <div className="container max-w-4xl py-8">
        <BlueprintSelector 
          blueprints={blueprints as any} 
          isLoading={blueprintsLoading}
          onSelect={handleStartExam} 
        />
      </div>
    );
  }
  
  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  // Show results if exam is finished
  if (isComplete || examResult) {
    const result = examResult || (session && {
      total_questions: session.total_questions,
      correct_answers: answeredCount,
      score_percentage: session.score_percentage || 0,
      passed: session.passed || false,
      pass_threshold: 50,
      breakdown: { by_difficulty: {}, by_learning_field: {} },
    });
    
    if (result) {
      return (
        <div className="container max-w-4xl py-8">
          <ResultsScreen 
            result={result as ExamResult} 
            onRestart={() => {
              setExamResult(null);
              navigate('/exam-simulation');
            }} 
          />
        </div>
      );
    }
  }

  // Get AI tutor mode based on exam mode
  const aiMode = getAIMode(session?.mode || 'simulation');
  
  // Active exam
  return (
    <div className="container max-w-4xl py-8">
      {/* Progress Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{session?.mode}</Badge>
            {session?.time_limit_minutes && (
              <Badge variant="secondary" className="gap-1">
                <Clock className="h-3 w-3" />
                {session.time_limit_minutes} Min
              </Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            {answeredCount} / {totalQuestions} beantwortet
          </div>
        </div>
        <Progress value={(answeredCount / totalQuestions) * 100} className="h-2" />
      </div>
      
      {/* Question Navigator */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-2">
        {questions?.map((q, idx) => (
          <button
            key={q.id}
            onClick={() => goToQuestion(idx)}
            className={cn(
              "w-8 h-8 rounded-lg text-xs font-medium transition-all flex-shrink-0",
              idx === currentIndex && "ring-2 ring-primary",
              q.user_answer !== null
                ? q.is_correct
                  ? "bg-green-500/20 text-green-600"
                  : "bg-red-500/20 text-red-600"
                : "bg-muted hover:bg-muted/80"
            )}
          >
            {idx + 1}
          </button>
        ))}
      </div>
      
      {/* Question */}
      {currentQuestion && (
        <QuestionCard
          question={currentQuestion}
          questionNumber={currentIndex + 1}
          totalQuestions={totalQuestions}
          selectedAnswer={currentQuestion.user_answer}
          onAnswer={handleAnswer}
          showResult={showResult}
          lastAnswer={lastAnswer}
          isSubmitting={isSubmitting}
          mode={session?.mode || 'simulation'}
        />
      )}
      
      {/* Navigation */}
      <div className="flex items-center justify-between mt-6">
        <Button
          variant="outline"
          onClick={handlePrevious}
          disabled={currentIndex === 0}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Zurück
        </Button>
        
        <Button
          variant="destructive"
          onClick={() => setShowFinishDialog(true)}
        >
          <Flag className="h-4 w-4 mr-1" />
          Prüfung beenden
        </Button>
        
        <Button
          onClick={handleNext}
          disabled={currentIndex >= totalQuestions - 1}
        >
          Weiter
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
      
      {/* AI Tutor Panel - Mode-aware */}
      <TutorPanel 
        mode={aiMode}
        sessionId={currentSessionId}
        sessionType="exam"
      />
      
      {/* Finish Confirmation Dialog */}
      <AlertDialog open={showFinishDialog} onOpenChange={setShowFinishDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Prüfung beenden?</AlertDialogTitle>
            <AlertDialogDescription>
              Du hast {answeredCount} von {totalQuestions} Fragen beantwortet.
              {answeredCount < totalQuestions && (
                <span className="block mt-2 text-destructive">
                  Achtung: {totalQuestions - answeredCount} Fragen sind noch unbeantwortet!
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zurück zur Prüfung</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinishExam} disabled={isFinishing}>
              {isFinishing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Prüfung abschließen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
