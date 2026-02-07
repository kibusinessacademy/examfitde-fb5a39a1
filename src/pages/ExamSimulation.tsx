import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  useExamSimulation, 
  useExamBlueprints, 
  useStartExamSession,
  useActiveExamSession,
  type ExamResult 
} from '@/hooks/useExamSimulation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
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
  CheckCircle2, 
  XCircle, 
  ChevronLeft, 
  ChevronRight, 
  Flag,
  Play,
  Trophy,
  Target,
  BarChart3,
  Loader2,
  AlertCircle,
  BookOpen
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Blueprint Selection Screen
function BlueprintSelector({ 
  onSelect 
}: { 
  onSelect: (blueprintId: string, mode: 'simulation' | 'practice' | 'timed_exam') => void;
}) {
  const { data: blueprints, isLoading } = useExamBlueprints();
  const [selectedMode, setSelectedMode] = useState<'simulation' | 'practice' | 'timed_exam'>('simulation');
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (!blueprints?.length) {
    return (
      <Card className="glass-card max-w-lg mx-auto">
        <CardContent className="pt-6 text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">Keine Prüfungen verfügbar</h3>
          <p className="text-muted-foreground">
            Es sind noch keine Prüfungsvorlagen freigegeben.
          </p>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center">
        <h1 className="text-2xl font-display font-bold mb-2">Prüfungssimulation</h1>
        <p className="text-muted-foreground">
          Wähle eine Prüfung und den Modus
        </p>
      </div>
      
      {/* Mode Selection */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Modus wählen</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {[
              { 
                value: 'simulation' as const, 
                label: 'Simulation', 
                desc: 'Ohne Zeitdruck, mit Feedback nach jeder Frage',
                icon: BookOpen
              },
              { 
                value: 'practice' as const, 
                label: 'Übungsmodus', 
                desc: 'Zeigt Erklärungen sofort an',
                icon: Target
              },
              { 
                value: 'timed_exam' as const, 
                label: 'Prüfungsmodus', 
                desc: 'Mit Zeitlimit wie in der echten Prüfung',
                icon: Clock
              },
            ].map(mode => (
              <button
                key={mode.value}
                onClick={() => setSelectedMode(mode.value)}
                className={cn(
                  "flex items-center gap-4 p-4 rounded-xl border text-left transition-all",
                  selectedMode === mode.value 
                    ? "border-primary bg-primary/5" 
                    : "border-border hover:border-primary/50"
                )}
              >
                <mode.icon className={cn(
                  "h-6 w-6",
                  selectedMode === mode.value ? "text-primary" : "text-muted-foreground"
                )} />
                <div>
                  <div className="font-medium">{mode.label}</div>
                  <div className="text-sm text-muted-foreground">{mode.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      
      {/* Blueprint Selection */}
      <div className="grid gap-4">
        {blueprints.map(blueprint => (
          <Card key={blueprint.id} className="glass-card hover:border-primary/50 transition-all">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle>{blueprint.title}</CardTitle>
                  {blueprint.description && (
                    <CardDescription className="mt-1">
                      {blueprint.description}
                    </CardDescription>
                  )}
                </div>
                <Badge variant="secondary">{blueprint.total_questions} Fragen</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {blueprint.time_limit_minutes} Minuten
                </div>
                <div className="flex items-center gap-1">
                  <Target className="h-4 w-4" />
                  {(blueprint.pass_threshold * 100).toFixed(0)}% zum Bestehen
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Badge variant="outline" className="text-xs">
                  {(blueprint.difficulty_distribution.easy * 100).toFixed(0)}% Leicht
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {(blueprint.difficulty_distribution.medium * 100).toFixed(0)}% Mittel
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {(blueprint.difficulty_distribution.hard * 100).toFixed(0)}% Schwer
                </Badge>
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                className="w-full" 
                onClick={() => onSelect(blueprint.id, selectedMode)}
              >
                <Play className="h-4 w-4 mr-2" />
                Prüfung starten
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Question Display Component
function QuestionCard({
  question,
  questionNumber,
  totalQuestions,
  selectedAnswer,
  onAnswer,
  showResult,
  lastAnswer,
  isSubmitting,
  mode,
}: {
  question: {
    question: {
      id: string;
      question_text: string;
      options: unknown;
      difficulty: string;
      explanation: string | null;
    };
    user_answer: number | null;
    is_correct: boolean | null;
  };
  questionNumber: number;
  totalQuestions: number;
  selectedAnswer: number | null;
  onAnswer: (answer: number) => void;
  showResult: boolean;
  lastAnswer: { is_correct: boolean; correct_answer: number; explanation: string | null } | null;
  isSubmitting: boolean;
  mode: string;
}) {
  const [localAnswer, setLocalAnswer] = useState<number | null>(selectedAnswer);
  const options = (question.question.options as string[]) || [];
  
  useEffect(() => {
    setLocalAnswer(question.user_answer);
  }, [question.user_answer]);
  
  const handleSubmit = () => {
    if (localAnswer !== null) {
      onAnswer(localAnswer);
    }
  };
  
  const difficultyConfig = {
    easy: { label: 'Leicht', color: 'text-green-500 bg-green-500/10' },
    medium: { label: 'Mittel', color: 'text-yellow-500 bg-yellow-500/10' },
    hard: { label: 'Schwer', color: 'text-red-500 bg-red-500/10' },
  };
  
  const difficulty = difficultyConfig[question.question.difficulty as keyof typeof difficultyConfig] 
    || difficultyConfig.medium;
  
  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center justify-between mb-2">
          <Badge variant="secondary">
            Frage {questionNumber} / {totalQuestions}
          </Badge>
          <Badge className={difficulty.color}>
            {difficulty.label}
          </Badge>
        </div>
        <CardTitle className="text-lg leading-relaxed">
          {question.question.question_text}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <RadioGroup 
          value={localAnswer?.toString()} 
          onValueChange={(v) => setLocalAnswer(parseInt(v))}
          disabled={showResult || question.user_answer !== null}
        >
          {options.map((option, idx) => {
            const isSelected = localAnswer === idx;
            const isCorrect = lastAnswer?.correct_answer === idx;
            const wasUserAnswer = lastAnswer && localAnswer === idx;
            
            let optionClass = "border-border";
            if (showResult || question.user_answer !== null) {
              if (isCorrect) {
                optionClass = "border-green-500 bg-green-500/10";
              } else if (wasUserAnswer && !lastAnswer?.is_correct) {
                optionClass = "border-red-500 bg-red-500/10";
              }
            } else if (isSelected) {
              optionClass = "border-primary";
            }
            
            return (
              <div 
                key={idx}
                className={cn(
                  "flex items-center space-x-3 p-4 rounded-lg border transition-all",
                  optionClass
                )}
              >
                <RadioGroupItem value={idx.toString()} id={`option-${idx}`} />
                <Label 
                  htmlFor={`option-${idx}`} 
                  className="flex-1 cursor-pointer"
                >
                  {option}
                </Label>
                {(showResult || question.user_answer !== null) && isCorrect && (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                )}
                {(showResult || question.user_answer !== null) && wasUserAnswer && !lastAnswer?.is_correct && (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
              </div>
            );
          })}
        </RadioGroup>
        
        {/* Explanation */}
        {(showResult || question.user_answer !== null) && (lastAnswer?.explanation || question.question.explanation) && (
          <div className="mt-4 p-4 rounded-lg bg-muted/50 border">
            <h4 className="font-medium mb-2">Erklärung</h4>
            <p className="text-sm text-muted-foreground">
              {lastAnswer?.explanation || question.question.explanation}
            </p>
          </div>
        )}
      </CardContent>
      
      {question.user_answer === null && !showResult && (
        <CardFooter>
          <Button 
            onClick={handleSubmit}
            disabled={localAnswer === null || isSubmitting}
            className="w-full"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Antwort bestätigen
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

// Results Screen
function ResultsScreen({ 
  result, 
  onRestart 
}: { 
  result: ExamResult; 
  onRestart: () => void;
}) {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Main Result Card */}
      <Card className={cn(
        "glass-card text-center",
        result.passed ? "border-green-500/50" : "border-red-500/50"
      )}>
        <CardContent className="pt-8 pb-6">
          <div className={cn(
            "w-20 h-20 rounded-full mx-auto flex items-center justify-center mb-4",
            result.passed ? "bg-green-500/20" : "bg-red-500/20"
          )}>
            {result.passed ? (
              <Trophy className="h-10 w-10 text-green-500" />
            ) : (
              <XCircle className="h-10 w-10 text-red-500" />
            )}
          </div>
          
          <h2 className="text-2xl font-display font-bold mb-2">
            {result.passed ? 'Bestanden!' : 'Nicht bestanden'}
          </h2>
          
          <div className="text-4xl font-bold mb-2">
            {result.score_percentage.toFixed(1)}%
          </div>
          
          <p className="text-muted-foreground">
            {result.correct_answers} von {result.total_questions} richtig
            <span className="mx-2">•</span>
            Mindestens {result.pass_threshold}% benötigt
          </p>
        </CardContent>
      </Card>
      
      {/* Breakdown by Difficulty */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Auswertung nach Schwierigkeit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Object.entries(result.breakdown.by_difficulty).map(([difficulty, stats]) => {
              const percentage = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
              const difficultyLabels: Record<string, string> = {
                easy: 'Leicht',
                medium: 'Mittel',
                hard: 'Schwer',
              };
              
              return (
                <div key={difficulty}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{difficultyLabels[difficulty] || difficulty}</span>
                    <span>{stats.correct}/{stats.total} ({percentage.toFixed(0)}%)</span>
                  </div>
                  <Progress value={percentage} className="h-2" />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      
      {/* Breakdown by Learning Field */}
      {Object.keys(result.breakdown.by_learning_field).length > 1 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Auswertung nach Lernfeld
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(result.breakdown.by_learning_field)
                .filter(([code]) => code !== 'unknown')
                .map(([code, stats]) => {
                  const percentage = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
                  
                  return (
                    <div key={code}>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Lernfeld {code}</span>
                        <span>{stats.correct}/{stats.total} ({percentage.toFixed(0)}%)</span>
                      </div>
                      <Progress value={percentage} className="h-2" />
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Actions */}
      <div className="flex gap-4">
        <Button variant="outline" className="flex-1" onClick={onRestart}>
          Neue Prüfung
        </Button>
        <Button className="flex-1" onClick={() => window.location.href = '/dashboard'}>
          Zum Dashboard
        </Button>
      </div>
    </div>
  );
}

// Main Exam Simulation Page
export default function ExamSimulation() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [examResult, setExamResult] = useState<ExamResult | null>(null);
  const [showFinishDialog, setShowFinishDialog] = useState(false);
  
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
        <BlueprintSelector onSelect={handleStartExam} />
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
