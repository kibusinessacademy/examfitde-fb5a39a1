import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useCheckEntitlement } from '@/hooks/useEntitlements';
import { Paywall } from '@/components/shop/Paywall';
import { supabase } from '@/integrations/supabase/client';
import { 
  Brain, 
  Target, 
  CheckCircle, 
  XCircle, 
  ArrowRight, 
  Loader2,
  Trophy,
  Flame,
  RotateCcw,
  Sparkles,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Tables } from '@/integrations/supabase/types';

type Curriculum = Tables<'curricula'>;
type LearningField = Tables<'learning_fields'>;
type Competency = Tables<'competencies'>;

interface Question {
  id: string;
  question_text: string;
  options: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  // NOTE: correct_answer and explanation are NEVER stored client-side
  // They are fetched via submit-exam-answer after answering
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

  // Selection state
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [learningFields, setLearningFields] = useState<LearningField[]>([]);
  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [selectedCurriculumId, setSelectedCurriculumId] = useState('');
  const [selectedLearningFieldId, setSelectedLearningFieldId] = useState('');
  const [selectedCompetencyId, setSelectedCompetencyId] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');

  // Entitlement check
  const { data: hasAccess, isLoading: entitlementLoading } = useCheckEntitlement(
    selectedCurriculumId, 
    'exam_trainer'
  );
  const selectedCurriculum = curricula.find(c => c.id === selectedCurriculumId);

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

