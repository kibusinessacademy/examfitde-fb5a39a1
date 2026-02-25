import { useState, useCallback } from 'react';
import { CheckCircle2, XCircle, ChevronRight, Trophy, RotateCcw } from 'lucide-react';
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
    id: string;
    text: string;
    is_correct: boolean;
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
  lessonId: string;
  onCompleted?: (score: number, maxScore: number) => void;
}

interface QuestionResult {
  questionId: string;
  selectedOptionId: string | null;
  isCorrect: boolean;
}

export default function MiniCheckPlayer({ 
  content, 
  lessonId,
  onCompleted 
}: MiniCheckPlayerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [results, setResults] = useState<QuestionResult[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [consecutiveFails, setConsecutiveFails] = useState(0);
  const [sessionId] = useState(() => crypto.randomUUID());

  const questions = content.questions || [];
  const passingScore = content.passing_score ?? 70;
  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;

  const isCorrectAnswer = useCallback(() => {
    if (!selectedOption || !currentQuestion) return false;
    const selected = currentQuestion.options.find(o => o.id === selectedOption);
    return selected?.is_correct ?? false;
  }, [selectedOption, currentQuestion]);

  const handleSelectOption = (optionId: string) => {
    if (hasAnswered) return;
    setSelectedOption(optionId);
  };

  const handleCheckAnswer = () => {
    if (!selectedOption) return;
    
    const correct = isCorrectAnswer();
    setHasAnswered(true);
    
    setResults(prev => [...prev, {
      questionId: currentQuestion.id,
      selectedOptionId: selectedOption,
      isCorrect: correct
    }]);

    if (!correct) {
      setConsecutiveFails(prev => prev + 1);
    } else {
      setConsecutiveFails(0);
    }

    // Persist attempt via RPC (fire-and-forget, non-blocking)
    const selectedIdx = currentQuestion.options.findIndex(o => o.id === selectedOption);
    supabase.rpc('submit_minicheck_attempt', {
      p_question_id: currentQuestion.id,
      p_chosen_index: selectedIdx,
      p_session_id: sessionId,
      p_lesson_id: lessonId,
    }).then(({ error }) => {
      if (error) console.error('Failed to persist minicheck attempt:', error);
    });
  };

  const handleNextQuestion = async () => {
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(prev => prev + 1);
      setSelectedOption(null);
      setHasAnswered(false);
    } else {
      // Quiz finished
      setIsFinished(true);
      await saveResult();
    }
  };

  const saveResult = async () => {
    const correctCount = results.filter(r => r.isCorrect).length + (isCorrectAnswer() ? 1 : 0);
    const scorePercent = Math.round((correctCount / totalQuestions) * 100);
    
    setSaving(true);
    try {
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
      } else {
        onCompleted?.(correctCount, totalQuestions);
      }
    } catch (err) {
      console.error('Error in saveResult:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleRetry = () => {
    setCurrentIndex(0);
    setSelectedOption(null);
    setHasAnswered(false);
    setResults([]);
    setIsFinished(false);
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
      <Card className="glass-card">
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
            <div className="text-4xl font-bold">
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
        </CardContent>
      </Card>
    );
  }

  // Question screen
  return (
    <div className="space-y-6">
      {/* Proactive Help Hints */}
      <ProactiveHelpHints
        failCount={consecutiveFails}
        contextLessonId={lessonId}
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
          <h3 className="text-lg font-medium leading-relaxed">
            {currentQuestion.text}
          </h3>

          {/* Options */}
          <div className="space-y-3">
            {currentQuestion.options.map((option) => {
              const isSelected = selectedOption === option.id;
              const showResult = hasAnswered;
              const isCorrect = option.is_correct;
              
              let optionClass = "border-border hover:border-primary/50 hover:bg-muted/30";
              
              if (showResult) {
                if (isCorrect) {
                  optionClass = "border-green-500 bg-green-500/10";
                } else if (isSelected && !isCorrect) {
                  optionClass = "border-red-500 bg-red-500/10";
                } else {
                  optionClass = "border-border opacity-50";
                }
              } else if (isSelected) {
                optionClass = "border-primary bg-primary/10";
              }

              return (
                <button
                  key={option.id}
                  onClick={() => handleSelectOption(option.id)}
                  disabled={hasAnswered}
                  className={cn(
                    "w-full p-4 rounded-xl border-2 text-left transition-all",
                    "flex items-center gap-3",
                    optionClass,
                    !hasAnswered && "cursor-pointer"
                  )}
                >
                  <div className={cn(
                    "w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                    isSelected ? "border-primary" : "border-muted-foreground/30"
                  )}>
                    {showResult && isCorrect && (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    )}
                    {showResult && isSelected && !isCorrect && (
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
          {hasAnswered && (
            <div className={cn(
              "p-4 rounded-xl",
              isCorrectAnswer() ? "bg-green-500/10 border border-green-500/30" : "bg-red-500/10 border border-red-500/30"
            )}>
              <div className="flex items-start gap-3">
                {isCorrectAnswer() ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
                )}
                <div>
                  <p className="font-medium">
                    {isCorrectAnswer() ? 'Richtig!' : 'Leider falsch'}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {isCorrectAnswer() 
                      ? currentQuestion.explanation_correct || 'Gut gemacht!'
                      : currentQuestion.explanation_wrong || 'Versuche es beim nächsten Mal besser.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            {!hasAnswered ? (
              <Button 
                onClick={handleCheckAnswer}
                disabled={!selectedOption}
              >
                Antwort prüfen
              </Button>
            ) : (
              <Button onClick={handleNextQuestion} className="gap-2" disabled={saving}>
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
