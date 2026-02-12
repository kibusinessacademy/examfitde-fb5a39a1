import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Trophy, 
  XCircle, 
  BarChart3, 
  BookOpen, 
  ArrowLeft, 
  RotateCcw,
  Target,
  TrendingUp,
  Clock,
  Loader2,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LessonRecommendations } from '@/components/exam/LessonRecommendations';

interface ExamSessionData {
  id: string;
  mode: string;
  total_questions: number;
  score_percentage: number | null;
  passed: boolean | null;
  started_at: string;
  finished_at: string | null;
  breakdown: {
    by_difficulty?: Record<string, { correct: number; total: number }>;
    by_learning_field?: Record<string, { correct: number; total: number }>;
    by_competency?: Record<string, { correct: number; total: number; title?: string }>;
  } | null;
  blueprint: {
    title: string;
    pass_threshold: number;
  };
  curriculum: {
    title: string;
  };
}

interface QuestionDetail {
  id: string;
  order_index: number;
  is_correct: boolean | null;
  user_answer: number | null;
  difficulty: string;
  learning_field_code: string | null;
  competency_code: string | null;
  question: {
    question_text: string;
    options: Array<{ text: string }>;
    correct_answer: number;
    explanation: string | null;
  };
}

export default function ExamResultsPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [session, setSession] = useState<ExamSessionData | null>(null);
  const [questions, setQuestions] = useState<QuestionDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllQuestions, setShowAllQuestions] = useState(false);

  useEffect(() => {
    async function fetchResults() {
      if (!sessionId || !user) return;

      try {
        const { data, error } = await supabase.functions.invoke('get-exam-results', {
          body: { session_id: sessionId },
        });

        if (error) throw error;

        setSession((data?.session || null) as ExamSessionData | null);
        setQuestions((data?.questions || []) as QuestionDetail[]);
      } catch (e) {
        setSession(null);
        setQuestions([]);
      } finally {
        setLoading(false);
      }
    }

    fetchResults();
  }, [sessionId, user]);


  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container max-w-4xl py-8 text-center">
        <h1 className="text-2xl font-bold mb-4">Prüfung nicht gefunden</h1>
        <Button onClick={() => navigate('/exam-simulation')}>
          Zurück zum Prüfungstrainer
        </Button>
      </div>
    );
  }

  const correctCount = questions.filter(q => q.is_correct).length;
  const incorrectQuestions = questions.filter(q => q.is_correct === false);
  const scorePercent = session.score_percentage ?? 0;
  const passed = session.passed ?? false;

  const difficultyLabels: Record<string, string> = {
    easy: 'Leicht',
    medium: 'Mittel',
    hard: 'Schwer',
  };

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-display font-bold">Prüfungsergebnis</h1>
          <p className="text-muted-foreground">{session.blueprint?.title}</p>
        </div>
      </div>

      {/* Main Result Card */}
      <Card className={cn(
        "glass-card text-center",
        passed ? "border-primary/50" : "border-destructive/50"
      )}>
        <CardContent className="pt-8 pb-6">
          <div className={cn(
            "w-20 h-20 rounded-full mx-auto flex items-center justify-center mb-4",
            passed ? "bg-primary/20" : "bg-destructive/20"
          )}>
            {passed ? (
              <Trophy className="h-10 w-10 text-primary" />
            ) : (
              <XCircle className="h-10 w-10 text-destructive" />
            )}
          </div>
          
          <h2 className="text-2xl font-display font-bold mb-2">
            {passed ? 'Bestanden!' : 'Nicht bestanden'}
          </h2>
          
          <div className="text-4xl font-bold mb-2">
            {scorePercent.toFixed(1)}%
          </div>
          
          <p className="text-muted-foreground">
            {correctCount} von {session.total_questions} richtig
            <span className="mx-2">•</span>
            Mindestens {session.blueprint?.pass_threshold}% benötigt
          </p>

          <div className="flex items-center justify-center gap-4 mt-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {new Date(session.started_at).toLocaleDateString('de-DE')}
            </span>
            <Badge variant="outline">{session.mode}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Lesson Recommendations for failed exams */}
      {!passed && sessionId && (
        <LessonRecommendations sessionId={sessionId} />
      )}

      {/* Breakdown by Difficulty */}
      {session.breakdown?.by_difficulty && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Auswertung nach Schwierigkeit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(session.breakdown.by_difficulty).map(([difficulty, stats]) => {
                const percentage = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
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
      )}

      {/* Breakdown by Learning Field */}
      {session.breakdown?.by_learning_field && Object.keys(session.breakdown.by_learning_field).length > 1 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Auswertung nach Lernfeld
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(session.breakdown.by_learning_field)
                .filter(([code]) => code !== 'unknown')
                .sort((a, b) => {
                  const percA = a[1].total > 0 ? a[1].correct / a[1].total : 0;
                  const percB = b[1].total > 0 ? b[1].correct / b[1].total : 0;
                  return percA - percB; // Weakest first
                })
                .map(([code, stats]) => {
                  const percentage = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
                  const isWeak = percentage < 50;
                  
                  return (
                    <div key={code}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="flex items-center gap-2">
                          Lernfeld {code}
                          {isWeak && (
                            <Badge variant="destructive" className="text-xs">
                              Schwachstelle
                            </Badge>
                          )}
                        </span>
                        <span>{stats.correct}/{stats.total} ({percentage.toFixed(0)}%)</span>
                      </div>
                      <Progress 
                        value={percentage} 
                        className={cn("h-2", isWeak && "[&>div]:bg-destructive")} 
                      />
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Incorrect Questions Analysis */}
      {incorrectQuestions.length > 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Fehleranalyse ({incorrectQuestions.length} Fragen)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(showAllQuestions ? incorrectQuestions : incorrectQuestions.slice(0, 3)).map((q) => (
                <div key={q.id} className="p-4 rounded-xl bg-destructive/5 border border-destructive/20">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <span className="text-sm font-medium">Frage {q.order_index + 1}</span>
                    <Badge variant="outline" className="text-xs">
                      {difficultyLabels[q.difficulty] || q.difficulty}
                    </Badge>
                  </div>
                  <p className="text-sm mb-3">{q.question?.question_text}</p>
                  
                  <div className="space-y-1 text-sm">
                    <div className="flex items-start gap-2 text-destructive">
                      <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>Deine Antwort: {q.question?.options?.[q.user_answer ?? 0]?.text || 'Keine'}</span>
                    </div>
                    <div className="flex items-start gap-2 text-success">
                      <TrendingUp className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>Richtig: {q.question?.options?.[q.question?.correct_answer]?.text}</span>
                    </div>
                    {q.question?.explanation && (
                      <p className="text-muted-foreground mt-2 pl-6">
                        {q.question.explanation}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              
              {incorrectQuestions.length > 3 && !showAllQuestions && (
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => setShowAllQuestions(true)}
                >
                  Alle {incorrectQuestions.length} Fehler anzeigen
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Weakness Plan */}
      {!passed && incorrectQuestions.length > 0 && (
        <Card className="glass-card border-warning/30 bg-warning/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-5 w-5 text-warning" />
              Dein Schwächen-Plan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Basierend auf deiner Analyse empfehlen wir diese Reihenfolge:
            </p>
            {Object.entries(session.breakdown?.by_learning_field || {})
              .filter(([code, stats]) => code !== 'unknown' && stats.total > 0 && (stats.correct / stats.total) < 0.7)
              .sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total))
              .slice(0, 5)
              .map(([code, stats], idx) => {
                const pct = Math.round((stats.correct / stats.total) * 100);
                return (
                  <div key={code} className="flex items-center gap-3 p-3 rounded-lg bg-background border border-border/50">
                    <span className="w-6 h-6 rounded-full bg-warning/20 text-warning text-xs font-bold flex items-center justify-center">{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Lernfeld {code}</p>
                      <Progress value={pct} className="h-1.5 mt-1 [&>div]:bg-warning" />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">{pct}%</span>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-4">
        <Button variant="outline" className="flex-1 gap-2" asChild>
          <Link to="/exam-simulation">
            <RotateCcw className="h-4 w-4" />
            Neue Prüfung
          </Link>
        </Button>
        <Button className="flex-1 gap-2" asChild>
          <Link to="/dashboard">
            <TrendingUp className="h-4 w-4" />
            Zum Dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
