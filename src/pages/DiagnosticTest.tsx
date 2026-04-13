import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSaveDiagnostic, type DiagnosticResult } from '@/hooks/useAdaptiveLearning';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { 
  Loader2, Brain, CheckCircle2, XCircle, ArrowRight, 
  Calendar as CalendarIcon, Clock, Target, Sparkles, AlertTriangle, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import PageExplainer from '@/components/admin/PageExplainer';
import { de } from 'date-fns/locale';

interface DiagnosticQuestion {
  id: string;
  competency_id: string;
  competency_title: string;
  question_text: string;
  options: string[];
}

type TestPhase = 'intro' | 'testing' | 'goals' | 'results';

export default function DiagnosticTest() {
  const { curriculumId } = useParams<{ curriculumId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const saveDiagnostic = useSaveDiagnostic();
  
  const [phase, setPhase] = useState<TestPhase>('intro');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<
    Map<string, { answer: number; correct: boolean; correctAnswer: number }>
  >(new Map());
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [examDate, setExamDate] = useState<Date | undefined>();
  const [weeklyHours, setWeeklyHours] = useState(5);
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  
  const { data: curriculum } = useQuery({
    queryKey: ['curriculum', curriculumId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curricula')
        .select('id, title, description')
        .eq('id', curriculumId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!curriculumId,
  });
  
  const { data: questions, isLoading, error: questionsError } = useQuery({
    queryKey: ['diagnostic-questions', curriculumId],
    queryFn: async (): Promise<DiagnosticQuestion[]> => {
      if (!curriculumId) return [];

      // 1. Get competencies for this curriculum
      const { data: learningFields, error: lfError } = await supabase
        .from('learning_fields')
        .select('id')
        .eq('curriculum_id', curriculumId);

      if (lfError) throw lfError;
      const learningFieldIds = (learningFields || []).map((lf) => lf.id);
      if (learningFieldIds.length === 0) return [];

      const { data: competencies, error: compError } = await supabase
        .from('competencies')
        .select('id, title')
        .in('learning_field_id', learningFieldIds);

      if (compError) throw compError;
      if (!competencies?.length) return [];

      // 2. Pick up to 15 random competencies
      const shuffledCompetencies = competencies
        .slice()
        .sort(() => Math.random() - 0.5)
        .slice(0, 15);
      const compIds = shuffledCompetencies.map(c => c.id);
      const compMap = new Map(shuffledCompetencies.map(c => [c.id, c.title]));

      // 3. Single DB query: fetch questions for all selected competencies at once
      // NOTE: correct_answer and explanation are NOT selected (security)
      const { data: rawQuestions, error: qError } = await (supabase as any)
        .from('v_exam_questions_safe')
        .select('id, question_text, options, competency_id, difficulty')
        .in('competency_id', compIds)
        .limit(200);

      if (qError) throw qError;
      const questions = (rawQuestions || []) as { id: string; question_text: string; options: string[]; competency_id: string; difficulty: string }[];
      if (!questions.length) return [];

      // 4. Pick one question per competency (shuffled)
      const byComp = new Map<string, typeof questions>();
      for (const q of questions) {
        const arr = byComp.get(q.competency_id) || [];
        arr.push(q);
        byComp.set(q.competency_id, arr);
      }

      const questionsOut: DiagnosticQuestion[] = [];
      for (const compId of compIds) {
        const pool = byComp.get(compId);
        if (!pool?.length) continue;
        const q = pool[Math.floor(Math.random() * pool.length)];
        questionsOut.push({
          id: q.id,
          competency_id: compId,
          competency_title: compMap.get(compId) || '',
          question_text: q.question_text,
          options: q.options as string[],
        });
        if (questionsOut.length >= 15) break;
      }

      return questionsOut;
    },
    enabled: !!curriculumId && phase === 'testing',
  });
  
  const currentQuestion = questions?.[currentIndex];
  const progress = questions ? ((currentIndex + 1) / questions.length) * 100 : 0;
  
  const handleAnswer = async (answerIndex: number) => {
    if (!currentQuestion) return;
    setAnswerError(null);

    try {
      const { data, error } = await supabase.functions.invoke('submit-exam-answer', {
        body: {
          question_id: currentQuestion.id,
          selected_answer: answerIndex,
        },
      });

      if (error) throw error;

      setAnswers((prev) =>
        new Map(prev).set(currentQuestion.competency_id, {
          answer: answerIndex,
          correct: !!data?.is_correct,
          correctAnswer: Number(data?.correct_answer ?? -1),
        })
      );

      setTimeout(() => {
        if (currentIndex < (questions?.length || 0) - 1) {
          setCurrentIndex((prev) => prev + 1);
        } else {
          calculateResults();
        }
      }, 1000);
    } catch (err) {
      console.error('Answer submission error:', err);
      setAnswerError('Antwort konnte nicht gesendet werden. Bitte versuche es erneut.');
    }
  };
  
  const calculateResults = () => {
    const competencyScores = new Map<string, { correct: number; total: number; title: string }>();
    
    answers.forEach((value, compId) => {
      const question = questions?.find(q => q.competency_id === compId);
      const existing = competencyScores.get(compId) || { correct: 0, total: 0, title: question?.competency_title || '' };
      competencyScores.set(compId, {
        correct: existing.correct + (value.correct ? 1 : 0),
        total: existing.total + 1,
        title: existing.title,
      });
    });
    
    const diagnosticResults: DiagnosticResult[] = [];
    
    competencyScores.forEach((value, compId) => {
      const score = (value.correct / value.total) * 100;
      let level: 'weak' | 'partial' | 'strong' = 'partial';
      if (score >= 80) level = 'strong';
      else if (score < 50) level = 'weak';
      
      diagnosticResults.push({
        competency_id: compId,
        competency_title: value.title,
        score,
        level,
      });
    });
    
    setResults(diagnosticResults);
    setPhase('goals');
  };
  
  const handleComplete = async () => {
    if (!curriculumId) return;
    
    await saveDiagnostic.mutateAsync({
      curriculumId,
      results,
      examDate,
      weeklyTimeMinutes: weeklyHours * 60,
    });
    
    setPhase('results');
  };
  
  if (!user) {
    return (
      <div className="container max-w-2xl py-12 text-center">
        <p>Bitte melde dich an, um den Diagnosetest zu starten.</p>
        <Button onClick={() => navigate('/auth')} className="mt-4">Anmelden</Button>
      </div>
    );
  }
  
  if (phase === 'intro') {
    return (
      <div className="container max-w-2xl py-12">
        <Card className="glass-card">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 rounded-full gradient-primary flex items-center justify-center mb-4">
              <Brain className="h-8 w-8 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl font-display">Diagnosetest</CardTitle>
            <CardDescription className="text-base">
              {curriculum?.title || 'Lehrplan'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <PageExplainer
              title="Was passiert beim Diagnosetest?"
              description="Der Test prüft stichprobenartig dein Wissen in verschiedenen Kompetenzen. Danach erstellt das System einen personalisierten Lernplan, der deine Schwächen priorisiert."
              workflow={[
                { label: 'Diagnose', active: true },
                { label: 'Lernziele' },
                { label: 'Lernplan' },
                { label: 'Training' },
              ]}
              actions={[
                '"Test starten" – Beantworte ~15 Fragen aus verschiedenen Kompetenzen',
                'Nach dem Test: Prüfungsdatum und Lernzeit eingeben für optimalen Plan',
              ]}
              tips={[
                'Es gibt kein Richtig oder Falsch – der Test dient nur zur Einschätzung',
                'Je ehrlicher du antwortest, desto besser wird dein Lernplan',
              ]}
            />
            <div className="text-center text-muted-foreground">
              <p className="mb-4">
                Dieser kurze Test hilft uns, deinen aktuellen Wissensstand einzuschätzen 
                und einen personalisierten Lernplan für dich zu erstellen.
              </p>
              <div className="grid grid-cols-3 gap-4 my-6">
                <div className="p-4 rounded-lg bg-muted/50">
                  <Clock className="h-6 w-6 mx-auto mb-2 text-primary" />
                  <div className="text-sm font-medium">~10 Min.</div>
                  <div className="text-xs text-muted-foreground">Dauer</div>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <Target className="h-6 w-6 mx-auto mb-2 text-primary" />
                  <div className="text-sm font-medium">15 Fragen</div>
                  <div className="text-xs text-muted-foreground">Kompetenzen</div>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <Sparkles className="h-6 w-6 mx-auto mb-2 text-primary" />
                  <div className="text-sm font-medium">Personalisiert</div>
                  <div className="text-xs text-muted-foreground">Lernplan</div>
                </div>
              </div>
            </div>
            
            <Button 
              onClick={() => setPhase('testing')} 
              className="w-full gradient-primary text-primary-foreground"
              size="lg"
            >
              Test starten
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (phase === 'testing') {
    if (isLoading || !questions) {
      return (
        <div className="container max-w-2xl py-12 flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }

    if (questionsError) {
      return (
        <div className="container max-w-2xl py-12">
          <Card className="glass-card">
            <CardContent className="p-8 text-center space-y-4">
              <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
              <h2 className="text-xl font-display font-bold">Fragen konnten nicht geladen werden</h2>
              <p className="text-muted-foreground">
                Bitte prüfe deine Internetverbindung und versuche es erneut.
              </p>
              <Button onClick={() => setPhase('intro')} variant="outline">
                <RotateCcw className="h-4 w-4 mr-2" /> Zurück zum Start
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    
    if (!currentQuestion) {
      return (
        <div className="container max-w-2xl py-12 text-center">
          <p>Keine Fragen verfügbar für diesen Test.</p>
        </div>
      );
    }
    
    const hasAnswered = answers.has(currentQuestion.competency_id);
    const userAnswer = answers.get(currentQuestion.competency_id);
    
    return (
      <div className="container max-w-2xl py-8">
        <div className="mb-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground">Frage {currentIndex + 1} von {questions.length}</span>
            <Badge variant="outline">{currentQuestion.competency_title}</Badge>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
        
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-xl font-display leading-relaxed">
              {currentQuestion.question_text}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {currentQuestion.options.map((option, idx) => {
              const isSelected = userAnswer?.answer === idx;
              const isCorrect = idx === (userAnswer?.correctAnswer ?? -999);
              const showResult = hasAnswered;

              return (
                <button
                  key={idx}
                  onClick={() => !hasAnswered && handleAnswer(idx)}
                  disabled={hasAnswered}
                  className={cn(
                    "w-full p-4 rounded-lg border text-left transition-all",
                    "hover:border-primary/50 hover:bg-primary/5",
                    showResult && isCorrect && "border-green-500 bg-green-500/10",
                    showResult && isSelected && !isCorrect && "border-red-500 bg-red-500/10",
                    !showResult && "border-border"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                      showResult && isCorrect ? "bg-green-500 text-white" :
                      showResult && isSelected && !isCorrect ? "bg-red-500 text-white" :
                      "bg-muted"
                    )}>
                      {showResult ? (
                        isCorrect ? <CheckCircle2 className="h-4 w-4" /> : 
                        isSelected ? <XCircle className="h-4 w-4" /> : 
                        String.fromCharCode(65 + idx)
                      ) : (
                        String.fromCharCode(65 + idx)
                      )}
                    </div>
                    <span className="flex-1">{option}</span>
                  </div>
                </button>
              );
            })}

            {answerError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{answerError}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-destructive hover:text-destructive"
                  onClick={() => setAnswerError(null)}
                >
                  <RotateCcw className="h-3 w-3 mr-1" /> Erneut
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }
  
  if (phase === 'goals') {
    const weakCount = results.filter(r => r.level === 'weak').length;
    const strongCount = results.filter(r => r.level === 'strong').length;
    
    return (
      <div className="container max-w-2xl py-8">
        <Card className="glass-card">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-display">Deine Lernziele</CardTitle>
            <CardDescription>Fast geschafft! Hilf uns noch, deinen Lernplan zu optimieren.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-3 gap-4 p-4 rounded-lg bg-muted/50">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-500">{strongCount}</div>
                <div className="text-xs text-muted-foreground">Stark</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-500">{results.length - weakCount - strongCount}</div>
                <div className="text-xs text-muted-foreground">Teilweise</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-500">{weakCount}</div>
                <div className="text-xs text-muted-foreground">Schwach</div>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Wann ist deine Prüfung? (optional)</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {examDate ? format(examDate, 'PPP', { locale: de }) : 'Datum auswählen'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={examDate}
                    onSelect={setExamDate}
                    initialFocus
                    disabled={(date) => date < new Date()}
                  />
                </PopoverContent>
              </Popover>
            </div>
            
            <div className="space-y-2">
              <Label>Wie viele Stunden kannst du pro Woche lernen?</Label>
              <div className="flex items-center gap-4">
                <Input
                  type="number"
                  min={1}
                  max={40}
                  value={weeklyHours}
                  onChange={(e) => setWeeklyHours(Number(e.target.value))}
                  className="w-24"
                />
                <span className="text-muted-foreground">Stunden pro Woche</span>
              </div>
            </div>
            
            <Button 
              onClick={handleComplete} 
              className="w-full gradient-primary text-primary-foreground"
              size="lg"
              disabled={saveDiagnostic.isPending}
            >
              {saveDiagnostic.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Lernplan erstellen
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="container max-w-2xl py-8">
      <Card className="glass-card">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
          </div>
          <CardTitle className="text-2xl font-display">Dein Lernplan ist fertig!</CardTitle>
          <CardDescription>Basierend auf deinen Ergebnissen haben wir einen personalisierten Plan erstellt.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            {results.map((result, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-3 h-3 rounded-full",
                    result.level === 'strong' ? 'bg-green-500' :
                    result.level === 'partial' ? 'bg-yellow-500' : 'bg-red-500'
                  )} />
                  <span className="text-sm">{result.competency_title}</span>
                </div>
                <Badge variant={
                  result.level === 'strong' ? 'default' :
                  result.level === 'partial' ? 'secondary' : 'destructive'
                }>
                  {result.level === 'strong' ? 'Stark' :
                   result.level === 'partial' ? 'Teilweise' : 'Schwach'}
                </Badge>
              </div>
            ))}
          </div>
          
          <Button 
            onClick={() => navigate('/dashboard')} 
            className="w-full gradient-primary text-primary-foreground"
            size="lg"
          >
            Zum Dashboard
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
