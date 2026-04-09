import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Trophy, XCircle, BarChart3, BookOpen, ArrowLeft, RotateCcw,
  Target, TrendingUp, Clock, Loader2, ChevronRight, Brain,
  Sparkles, Zap, Shield, AlertTriangle, CheckCircle2, HelpCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LessonRecommendations } from '@/components/exam/LessonRecommendations';
import { CompetencyRadarChart } from '@/components/exam/CompetencyRadarChart';
import { PassProbabilityBadge } from '@/components/exam/PassProbabilityBadge';
import PageExplainer from '@/components/admin/PageExplainer';

interface DiagnosticData {
  readiness_pct: number;
  confidence: number;
  fail_risk_pct: number;
  verdict: string;
  total_skills: number;
  mastered_count: number;
  partial_count: number;
  not_mastered_count: number;
  session_weakest_skills: Array<{
    skill_node_id: string;
    lernfeld: string;
    kompetenz: string;
    session_accuracy: number | null;
    session_correct: number | null;
    session_total: number | null;
    mastery_pct: number;
    trend: string;
  }>;
  weakest_skills: Array<{
    skill_node_id: string;
    lernfeld: string;
    kompetenz: string;
    mastery_pct: number;
    confidence: number;
    mastery_status: string;
    trend: string;
    total_attempts: number;
  }>;
  strongest_skills: Array<{
    skill_node_id: string;
    kompetenz: string;
    mastery_pct: number;
  }>;
  recommendations: Array<{ priority: string; text: string }>;
  coaching_trigger: {
    mode: string;
    focus_skills: Array<{ kompetenz: string; mastery_pct: number; lernfeld: string; session_accuracy?: number | null }>;
    readiness_verdict: string;
  };
}

interface ExamSessionData {
  id: string;
  mode: string;
  total_questions: number;
  score_percentage: number | null;
  passed: boolean | null;
  started_at: string;
  finished_at: string | null;
  curriculum_id?: string;
  breakdown: {
    by_difficulty?: Record<string, { correct: number; total: number }>;
    by_learning_field?: Record<string, { correct: number; total: number }>;
    by_competency?: Record<string, { correct: number; total: number; title?: string; accuracy_pct?: number }>;
    by_skill_node?: Record<string, { correct: number; total: number; kompetenz: string; lernfeld: string; accuracy_pct?: number }>;
  } | null;
  blueprint: { title: string; pass_threshold: number };
  curriculum: { title: string };
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
  const [diagnostic, setDiagnostic] = useState<DiagnosticData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const [coachFeedback, setCoachFeedback] = useState<any>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [remediationLoading, setRemediationLoading] = useState(false);

  const shareEmitted = useRef(false);

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
        setDiagnostic((data?.diagnostic || null) as DiagnosticData | null);