  // Adaptive difficulty
  const [adaptiveDifficulty, setAdaptiveDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');

  useEffect(() => {
    fetchCurricula();
  }, []);

  useEffect(() => {
    if (selectedCurriculumId) {
      fetchLearningFields(selectedCurriculumId);
      setSelectedLearningFieldId('');
      setSelectedCompetencyId('');
    }
  }, [selectedCurriculumId]);

  useEffect(() => {
    if (selectedLearningFieldId) {
      fetchCompetencies(selectedLearningFieldId);
      setSelectedCompetencyId('');
    }
  }, [selectedLearningFieldId]);

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

  const fetchCurricula = async () => {
    const { data } = await supabase
      .from('curricula')
      .select('*')
      .eq('status', 'frozen')
      .order('title');
    if (data) setCurricula(data);
  };

  const fetchLearningFields = async (curriculumId: string) => {
    const { data } = await supabase
      .from('learning_fields')
      .select('*')
      .eq('curriculum_id', curriculumId)
      .order('sort_order');
    if (data) setLearningFields(data);
  };

  const fetchCompetencies = async (learningFieldId: string) => {
    const { data } = await supabase
      .from('competencies')
      .select('*')
      .eq('learning_field_id', learningFieldId)
      .order('sort_order');
    if (data) setCompetencies(data);
  };

  const startSession = async () => {
    if (!selectedCompetencyId) {
      toast({
        title: 'Bitte Kompetenz auswählen',
        description: 'Wähle ein Curriculum, Lernfeld und eine Kompetenz aus.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setStep('loading');

    try {
      // SSOT: Use edge function to get sanitized questions (no correct_answer/explanation)
      // ONLY approved blueprint questions – NO free generation fallback
      const { data: questionsData, error: questionsError } = await supabase.functions.invoke('get-exam-questions', {
        body: {
          competency_id: selectedCompetencyId,
          difficulty: difficulty,
          count: 5,
        },
      });

      if (questionsError || !questionsData?.questions || questionsData.questions.length === 0) {
        throw new Error(
          'Keine freigegebenen Prüfungsfragen für diese Kompetenz vorhanden. ' +
          'Bitte wähle eine andere Kompetenz oder warte, bis Fragen freigegeben wurden.'
        );
      }

      setQuestions(questionsData.questions);

      setCurrentIndex(0);
      setSelectedAnswer(null);
      setAnswerResult(null);
      setStats({ correct: 0, incorrect: 0, streak: 0, maxStreak: 0 });
      setAdaptiveDifficulty(difficulty);
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
      // SSOT: Submit answer to server for evaluation
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
      saveAttempt();
    } else {
      setCurrentIndex(prev => prev + 1);
      setSelectedAnswer(null);
      setAnswerResult(null);
      setStep('question');
    }
  };

  const saveAttempt = async () => {
    if (!user) return;

    try {
      await supabase.from('exam_attempts').insert({
        user_id: user.id,
        curriculum_id: selectedCurriculumId,
        score: stats.correct,
        total_questions: questions.length,
        completed_at: new Date().toISOString(),
        answers: questions.map((q, i) => ({
          question: q.question_text,
          correct: i < stats.correct,
        })),
      });
    } catch (error) {
      console.error('Save attempt error:', error);
    }
  };

  const restartSession = () => {
    setStep('select');
    setQuestions([]);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setAnswerResult(null);
    setStats({ correct: 0, incorrect: 0, streak: 0, maxStreak: 0 });
  };

  const currentQuestion = questions[currentIndex];
  const progressPercent = questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0;
  const scorePercent = questions.length > 0 ? (stats.correct / questions.length) * 100 : 0;

  const selectedLearningField = learningFields.find(lf => lf.id === selectedLearningFieldId);
  const selectedCompetency = competencies.find(c => c.id === selectedCompetencyId);

  // Show paywall if curriculum selected but no access
  if (selectedCurriculumId && !entitlementLoading && hasAccess === false) {
    return (
      <Paywall 
        feature="exam_trainer" 
        curriculumId={selectedCurriculumId}
        curriculumTitle={selectedCurriculum?.title}
      />
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-4">
          <Brain className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">KI-Prüfungstrainer</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2">
          Prüfungs<span className="text-gradient">trainer</span>
        </h1>
        <p className="text-muted-foreground">
          Adaptive Prüfungsvorbereitung mit KI-generierten Fragen
        </p>
      </div>

      {/* Selection Step */}
      {step === 'select' && (
        <Card className="glass-card border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Thema auswählen
            </CardTitle>
            <CardDescription>
              Wähle ein Lernfeld und eine Kompetenz für dein Training
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Curriculum Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Curriculum</label>
              <Select value={selectedCurriculumId} onValueChange={setSelectedCurriculumId}>
                <SelectTrigger className="bg-muted/50">
                  <SelectValue placeholder="Curriculum auswählen..." />
                </SelectTrigger>
                <SelectContent>
                  {curricula.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Learning Field Selection */}
            {selectedCurriculumId && (
              <div className="space-y-2 animate-fade-in">
                <label className="text-sm font-medium text-foreground">Lernfeld</label>
                <Select value={selectedLearningFieldId} onValueChange={setSelectedLearningFieldId}>
                  <SelectTrigger className="bg-muted/50">
                    <SelectValue placeholder="Lernfeld auswählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {learningFields.map(lf => (
                      <SelectItem key={lf.id} value={lf.id}>
                        {lf.code}: {lf.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Competency Selection */}
            {selectedLearningFieldId && (
              <div className="space-y-2 animate-fade-in">
                <label className="text-sm font-medium text-foreground">Kompetenz</label>
                <Select value={selectedCompetencyId} onValueChange={setSelectedCompetencyId}>
                  <SelectTrigger className="bg-muted/50">
                    <SelectValue placeholder="Kompetenz auswählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {competencies.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code}: {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Difficulty Selection */}
            {selectedCompetencyId && (
              <div className="space-y-2 animate-fade-in">
                <label className="text-sm font-medium text-foreground">Startschwierigkeit</label>
                <div className="grid grid-cols-3 gap-3">
                  {(['easy', 'medium', 'hard'] as const).map(d => (
                    <button
                      key={d}
                      onClick={() => setDifficulty(d)}
                      className={cn(
                        "p-3 rounded-xl border transition-all text-center",
                        difficulty === d 
                          ? "border-primary bg-primary/10 text-foreground" 
                          : "border-border bg-muted/30 text-muted-foreground hover:border-border/80"
                      )}
                    >
                      <span className="block text-sm font-medium">
                        {d === 'easy' ? '🌱 Leicht' : d === 'medium' ? '🌿 Mittel' : '🌳 Schwer'}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Die Schwierigkeit passt sich automatisch an deine Leistung an.
                </p>
              </div>
            )}

            <Button
              onClick={startSession}
              disabled={!selectedCompetencyId || isLoading}
              className="w-full gradient-primary text-primary-foreground shadow-glow"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Training starten
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading Step */}
      {step === 'loading' && (
        <Card className="glass-card border-border/50">
          <CardContent className="py-16 text-center">
            <Sparkles className="h-16 w-16 text-primary mx-auto mb-6 animate-pulse" />
            <h3 className="text-xl font-display font-bold text-foreground mb-2">
              Fragen werden generiert...
            </h3>
            <p className="text-muted-foreground">
              Die KI erstellt personalisierte Prüfungsfragen für dich.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Question Step */}
      {(step === 'question' || step === 'feedback') && currentQuestion && (
        <div className="space-y-6">
          {/* Progress Bar */}
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

          {/* Question Card */}
          <Card className="glass-card border-border/50">
            <CardContent className="p-6 md:p-8">
              <p className="text-lg md:text-xl font-medium text-foreground mb-6 leading-relaxed">
                {currentQuestion.question_text}
              </p>

              {/* Answer Options */}
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

              {/* Loading state during answer submission */}
              {isSubmittingAnswer && (
                <div className="mt-6 p-4 rounded-xl bg-muted/30 border border-border animate-pulse">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">Antwort wird ausgewertet...</span>
                  </div>
                </div>
              )}

              {/* Feedback */}
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

          {/* Next Button */}
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
        <Card className="glass-card border-border/50">
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

            {/* Stats Grid */}
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

            {/* Score Bar */}
            <div className="max-w-md mx-auto mb-8">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Dein Ergebnis</span>
                <span className="font-medium text-foreground">{Math.round(scorePercent)}%</span>
              </div>
              <Progress value={scorePercent} className="h-3" />
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button variant="outline" onClick={restartSession}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Neues Training
              </Button>
              <Button 
                onClick={startSession}
                className="gradient-primary text-primary-foreground"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Gleiche Kompetenz wiederholen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
