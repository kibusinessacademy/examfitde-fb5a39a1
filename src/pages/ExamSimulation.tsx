import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { recordLearningEvent, snapshotExamReadiness } from '@/lib/learning-telemetry';
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
  ChevronLeft, 
  ChevronRight, 
  Flag,
  Loader2,
  Bookmark,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Import refactored components
import { BlueprintSelector } from '@/components/exam/BlueprintSelector';
import { QuestionCard } from '@/components/exam/QuestionCard';
import { ResultsScreen } from '@/components/exam/ResultsScreen';
import { SimulationGateGuard } from '@/components/exam/SimulationGateGuard';
import { ExamTimer } from '@/components/exam/ExamTimer';
import { ConfidenceSlider } from '@/components/exam/ConfidenceSlider';
import { PassProbabilityBadge } from '@/components/exam/PassProbabilityBadge';
import { TutorPanel } from '@/components/tutor/TutorPanel';
import PageExplainer from '@/components/admin/PageExplainer';
import { AI_MODES, type AIMode } from '@/hooks/useAITutor';

// Map exam mode to AI tutor mode
function getAIMode(examMode: string): AIMode {
  switch (examMode) {
    case 'timed_exam':
      return AI_MODES.EXAM;
    case 'practice':
    case 'adaptive':
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
  const [confidence, setConfidence] = useState(50);
  const [markedQuestions, setMarkedQuestions] = useState<Set<number>>(new Set());
  
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
  const handleStartExam = async (blueprintId: string, mode: 'simulation' | 'practice' | 'timed_exam' | 'adaptive') => {
    const newSessionId = await startExam.mutateAsync({ blueprintId, mode });
    navigate(`/exam-simulation/${newSessionId}`);
  };
  
  // Handle finish – also trigger weakness loop
  const handleFinishExam = async () => {
    const result = await handleFinish();
    if (result) {
      setExamResult(result);
      // Create weakness assignments from exam results
      if (currentSessionId) {
        await supabase.rpc('create_weakness_assignments_from_exam', {
          p_session_id: currentSessionId,
        });
      }

      // ── Telemetry: record exam completion + trigger readiness recalc ──
      const curriculumId = session?.curriculum_id;
      const scorePercentage = typeof result === 'object' && result !== null
        ? (result as any).score_percentage ?? (result as any).score ?? null
        : null;
      recordLearningEvent({
        event_type: 'exam_sim_completed',
        curriculum_id: curriculumId ?? undefined,
        score: scorePercentage ?? undefined,
        payload: {
          exam_session_id: currentSessionId,
          passed: typeof result === 'object' ? (result as any).passed : undefined,
        },
      });
      if (curriculumId) {
        snapshotExamReadiness(curriculumId);
      }
    }
    setShowFinishDialog(false);
  };
  
  // No session - show blueprint selector with gate guard
  if (!currentSessionId) {
    // Get curriculum from first blueprint if available
    const firstCurriculumId = blueprints?.[0]?.curriculum_id;
    
    return (
      <div className="container max-w-4xl py-8">
        {firstCurriculumId ? (
          <SimulationGateGuard curriculumId={firstCurriculumId}>
            <BlueprintSelector 
              blueprints={blueprints as any} 
              isLoading={blueprintsLoading}
              onSelect={handleStartExam} 
            />
          </SimulationGateGuard>
        ) : (
          <BlueprintSelector 
            blueprints={blueprints as any} 
            isLoading={blueprintsLoading}
            onSelect={handleStartExam} 
          />
        )}
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
            sessionId={currentSessionId}
            curriculumId={session?.curriculum_id}
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
      <PageExplainer
        title="Wie funktioniert die Prüfungssimulation?"
        description="Die Simulation bildet eine echte IHK-Prüfung nach. Du beantwortest Fragen unter Zeitdruck und erhältst am Ende eine detaillierte Auswertung mit Fehleranalyse und Schwächenplan."
        workflow={[
          { label: 'Blueprint wählen' },
          { label: 'Fragen beantworten', active: true },
          { label: 'Auswertung' },
          { label: 'Schwächenplan' },
        ]}
        actions={[
          'Fragennavigator oben → Springe zu einer bestimmten Frage',
          '"Prüfung beenden" → Beendet die Simulation und zeigt die Ergebnisse',
          'KI-Tutor rechts unten → Im Übungsmodus hilft der Tutor, im Prüfungsmodus ist er gesperrt',
        ]}
        tips={[
          'Grüne Felder = richtig, rote = falsch – beantworte möglichst alle Fragen',
          'Nach der Prüfung werden automatisch Schwächen-Lektionen zugewiesen',
          'Im Timed-Exam-Modus läuft die Zeit – wie in der echten Prüfung',
        ]}
      />

      {/* Progress Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{session?.mode}</Badge>
            {session?.time_limit_minutes && session?.started_at && (
              <ExamTimer
                timeLimitMinutes={session.time_limit_minutes}
                startedAt={session.started_at}
                onTimeUp={() => setShowFinishDialog(true)}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <PassProbabilityBadge curriculumId={session?.curriculum_id} />
            <span className="text-sm text-muted-foreground">
              {answeredCount} / {totalQuestions}
            </span>
          </div>
        </div>
        <Progress value={(answeredCount / totalQuestions) * 100} className="h-2" />
      </div>
      
      {/* Question Navigator */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-2">
        {questions?.map((q, idx) => {
          const isAnswered = q.user_answer !== null;
          const isCurrentQuestion = idx === currentIndex;
          const isMarked = markedQuestions.has(idx);
          let bgClass = "bg-muted hover:bg-muted/80";
          
          if (isAnswered) {
            bgClass = q.is_correct 
              ? "bg-primary/20 text-primary" 
              : "bg-destructive/20 text-destructive";
          }
          
          return (
            <button
              key={q.id}
              onClick={() => goToQuestion(idx)}
              className={cn(
                "w-8 h-8 rounded-lg text-xs font-medium transition-all flex-shrink-0 relative",
                isCurrentQuestion && "ring-2 ring-primary",
                bgClass
              )}
            >
              {idx + 1}
              {isMarked && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-yellow-500" />
              )}
            </button>
          );
        })}
      </div>
      
      {/* Question */}
      {currentQuestion && (
        <>
          <QuestionCard
            question={currentQuestion}
            questionNumber={currentIndex + 1}
            totalQuestions={totalQuestions}
            selectedAnswer={currentQuestion.user_answer}
            onAnswer={(answer) => handleAnswer(answer, undefined, confidence)}
            showResult={showResult}
            lastAnswer={lastAnswer}
            isSubmitting={isSubmitting}
            mode={session?.mode || 'simulation'}
          />
          
          {/* Confidence Slider - before answering */}
          {currentQuestion.user_answer === null && !showResult && (
            <div className="mt-4">
              <ConfidenceSlider value={confidence} onChange={setConfidence} />
            </div>
          )}
        </>
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

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setMarkedQuestions(prev => {
                const next = new Set(prev);
                if (next.has(currentIndex)) next.delete(currentIndex);
                else next.add(currentIndex);
                return next;
              });
            }}
            title="Frage markieren"
          >
            <Bookmark className={cn("h-4 w-4", markedQuestions.has(currentIndex) && "fill-yellow-500 text-yellow-500")} />
          </Button>
          <Button
            variant="destructive"
            onClick={() => setShowFinishDialog(true)}
          >
            <Flag className="h-4 w-4 mr-1" />
            Beenden
          </Button>
        </div>
        
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