        // Emit share events once after loading final results
        if (!shareEmitted.current && data?.session?.finished_at) {
          shareEmitted.current = true;
          supabase.rpc('fn_emit_share_event_for_exam_session', {
            p_exam_session_id: sessionId,
          }).then(() => {
            // Invalidate share events query so the orchestrator picks them up
          });
        }
      } catch (e) {
        setSession(null);
        setQuestions([]);
      } finally {
        setLoading(false);
      }
    }

    fetchResults();
  }, [sessionId, user]);

  // Auto-load coach feedback
  useEffect(() => {
    if (!session || !sessionId || !session.finished_at) return;
    loadCoachFeedback();
  }, [session, sessionId]);

  async function loadCoachFeedback() {
    if (feedbackLoading || coachFeedback) return;
    setFeedbackLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('exam-coach-feedback', {
        body: { session_id: sessionId },
      });
      if (!error && data?.feedback) {
        setCoachFeedback(data.feedback);
      }
    } catch {
      // Non-blocking
    } finally {
      setFeedbackLoading(false);
    }
  }

  async function startRemediation() {
    if (remediationLoading || !sessionId) return;
    setRemediationLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('adaptive-remediation', {
        body: { action: 'generate', session_id: sessionId },
      });
      if (!error && data?.remediation) {
        navigate(`/exam-trainer?remediation=${data.remediation.id}`);
      }
    } catch {
      // Non-blocking
    } finally {
      setRemediationLoading(false);
    }
  }

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
    easy: 'Leicht', medium: 'Mittel', hard: 'Schwer', very_hard: 'Sehr schwer',
  };

  const verdictLabels: Record<string, { label: string; color: string; icon: any }> = {
    exam_ready: { label: 'Prüfungsreif', color: 'text-primary', icon: CheckCircle2 },
    almost_ready: { label: 'Fast bereit', color: 'text-amber-500', icon: TrendingUp },
    needs_work: { label: 'Noch Arbeit nötig', color: 'text-orange-500', icon: AlertTriangle },
    not_ready: { label: 'Nicht bereit', color: 'text-destructive', icon: XCircle },
    not_started: { label: 'Keine Daten', color: 'text-muted-foreground', icon: HelpCircle },
  };

  const priorityStyles: Record<string, { icon: any; badgeClass: string }> = {
    critical: { icon: AlertTriangle, badgeClass: 'bg-destructive/10 text-destructive border-destructive/20' },
    recommended: { icon: Brain, badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
    next_step: { icon: TrendingUp, badgeClass: 'bg-primary/10 text-primary border-primary/20' },
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

      <PageExplainer
        title="Was zeigt die Ergebnisseite?"
        description="Hier siehst du deine komplette Prüfungsauswertung: Gesamtscore, Kompetenz-Diagnose, Prüfungsreife und personalisierte Empfehlungen."
        workflow={[
          { label: 'Prüfung' },
          { label: 'Diagnose', active: true },
          { label: 'Coaching' },
          { label: 'Gezielt üben' },
        ]}
        actions={[
          'Diagnose → Zeigt deine Stärken, Schwächen und Prüfungsreife',
          'Coaching → KI-gestützte Empfehlungen für dein Training',
          'Gezielt üben → Starte adaptive Übungen in schwachen Bereichen',
        ]}
        tips={[
          'Kompetenzen unter 60% werden als "kritisch" markiert',
          'Das Durchfallrisiko sinkt, je mehr du übst und Confidence aufbaust',
          'Der Tutor-Coach passt seinen Modus an deine Reife an',
        ]}
      />

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
          {session.curriculum && (
            <div className="mt-3 flex justify-center">
              <PassProbabilityBadge curriculumId={(session as any).curriculum_id} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Diagnostic Card (dual-layer) ─── */}
      {diagnostic && (
        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Kompetenz-Diagnose
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Readiness + Fail Risk + Confidence Row */}
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-xl bg-muted/50">
                <div className="text-2xl font-bold">{diagnostic.readiness_pct.toFixed(0)}%</div>
                <div className="text-xs text-muted-foreground">Prüfungsreife</div>
                {(() => {
                  const v = verdictLabels[diagnostic.verdict] || verdictLabels.not_started;
                  const Icon = v.icon;
                  return (
                    <div className={cn("flex items-center justify-center gap-1 mt-1 text-xs font-medium", v.color)}>
                      <Icon className="h-3 w-3" />
                      {v.label}
                    </div>
                  );
                })()}
              </div>
              <div className="text-center p-3 rounded-xl bg-muted/50">
                <div className="text-2xl font-bold">{diagnostic.fail_risk_pct.toFixed(0)}%</div>
                <div className="text-xs text-muted-foreground">Durchfallrisiko</div>
                <Progress 
                  value={diagnostic.fail_risk_pct} 
                  className={cn("h-1.5 mt-2", diagnostic.fail_risk_pct > 50 && "[&>div]:bg-destructive")} 
                />
              </div>
              <div className="text-center p-3 rounded-xl bg-muted/50">
                <div className="text-2xl font-bold">{(diagnostic.confidence * 100).toFixed(0)}%</div>
                <div className="text-xs text-muted-foreground">Aussagesicherheit</div>
                <div className={cn(
                  "text-xs mt-1",
                  diagnostic.confidence >= 0.7 ? "text-primary" : diagnostic.confidence >= 0.3 ? "text-amber-500" : "text-muted-foreground"
                )}>
                  {diagnostic.confidence >= 0.7 ? 'Hoch' : diagnostic.confidence >= 0.3 ? 'Mittel' : 'Niedrig'}
                </div>
              </div>
            </div>

            {/* Mastery Distribution */}
            <div className="flex items-center gap-2 text-sm">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-primary" />
                {diagnostic.mastered_count} Sicher
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-amber-500" />
                {diagnostic.partial_count} Teilweise
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-destructive" />
                {diagnostic.not_mastered_count} Kritisch
              </span>
            </div>

            {/* Session-specific Weakest Skills */}
            {diagnostic.session_weakest_skills.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                  In dieser Prüfung schwach
                </h4>
                <div className="space-y-2">
                  {diagnostic.session_weakest_skills.slice(0, 4).map((skill) => (
                    <div key={skill.skill_node_id} className="flex items-center gap-3 p-2.5 rounded-lg bg-destructive/5 border border-destructive/15">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{skill.kompetenz}</p>
                        <p className="text-xs text-muted-foreground">
                          LF {skill.lernfeld} • {skill.session_correct}/{skill.session_total} richtig
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold text-destructive">{skill.session_accuracy?.toFixed(0)}%</span>
                        <div className="text-xs text-muted-foreground">
                          Global: {skill.mastery_pct.toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Global Weakest Skills */}
            {diagnostic.weakest_skills.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                  Langfristig schwache Kompetenzen
                </h4>
                <div className="space-y-2">
                  {diagnostic.weakest_skills.slice(0, 4).map((skill) => (
                    <div key={skill.skill_node_id} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/50 border border-border">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{skill.kompetenz}</p>
                        <p className="text-xs text-muted-foreground">LF {skill.lernfeld}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold">{skill.mastery_pct.toFixed(0)}%</span>
                        <div className="text-xs text-muted-foreground">
                          {skill.trend === 'improving' ? '↑' : skill.trend === 'declining' ? '↓' : '→'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Strongest Skills */}
            {diagnostic.strongest_skills.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                  Stärkste Kompetenzen
                </h4>
                <div className="flex flex-wrap gap-2">
                  {diagnostic.strongest_skills.slice(0, 5).map((skill) => (
                    <Badge key={skill.skill_node_id} variant="outline" className="border-primary/50 text-primary">
                      {skill.kompetenz} ({skill.mastery_pct.toFixed(0)}%)
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Prioritized Recommendations */}
            {diagnostic.recommendations.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1">
                  <Brain className="h-3.5 w-3.5" />
                  Empfehlungen
                </h4>
                {diagnostic.recommendations.map((rec, i) => {
                  const style = priorityStyles[rec.priority] || priorityStyles.next_step;
                  const PIcon = style.icon;
                  return (
                    <div key={i} className={cn("flex items-start gap-2 p-2.5 rounded-lg border text-sm", style.badgeClass)}>
                      <PIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{rec.text}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Action CTAs */}
            <div className="flex gap-3">
              {(diagnostic.session_weakest_skills.length > 0 || diagnostic.weakest_skills.length > 0) && (
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="flex-1 gap-1.5"
                  onClick={startRemediation}
                  disabled={remediationLoading}
                >
                  {remediationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  Schwächen trainieren
                </Button>
              )}
              <Button 
                size="sm" 
                className="flex-1 gap-1.5"
                asChild
              >
                <Link to="/exam-simulation">
                  <RotateCcw className="h-4 w-4" />
                  Adaptive Prüfung
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 🧠 KI-Coach Feedback */}
      {(coachFeedback || feedbackLoading) && (
        <Card className="glass-card border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-5 w-5 text-primary" />
              Dein KI-Prüfungscoach
              {diagnostic?.coaching_trigger && (
                <Badge variant="outline" className="text-xs ml-auto">
                  Modus: {diagnostic.coaching_trigger.mode === 'explainer' ? 'Erklärer' : 
                           diagnostic.coaching_trigger.mode === 'coach' ? 'Coach' : 'Prüfer'}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {feedbackLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyse wird erstellt…
              </div>
            ) : coachFeedback ? (
              <>
                {coachFeedback.summary && (
                  <p className="text-sm leading-relaxed">{coachFeedback.summary}</p>
                )}
                {coachFeedback.strengths?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Stärken</h4>
                    <div className="flex flex-wrap gap-2">
                      {coachFeedback.strengths.map((s: any, i: number) => (
                        <Badge key={i} variant="outline" className="border-primary/50 text-primary">
                          LF {s.code}: {s.percentage}%
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {coachFeedback.weaknesses?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Schwächen</h4>
                    <div className="flex flex-wrap gap-2">
                      {coachFeedback.weaknesses.map((w: any, i: number) => (
                        <Badge key={i} variant="outline" className="border-destructive/50 text-destructive">
                          LF {w.code}: {w.percentage}% ({w.errors} Fehler)
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {coachFeedback.learning_plan?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                      <Brain className="h-3.5 w-3.5 inline mr-1" />
                      Dein 48h-Lernplan
                    </h4>
                    <ol className="space-y-1.5">
                      {coachFeedback.learning_plan.map((step: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Cognitive Competency Radar */}
      {(session as any).curriculum_id && (
        <CompetencyRadarChart curriculumId={(session as any).curriculum_id} />
      )}

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
                  return percA - percB;
                })
                .map(([code, stats]) => {
                  const percentage = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
                  const isWeak = percentage < 50;
                  return (
                    <div key={code}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="flex items-center gap-2">
                          Lernfeld {code}
                          {isWeak && <Badge variant="destructive" className="text-xs">Schwachstelle</Badge>}
                        </span>
                        <span>{stats.correct}/{stats.total} ({percentage.toFixed(0)}%)</span>
                      </div>
                      <Progress value={percentage} className={cn("h-2", isWeak && "[&>div]:bg-destructive")} />
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
                    <div className="flex items-start gap-2 text-primary">
                      <TrendingUp className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>Richtig: {q.question?.options?.[q.question?.correct_answer]?.text}</span>
                    </div>
                    {q.question?.explanation && (
                      <p className="text-muted-foreground mt-2 pl-6">{q.question.explanation}</p>
                    )}
                  </div>
                </div>
              ))}
              {incorrectQuestions.length > 3 && !showAllQuestions && (
                <Button variant="outline" className="w-full" onClick={() => setShowAllQuestions(true)}>
                  Alle {incorrectQuestions.length} Fehler anzeigen
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
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
