import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useProductAccessByCurriculum } from '@/hooks/useProductAccess';
import { Paywall } from '@/components/shop/Paywall';
import { supabase } from '@/integrations/supabase/client';
import {
  Brain, CheckCircle, XCircle, Loader2, Trophy, Flame,
  RotateCcw, Sparkles, ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import TrainerStartPage from '@/components/exam/TrainerStartPage';
import type { TrainerStartPayload } from '@/types/trainer';

interface Question {
  id: string;
  question_text: string;
  options: string[];
  difficulty: 'easy' | 'medium' | 'hard';
}

interface AnswerResult {
  is_correct: boolean;
  correct_answer: number;
  explanation: string;
}

interface SessionStats {
  correct: number;
  incorrect: number;
  streak: number;
  maxStreak: number;
}

type TrainerStep = 'select' | 'loading' | 'question' | 'feedback' | 'results';

export default function ExamTrainer() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Selection state — pre-select from query param if provided
  const [selectedCurriculumId, setSelectedCurriculumId] = useState(() => searchParams.get('curriculum') || '');
  const [selectedBerufName, setSelectedBerufName] = useState('');

  // Product-based access check (bridges to legacy flags during transition)
  const { data: hasAccess, isLoading: entitlementLoading } = useProductAccessByCurriculum(
    selectedCurriculumId || undefined,
    'exam_trainer'
  );

  // Session state
  const [step, setStep] = useState<TrainerStep>('select');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [stats, setStats] = useState<SessionStats>({ correct: 0, incorrect: 0, streak: 0, maxStreak: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [adaptiveDifficulty, setAdaptiveDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');

  // Adaptive difficulty adjustment
  useEffect(() => {
    if (stats.streak >= 3 && adaptiveDifficulty !== 'hard') {
      const newDiff = adaptiveDifficulty === 'easy' ? 'medium' : 'hard';
      setAdaptiveDifficulty(newDiff);
      toast({
        title: '🔥 Schwierigkeit erhöht!',
        description: `Du bist auf einer ${stats.streak}er-Serie! Neue Stufe: ${newDiff === 'medium' ? 'Mittel' : 'Schwer'}`,
      });
    } else if (stats.incorrect > 0 && stats.correct === 0 && adaptiveDifficulty !== 'easy') {
      setAdaptiveDifficulty('easy');
      toast({
        title: 'Schwierigkeit angepasst',
        description: 'Wir starten mit leichteren Fragen.',
      });
    }
  }, [stats.streak, stats.incorrect, stats.correct]);

  const handleStartFromBeruf = (payload: TrainerStartPayload) => {
    const { curriculumId, berufLabel, route } = payload;
    setSelectedCurriculumId(curriculumId);
    setSelectedBerufName(berufLabel);

    switch (route) {
      case 'exam-simulation':
        navigate(`/exam-simulation?curriculum=${curriculumId}`);
        return;
      case 'drill':
        navigate(`/drill?curriculum=${curriculumId}`);
        return;
      case 'inline':
      default:
        startLearningSession(curriculumId);
    }
  };

  const startLearningSession = async (curriculumId: string) => {
    setIsLoading(true);
    setStep('loading');

    try {
      const { data: structData, error: structError } = await supabase.functions.invoke('get-curriculum-structure', {
        body: { curriculumId },
      });

      if (structError || !structData?.competencies?.length) {
        throw new Error('Keine Kompetenzen für dieses Curriculum gefunden.');
      }

      const comps = structData.competencies;
      const randomComp = comps[Math.floor(Math.random() * comps.length)];

      const { data: questionsData, error: questionsError } = await supabase.functions.invoke('get-exam-questions', {
        body: {
          competency_id: randomComp.compId,
          difficulty: 'medium',
          count: 5,
        },
      });

      if (questionsError || !questionsData?.questions?.length) {
        throw new Error(
          'Noch keine freigegebenen Prüfungsfragen verfügbar. Bitte versuche es später erneut.'
        );
      }

      setQuestions(questionsData.questions);
      setCurrentIndex(0);
      setSelectedAnswer(null);
      setAnswerResult(null);
      setStats({ correct: 0, incorrect: 0, streak: 0, maxStreak: 0 });
      setAdaptiveDifficulty('medium');
      setStep('question');
    } catch (error) {
      console.error('Start session error:', error);
      toast({
        title: 'Fehler beim Starten',
        description: error instanceof Error ? error.message : 'Bitte versuche es erneut.',
        variant: 'destructive',
      });
      setStep('select');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnswer = async (answerIndex: number) => {
    if (selectedAnswer !== null || isSubmittingAnswer) return;

    setSelectedAnswer(answerIndex);
    setIsSubmittingAnswer(true);

    try {
      const { data: result, error } = await supabase.functions.invoke('submit-exam-answer', {
        body: {
          question_id: questions[currentIndex].id,
          selected_answer: answerIndex,
          session_id: sessionId,
        },
      });

      if (error) throw error;

      const isCorrect = result.is_correct;
      setAnswerResult(result);

      setStats(prev => ({
        correct: prev.correct + (isCorrect ? 1 : 0),
        incorrect: prev.incorrect + (isCorrect ? 0 : 1),
        streak: isCorrect ? prev.streak + 1 : 0,
        maxStreak: isCorrect ? Math.max(prev.maxStreak, prev.streak + 1) : prev.maxStreak,
      }));

      setStep('feedback');
    } catch (error) {
      console.error('Submit answer error:', error);
      toast({
        title: 'Fehler beim Auswerten',
        description: 'Bitte versuche es erneut.',
        variant: 'destructive',
      });
      setSelectedAnswer(null);
    } finally {
      setIsSubmittingAnswer(false);
    }
  };

  const nextQuestion = () => {
    if (currentIndex + 1 >= questions.length) {
      setStep('results');
    } else {
      setCurrentIndex(prev => prev + 1);
      setSelectedAnswer(null);
      setAnswerResult(null);
      setStep('question');
    }
  };

  const restartSession = () => {
    setStep('select');
    setQuestions([]);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setAnswerResult(null);
    setStats({ correct: 0, incorrect: 0, streak: 0, maxStreak: 0 });
    setSelectedCurriculumId('');
  };

  const currentQuestion = questions[currentIndex];
  const progressPercent = questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0;
  const scorePercent = questions.length > 0 ? (stats.correct / questions.length) * 100 : 0;

  // Show paywall if curriculum selected but no access
  if (selectedCurriculumId && !entitlementLoading && hasAccess === false) {
    return (
      <Paywall
        feature="exam_trainer"
        curriculumId={selectedCurriculumId}
        curriculumTitle={selectedBerufName}
      />
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Selection Step */}
      {step === 'select' && (
        <TrainerStartPage onStart={handleStartFromBeruf} />
      )}

      {/* Loading Step */}
      {step === 'loading' && (
        <Card className="glass-card border-border/50 max-w-2xl mx-auto">
          <CardContent className="py-16 text-center">
            <Sparkles className="h-16 w-16 text-primary mx-auto mb-6 animate-pulse" />
            <h3 className="text-xl font-display font-bold text-foreground mb-2">
              Fragen werden geladen...
            </h3>
            <p className="text-muted-foreground">
              Wir stellen dir Prüfungsfragen für {selectedBerufName || 'dein Training'} zusammen.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Question Step */}
      {(step === 'question' || step === 'feedback') && currentQuestion && (
        <div className="space-y-6 max-w-2xl mx-auto">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Frage {currentIndex + 1} von {questions.length}
              </span>
              <div className="flex items-center gap-3">
                {stats.streak > 0 && (
                  <div className="flex items-center gap-1 text-orange-500">
                    <Flame className="h-4 w-4" />
                    <span className="font-medium">{stats.streak}</span>
                  </div>
                )}
                <Badge variant="outline" className={cn(
                  adaptiveDifficulty === 'easy' && "text-green-500 border-green-500/30",
                  adaptiveDifficulty === 'medium' && "text-yellow-500 border-yellow-500/30",
                  adaptiveDifficulty === 'hard' && "text-red-500 border-red-500/30",
                )}>
                  {adaptiveDifficulty === 'easy' ? 'Leicht' : adaptiveDifficulty === 'medium' ? 'Mittel' : 'Schwer'}
                </Badge>
              </div>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>

          <Card className="glass-card border-border/50">
            <CardContent className="p-6 md:p-8">
              <p className="text-lg md:text-xl font-medium text-foreground mb-6 leading-relaxed">
                {currentQuestion.question_text}
              </p>

              <div className="space-y-3">
                {currentQuestion.options.map((option, idx) => {
                  const isSelected = selectedAnswer === idx;
                  const isCorrect = answerResult ? idx === answerResult.correct_answer : false;
                  const showResult = step === 'feedback' && answerResult;

                  return (
                    <button
                      key={idx}
                      onClick={() => handleAnswer(idx)}
                      disabled={step === 'feedback' || isSubmittingAnswer}
                      className={cn(
                        "w-full p-4 rounded-xl border text-left transition-all",
                        "flex items-center gap-4",
                        !showResult && !isSelected && "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50",
                        !showResult && isSelected && "border-primary bg-primary/10",
                        showResult && isCorrect && "border-green-500 bg-green-500/10",
                        showResult && isSelected && !isCorrect && "border-red-500 bg-red-500/10",
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-medium",
                        !showResult && "bg-muted text-muted-foreground",
                        showResult && isCorrect && "bg-green-500 text-white",
                        showResult && isSelected && !isCorrect && "bg-red-500 text-white",
                      )}>
                        {showResult && isCorrect ? (
                          <CheckCircle className="h-5 w-5" />
                        ) : showResult && isSelected && !isCorrect ? (
                          <XCircle className="h-5 w-5" />
                        ) : (
                          String.fromCharCode(65 + idx)
                        )}
                      </div>
                      <span className="text-foreground">{option}</span>
                    </button>
                  );
                })}
              </div>

              {isSubmittingAnswer && (
                <div className="mt-6 p-4 rounded-xl bg-muted/30 border border-border animate-pulse">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">Antwort wird ausgewertet...</span>
                  </div>
                </div>
              )}

              {step === 'feedback' && answerResult && (
                <div className="mt-6 p-4 rounded-xl bg-muted/30 border border-border animate-fade-in">
                  <p className="text-sm font-medium text-foreground mb-2">
                    {answerResult.is_correct ? (
                      <span className="text-green-500">✓ Richtig!</span>
                    ) : (
                      <span className="text-red-500">✗ Leider falsch</span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {answerResult.explanation}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {step === 'feedback' && (
            <Button
              onClick={nextQuestion}
              className="w-full gradient-primary text-primary-foreground shadow-glow"
            >
              {currentIndex + 1 >= questions.length ? 'Ergebnis anzeigen' : 'Nächste Frage'}
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      )}

      {/* Results Step */}
      {step === 'results' && (
        <Card className="glass-card border-border/50 max-w-2xl mx-auto">
          <CardContent className="py-12 text-center">
            <div className={cn(
              "w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6",
              scorePercent >= 80 ? "gradient-primary shadow-glow" :
              scorePercent >= 50 ? "bg-yellow-500" : "bg-red-500"
            )}>
              <Trophy className="h-12 w-12 text-white" />
            </div>

            <h3 className="text-2xl font-display font-bold text-foreground mb-2">
              {scorePercent >= 80 ? 'Hervorragend!' :
               scorePercent >= 50 ? 'Gut gemacht!' : 'Weiter üben!'}
            </h3>

            <p className="text-muted-foreground mb-8">
              Du hast {stats.correct} von {questions.length} Fragen richtig beantwortet.
            </p>

            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="p-4 rounded-xl bg-muted/30">
                <p className="text-3xl font-bold text-green-500">{stats.correct}</p>
                <p className="text-sm text-muted-foreground">Richtig</p>
              </div>
              <div className="p-4 rounded-xl bg-muted/30">
                <p className="text-3xl font-bold text-red-500">{stats.incorrect}</p>
                <p className="text-sm text-muted-foreground">Falsch</p>
              </div>
              <div className="p-4 rounded-xl bg-muted/30">
                <p className="text-3xl font-bold text-orange-500">{stats.maxStreak}</p>
                <p className="text-sm text-muted-foreground">Beste Serie</p>
              </div>
            </div>

            <div className="max-w-md mx-auto mb-8">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Dein Ergebnis</span>
                <span className="font-medium text-foreground">{Math.round(scorePercent)}%</span>
              </div>
              <Progress value={scorePercent} className="h-3" />
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button variant="outline" onClick={restartSession}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Neues Training
              </Button>
              <Button
                onClick={() => startLearningSession(selectedCurriculumId)}
                className="gradient-primary text-primary-foreground"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Nochmal trainieren
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
