import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Mic, 
  Clock, 
  Send, 
  ArrowRight, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Play,
  RotateCcw,
  Trophy,
  Target,
  BookOpen,
  Lightbulb,
  TrendingUp,
  Loader2
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOralExam, type EvaluationResult } from '@/hooks/useOralExam';
import { useCheckEntitlement } from '@/hooks/useEntitlements';
import { Paywall } from '@/components/shop/Paywall';
import { cn } from '@/lib/utils';

type ExamPhase = 'setup' | 'question' | 'evaluation' | 'results';

export default function OralExamTrainer() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<ExamPhase>('setup');
  const [selectedCurriculum, setSelectedCurriculum] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(180);
  const [isTimerActive, setIsTimerActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: curricula } = useQuery({
    queryKey: ['curricula-for-oral-exam'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curricula')
        .select('id, title')
        .eq('status', 'frozen')
        .order('title');
      if (error) throw error;
      return data;
    }
  });

  // Entitlement check
  const { data: hasAccess, isLoading: entitlementLoading } = useCheckEntitlement(
    selectedCurriculum || '',
    'oral_trainer'
  );
  const curriculumTitle = curricula?.find(c => c.id === selectedCurriculum)?.title;

  const {
    session,
    currentQuestion,
    evaluation,
    isLoading,
    startSession,
    submitAnswer,
    nextQuestion,
    finishSession,
    reset,
    progress
  } = useOralExam({
    curriculumId: selectedCurriculum || '',
    mode: 'practice',
    totalQuestions: 5
  });

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isTimerActive && timeRemaining > 0) {
      interval = setInterval(() => {
        setTimeRemaining(prev => prev - 1);
      }, 1000);
    } else if (timeRemaining === 0 && phase === 'question') {
      handleSubmitAnswer();
    }
    return () => clearInterval(interval);
  }, [isTimerActive, timeRemaining, phase]);

  const handleStartExam = async () => {
    if (!selectedCurriculum) return;
    await startSession();
    setPhase('question');
    setTimeRemaining(180);
    setIsTimerActive(true);
    setAnswer('');
  };

  const handleSubmitAnswer = async () => {
    setIsTimerActive(false);
    const result = await submitAnswer(answer);
    setPhase('evaluation');
  };

  const handleNextQuestion = async () => {
    if (progress && progress.current >= progress.total) {
      await finishSession();
      setPhase('results');
    } else {
      await nextQuestion();
      setPhase('question');
      setTimeRemaining(180);
      setIsTimerActive(true);
      setAnswer('');
    }
  };

  const handleRestart = () => {
    reset();
    setPhase('setup');
    setAnswer('');
    setTimeRemaining(180);
    setIsTimerActive(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.8) return 'text-green-600 dark:text-green-400';
    if (score >= 0.5) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getScoreBg = (score: number) => {
    if (score >= 0.8) return 'bg-green-500/10 border-green-500/30';
    if (score >= 0.5) return 'bg-yellow-500/10 border-yellow-500/30';
    return 'bg-red-500/10 border-red-500/30';
  };

  // Show paywall if curriculum selected but no access
  if (selectedCurriculum && !entitlementLoading && hasAccess === false) {
    return (
      <Paywall 
        feature="oral_trainer" 
        curriculumId={selectedCurriculum}
        curriculumTitle={curriculumTitle}
      />
    );
  }

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Mic className="h-8 w-8 text-primary" />
          Mündliche Prüfungssimulation
        </h1>
        <p className="text-muted-foreground mt-2">
          Trainiere für deine mündliche IHK-Abschlussprüfung mit KI-gestütztem Feedback
        </p>
      </div>

      {phase !== 'setup' && phase !== 'results' && progress && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">
              Frage {progress.current + 1} von {progress.total}
            </span>
            {phase === 'question' && (
              <Badge 
                variant={timeRemaining < 30 ? 'destructive' : 'secondary'}
                className="flex items-center gap-1"
              >
                <Clock className="h-3 w-3" />
                {formatTime(timeRemaining)}
              </Badge>
            )}
          </div>
          <Progress value={progress.percent} className="h-2" />
        </div>
      )}

      {phase === 'setup' && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Prüfung vorbereiten
            </CardTitle>
            <CardDescription>
              Wähle ein Curriculum und starte deine Übungsprüfung
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Ausbildungsberuf / Curriculum
              </label>
              <div className="grid gap-2">
                {curricula?.map(curriculum => (
                  <Button
                    key={curriculum.id}
                    variant={selectedCurriculum === curriculum.id ? 'default' : 'outline'}
                    className="justify-start h-auto py-3"
                    onClick={() => setSelectedCurriculum(curriculum.id)}
                  >
                    <BookOpen className="h-4 w-4 mr-2" />
                    {curriculum.title}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <h4 className="font-medium">So funktioniert's:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• 5 offene Fragen im IHK-Prüfungsstil</li>
                <li>• 3 Minuten Antwortzeit pro Frage</li>
                <li>• KI-Bewertung nach IHK-Kriterien</li>
                <li>• Detailliertes Feedback nach jeder Antwort</li>
              </ul>
            </div>

            <Button 
              size="lg" 
              className="w-full"
              disabled={!selectedCurriculum || isLoading}
              onClick={handleStartExam}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Prüfung starten
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === 'question' && currentQuestion && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Prüfungsfrage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
              <p className="text-lg font-medium">{currentQuestion.question_text}</p>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">
                Deine Antwort
              </label>
              <Textarea
                ref={textareaRef}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Formuliere deine Antwort wie in einer mündlichen Prüfung..."
                className="min-h-[200px] resize-none"
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground mt-2">
                Tipp: Strukturiere deine Antwort und verwende Fachbegriffe
              </p>
            </div>

            <div className="flex gap-3">
              <Button 
                className="flex-1"
                disabled={!answer.trim() || isLoading}
                onClick={handleSubmitAnswer}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Antwort abgeben
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {phase === 'evaluation' && evaluation && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Bewertung
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className={cn("p-4 rounded-lg border text-center", getScoreBg(evaluation.overall_score))}>
              <p className="text-sm text-muted-foreground mb-1">Gesamtbewertung</p>
              <p className={cn("text-4xl font-bold", getScoreColor(evaluation.overall_score))}>
                {Math.round(evaluation.overall_score * 100)}%
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { key: 'fachlichkeit', label: 'Fachlichkeit', score: evaluation.fachlichkeit_score },
                { key: 'struktur', label: 'Struktur', score: evaluation.struktur_score },
                { key: 'begriffssicherheit', label: 'Begriffssicherheit', score: evaluation.begriffssicherheit_score },
                { key: 'praxisbezug', label: 'Praxisbezug', score: evaluation.praxisbezug_score }
              ].map(criterion => (
                <div key={criterion.key} className="p-3 rounded-lg bg-muted/50 border">
                  <p className="text-xs text-muted-foreground mb-1">{criterion.label}</p>
                  <div className="flex items-center gap-2">
                    <Progress value={criterion.score * 100} className="flex-1 h-2" />
                    <span className={cn("text-sm font-medium", getScoreColor(criterion.score))}>
                      {Math.round(criterion.score * 100)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted/50">
                <h4 className="font-medium flex items-center gap-2 mb-2">
                  <Lightbulb className="h-4 w-4 text-yellow-500" />
                  Feedback
                </h4>
                <p className="text-sm text-muted-foreground">{evaluation.feedback}</p>
              </div>

              {evaluation.covered_points?.length > 0 && (
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                  <h4 className="font-medium flex items-center gap-2 mb-2 text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Gut abgedeckt
                  </h4>
                  <ul className="text-sm space-y-1">
                    {evaluation.covered_points.map((point, idx) => (
                      <li key={idx}>• {point}</li>
                    ))}
                  </ul>
                </div>
              )}

              {evaluation.missed_points?.length > 0 && (
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                  <h4 className="font-medium flex items-center gap-2 mb-2 text-red-600 dark:text-red-400">
                    <XCircle className="h-4 w-4" />
                    Verbesserungspotenzial
                  </h4>
                  <ul className="text-sm space-y-1">
                    {evaluation.missed_points.map((point, idx) => (
                      <li key={idx}>• {point}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <Button className="w-full" onClick={handleNextQuestion} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : progress && progress.current >= progress.total ? (
                <>
                  <Trophy className="h-4 w-4 mr-2" />
                  Ergebnisse anzeigen
                </>
              ) : (
                <>
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Nächste Frage
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {phase === 'results' && session && (
        <Card className="glass-card">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              {session.passed ? (
                <div className="h-20 w-20 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Trophy className="h-10 w-10 text-green-600 dark:text-green-400" />
                </div>
              ) : (
                <div className="h-20 w-20 rounded-full bg-yellow-500/20 flex items-center justify-center">
                  <TrendingUp className="h-10 w-10 text-yellow-600 dark:text-yellow-400" />
                </div>
              )}
            </div>
            <CardTitle className="text-2xl">
              {session.passed ? 'Bestanden!' : 'Weiter üben'}
            </CardTitle>
            <CardDescription>
              Deine Leistung in dieser Übungsprüfung
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className={cn(
              "p-6 rounded-lg border text-center",
              session.passed ? 'bg-green-500/10 border-green-500/30' : 'bg-yellow-500/10 border-yellow-500/30'
            )}>
              <p className="text-sm text-muted-foreground mb-2">Gesamtergebnis</p>
              <p className={cn(
                "text-5xl font-bold",
                session.passed ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'
              )}>
                {Math.round(session.overall_score || 0)}%
              </p>
              <p className="text-sm text-muted-foreground mt-2">Bestanden ab 50%</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Fachlichkeit', score: session.fachlichkeit_score, weight: '35%' },
                { label: 'Struktur', score: session.struktur_score, weight: '20%' },
                { label: 'Begriffssicherheit', score: session.begriffssicherheit_score, weight: '25%' },
                { label: 'Praxisbezug', score: session.praxisbezug_score, weight: '20%' }
              ].map(criterion => (
                <div key={criterion.label} className="p-4 rounded-lg bg-muted/50 border">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">{criterion.label}</p>
                    <Badge variant="outline" className="text-xs">{criterion.weight}</Badge>
                  </div>
                  <p className={cn("text-2xl font-bold", getScoreColor((criterion.score || 0) / 100))}>
                    {Math.round(criterion.score || 0)}%
                  </p>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {session.strengths && session.strengths.length > 0 && (
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                  <h4 className="font-medium flex items-center gap-2 mb-3 text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Stärken
                  </h4>
                  <ul className="text-sm space-y-2">
                    {session.strengths.slice(0, 4).map((s, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-green-600 dark:text-green-400 mt-1">✓</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {session.weaknesses && session.weaknesses.length > 0 && (
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                  <h4 className="font-medium flex items-center gap-2 mb-3 text-red-600 dark:text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    Zu verbessern
                  </h4>
                  <ul className="text-sm space-y-2">
                    {session.weaknesses.slice(0, 4).map((w, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-red-600 dark:text-red-400 mt-1">→</span>
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={handleRestart}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Neue Prüfung
              </Button>
              <Button className="flex-1" onClick={() => navigate('/dashboard')}>
                Zum Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
