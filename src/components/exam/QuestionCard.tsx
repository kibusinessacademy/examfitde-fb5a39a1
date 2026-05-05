import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuestionData {
  question: {
    id: string;
    question_text: string;
    options: unknown;
    difficulty: string;
    explanation: string | null;
    explanation_correct?: string | null;
    explanation_wrong?: string | null;
  };
  user_answer: number | null;
  is_correct: boolean | null;
}

interface AnswerFeedback {
  is_correct: boolean;
  correct_answer: number;
  explanation: string | null;
  explanation_correct?: string | null;
  explanation_wrong?: string | null;
}

interface QuestionCardProps {
  question: QuestionData;
  questionNumber: number;
  totalQuestions: number;
  selectedAnswer: number | null;
  onAnswer: (answer: number) => void;
  showResult: boolean;
  lastAnswer: AnswerFeedback | null;
  isSubmitting: boolean;
  mode: string;
}

export function QuestionCard({
  question,
  questionNumber,
  totalQuestions,
  selectedAnswer,
  onAnswer,
  showResult,
  lastAnswer,
  isSubmitting,
  mode,
}: QuestionCardProps) {
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
    <Card className="glass-card" data-testid="exam-question-card">
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
                data-testid={`exam-option-${idx}`}
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
        
        {/* Explanation - Enhanced for P0.4 */}
        {(showResult || question.user_answer !== null) && (() => {
          // Determine which explanation to show based on correctness
          const isCorrect = lastAnswer?.is_correct ?? question.is_correct;
          
          // Priority: specific explanation > general explanation
          let explanationText: string | null = null;
          let explanationTitle = 'Erklärung';
          
          if (isCorrect) {
            explanationText = lastAnswer?.explanation_correct 
              || question.question.explanation_correct 
              || lastAnswer?.explanation 
              || question.question.explanation;
            explanationTitle = 'Richtig!';
          } else {
            explanationText = lastAnswer?.explanation_wrong 
              || question.question.explanation_wrong 
              || lastAnswer?.explanation 
              || question.question.explanation;
            explanationTitle = 'Leider falsch';
          }
          
          if (!explanationText) return null;
          
          return (
            <div className={cn(
              "mt-4 p-4 rounded-lg border",
              isCorrect 
                ? "bg-primary/5 border-primary/20" 
                : "bg-destructive-bg-subtle border-destructive/20"
            )}>
              <h4 className={cn(
                "font-medium mb-2",
                isCorrect ? "text-primary" : "text-destructive"
              )}>
                {explanationTitle}
              </h4>
              <p className="text-sm text-muted-foreground">
                {explanationText}
              </p>
            </div>
          );
        })()}
      </CardContent>
      
      {question.user_answer === null && !showResult && (
        <CardFooter>
          <Button 
            onClick={handleSubmit}
            disabled={localAnswer === null || isSubmitting}
            className="w-full"
            data-testid="exam-answer-submit"
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
