import { useState, useCallback } from 'react';
import { SurfaceHumorCard } from '@/components/humor/SurfaceHumorCard';
import { CheckCircle2, XCircle, ChevronRight, Trophy, RotateCcw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import ProactiveHelpHints from '@/components/support/ProactiveHelpHints';

export interface MiniCheckQuestion {
  id: string;
  text: string;
  options: Array<{
    id: number | string;
    text: string;
    is_correct?: boolean; // only present for inline JSON fallback, never from DB
  }>;
  explanation_correct?: string;
  explanation_wrong?: string;
}

export interface MiniCheckContent {
  type: 'mini_check' | 'quiz';
  questions: MiniCheckQuestion[];
  passing_score?: number;
}

interface MiniCheckPlayerProps {
  content: MiniCheckContent;
  lessonId?: string | null;
  certificationId?: string | null;
  competenceId?: string | null;
  onCompleted?: (score: number, maxScore: number) => void;
}

interface QuestionResult {
  questionId: string;
  selectedIndex: number;
  isCorrect: boolean;
  correctIndex: number;
  explanation: string;
}

export default function MiniCheckPlayer({ 
  content, 
  lessonId,
  certificationId,
  competenceId,
  onCompleted 
}: MiniCheckPlayerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [results, setResults] = useState<QuestionResult[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [consecutiveFails, setConsecutiveFails] = useState(0);
  const [sessionId] = useState(() => crypto.randomUUID());

  // Server response for current question (after answer check)
  const [answerResult, setAnswerResult] = useState<{
    is_correct: boolean;
    correct_index: number;
    explanation: string;
  } | null>(null);

  const questions = content.questions || [];
  const passingScore = content.passing_score ?? 70;
  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;

  const handleSelectOption = (index: number) => {
    if (hasAnswered) return;
    setSelectedIndex(index);
  };

  const handleCheckAnswer = async () => {
    if (selectedIndex === null) return;
    
    setChecking(true);

    try {
      // Server-side answer check via RPC
      const { data, error } = await supabase.rpc('submit_minicheck_attempt', {
        p_question_id: currentQuestion.id,
        p_chosen_index: selectedIndex,
        p_session_id: sessionId,
        p_lesson_id: lessonId ?? null,
      });

      if (error) {
        console.error('Server check failed:', error);
        toast({
          title: 'Fehler',
          description: 'Antwortprüfung fehlgeschlagen. Bitte erneut versuchen.',
          variant: 'destructive',
        });
        setChecking(false);
        return;
      }

      const serverResult = data as unknown as { is_correct: boolean; correct_index: number; explanation: string };
      setAnswerResult(serverResult);
      finishAnswer(serverResult);
    } catch (err) {
      console.error('Answer check error:', err);
      toast({
        title: 'Fehler',
        description: 'Antwortprüfung fehlgeschlagen. Bitte erneut versuchen.',
        variant: 'destructive',
      });
    } finally {
      setChecking(false);
    }
  };

  const finishAnswer = (result: { is_correct: boolean; correct_index: number; explanation: string }) => {
    setHasAnswered(true);

    setResults(prev => [...prev, {
      questionId: currentQuestion.id,
      selectedIndex: selectedIndex!,
      isCorrect: result.is_correct,
      correctIndex: result.correct_index,
      explanation: result.explanation,
    }]);

    if (!result.is_correct) {
      setConsecutiveFails(prev => prev + 1);
    } else {
      setConsecutiveFails(0);
    }
  };

  const handleNextQuestion = async () => {
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(prev => prev + 1);
      setSelectedIndex(null);
      setHasAnswered(false);
      setAnswerResult(null);
    } else {
      setIsFinished(true);
      await saveResult();
    }
  };

  const saveResult = async () => {
    const correctCount = results.filter(r => r.isCorrect).length;
    const scorePercent = Math.round((correctCount / totalQuestions) * 100);
    
    setSaving(true);
    try {
      // Only save lesson outcome if we have a real lessonId (not drill mode)
      if (lessonId) {
        const { error } = await supabase.rpc('update_lesson_outcome', {
          p_lesson_id: lessonId,
          p_score_percent: scorePercent
        });
        
        if (error) {
          console.error('Error saving mini-check result:', error);
          toast({
            title: 'Fehler beim Speichern',
            description: 'Dein Ergebnis konnte nicht gespeichert werden.',
            variant: 'destructive'
          });
        }
      }
      onCompleted?.(correctCount, totalQuestions);
    } catch (err) {
      console.error('Error in saveResult:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleRetry = () => {
    setCurrentIndex(0);
    setSelectedIndex(null);
    setHasAnswered(false);
    setResults([]);
    setIsFinished(false);
    setAnswerResult(null);
  };

  const getScore = () => {
    const correctCount = results.filter(r => r.isCorrect).length;
    return { correct: correctCount, total: totalQuestions };
  };

  const getScorePercent = () => {
    const { correct, total } = getScore();
    return Math.round((correct / total) * 100);
  };

  if (questions.length === 0) {
    return (
      <Card className="glass-card">
        <CardContent className="p-6 text-center">
          <p className="text-muted-foreground">Keine Fragen verfügbar.</p>
        </CardContent>
      </Card>
    );
  }

  // Results screen
  if (isFinished) {
    const scorePercent = getScorePercent();
    const passed = scorePercent >= passingScore;
    const { correct, total } = getScore();

    return (
      <Card className="glass-card" data-testid="minicheck-result">
        <CardContent className="p-8 text-center space-y-6">
          <div className={cn(
            "w-20 h-20 rounded-full mx-auto flex items-center justify-center",
            passed ? "bg-green-500/20" : "bg-amber-500/20"
          )}>
            {passed ? (
              <Trophy className="h-10 w-10 text-green-500" />
            ) : (
              <RotateCcw className="h-10 w-10 text-amber-500" />
            )}
          </div>

          <div>
            <h3 className="text-2xl font-bold mb-2">
              {passed ? 'Großartig!' : 'Noch nicht ganz...'}
            </h3>
            <p className="text-muted-foreground">
              {passed 
                ? 'Du hast den Mini-Check bestanden!' 
                : `Du brauchst mindestens ${passingScore}% um zu bestehen.`}
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-4xl font-bold" data-testid="minicheck-result-score">
              {correct} / {total}
            </div>
            <Progress value={scorePercent} className="h-3" />
            <p className="text-sm text-muted-foreground">
              {scorePercent}% richtig
            </p>
          </div>

          {!passed && (
            <Button onClick={handleRetry} variant="outline" className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Erneut versuchen
            </Button>
          )}

          {/* Humor after result */}
          {certificationId && (
            <SurfaceHumorCard
              certificationId={certificationId}
              surface="minicheck_result"
              competenceId={competenceId}
              lessonId={lessonId}
              variant="inline"
            />
          )}
        </CardContent>
      </Card>
    );
  }

  // Question screen
  return (
    <div className="space-y-6" data-testid="minicheck-player">
      {/* Humor intro – only on first question */}
      {currentIndex === 0 && !hasAnswered && certificationId && (
        <SurfaceHumorCard
          certificationId={certificationId}
          surface="minicheck_intro"
          competenceId={competenceId}
          lessonId={lessonId}
          variant="inline"
        />
      )}
      {/* Proactive Help Hints */}
      <ProactiveHelpHints
        failCount={consecutiveFails}
        contextLessonId={lessonId ?? undefined}
        onAcceptHelp={(type) => {
          if (type === 'fail_streak' && hasAnswered && currentQuestion) {
            // Show explanation
          }
        }}
      />

      {/* Progress header */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Frage {currentIndex + 1} von {totalQuestions}</span>
        <span>{Math.round(((currentIndex) / totalQuestions) * 100)}% abgeschlossen</span>
      </div>
      <Progress value={(currentIndex / totalQuestions) * 100} className="h-2" />

      {/* Question */}
      <Card className="glass-card">
        <CardContent className="p-6 space-y-6">
          <h3 className="text-lg font-medium leading-relaxed" data-testid="question-text">
            {currentQuestion.text}
          </h3>

          {/* Options */}
          <div className="space-y-3">
            {currentQuestion.options.map((option, idx) => {
              const isSelected = selectedIndex === idx;
              const showResult = hasAnswered && answerResult;
              const isCorrectOption = showResult && answerResult.correct_index === idx;
              const isWrongSelected = showResult && isSelected && !answerResult.is_correct;
              
              let optionClass = "border-border hover:border-primary/50 hover:bg-muted/30";
              
              if (showResult) {
                if (isCorrectOption) {
                  optionClass = "border-green-500 bg-green-500/10";
                } else if (isWrongSelected) {
                  optionClass = "border-red-500 bg-red-500/10";
                } else {
                  optionClass = "border-border opacity-50";
                }
              } else if (isSelected) {
                optionClass = "border-primary bg-primary/10";
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleSelectOption(idx)}
                  disabled={hasAnswered || checking}
                  data-testid={`question-option-${idx}`}
                  className={cn(
                    "w-full p-4 rounded-xl border-2 text-left transition-all",
                    "flex items-center gap-3",
                    optionClass,
                    !hasAnswered && !checking && "cursor-pointer"
                  )}
                >
                  <div className={cn(
                    "w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                    isSelected ? "border-primary" : "border-muted-foreground/30"
                  )}>
                    {showResult && isCorrectOption && (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    )}
                    {isWrongSelected && (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                    {!showResult && isSelected && (
                      <div className="w-3 h-3 rounded-full bg-primary" />
                    )}
                  </div>
                  <span className="flex-1">{option.text}</span>
                </button>
              );
            })}
          </div>

          {/* Feedback */}
          {hasAnswered && answerResult && (
            <div data-testid={answerResult.is_correct ? "feedback-correct" : "feedback-incorrect"} className={cn(
              "p-4 rounded-xl",
              answerResult.is_correct ? "bg-green-500/10 border border-green-500/30" : "bg-red-500/10 border border-red-500/30"
            )}>
              <div className="flex items-start gap-3">
                {answerResult.is_correct ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
                )}
                <div>
                  <p className="font-medium">
                    {answerResult.is_correct ? 'Richtig!' : 'Leider falsch'}
                  </p>
                  {answerResult.explanation && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {answerResult.explanation}
                    </p>
                  )}
                  {!answerResult.explanation && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {answerResult.is_correct ? 'Gut gemacht!' : 'Versuche es beim nächsten Mal besser.'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            {!hasAnswered ? (
              <Button 
                onClick={handleCheckAnswer}
                disabled={selectedIndex === null || checking}
                className="gap-2"
                data-testid="answer-submit"
              >
                {checking && <Loader2 className="h-4 w-4 animate-spin" />}
                Antwort prüfen
              </Button>
            ) : (
              <Button onClick={handleNextQuestion} className="gap-2" disabled={saving} data-testid="question-next">
                {currentIndex < totalQuestions - 1 ? (
                  <>
                    Nächste Frage
                    <ChevronRight className="h-4 w-4" />
                  </>
                ) : (
                  saving ? 'Speichern...' : 'Ergebnis anzeigen'
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
