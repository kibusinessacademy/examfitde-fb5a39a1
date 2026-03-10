import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Lightbulb,
  PenLine,
  Brain,
  Target,
  CheckCircle,
  ChevronDown,
  Sparkles,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSaveExerciseResponse } from '@/hooks/handbook';
import type { HandbookExercise as ExerciseType, HandbookExerciseResponse } from '@/hooks/handbook';

interface HandbookExerciseProps {
  exercise: ExerciseType;
  index: number;
  chapterId?: string;
  savedResponse?: HandbookExerciseResponse;
}

const exerciseTypeConfig: Record<string, {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
}> = {
  reflection: {
    icon: Brain,
    label: 'Reflexionsfrage',
    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  },
  decision: {
    icon: Target,
    label: 'Entscheidungsfrage',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  },
  analysis: {
    icon: Lightbulb,
    label: 'Analysefrage',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  },
  structure: {
    icon: PenLine,
    label: 'Strukturierungsaufgabe',
    color: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  },
  self_check: {
    icon: CheckCircle,
    label: 'Selbstcheck',
    color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
  },
};

export function HandbookExercise({ exercise, index, chapterId, savedResponse }: HandbookExerciseProps) {
  const [response, setResponse] = useState(savedResponse?.response_text || '');
  const [showHint, setShowHint] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [isSaved, setIsSaved] = useState(!!savedResponse);

  const { mutate: saveResponse, isPending } = useSaveExerciseResponse();

  const config = exerciseTypeConfig[exercise.exercise_type] ?? exerciseTypeConfig.reflection;
  const IconComponent = config.icon;

  const handleSave = () => {
    saveResponse(
      { exerciseId: exercise.id, responseText: response },
      { onSuccess: () => setIsSaved(true) },
    );
  };

  return (
    <Card className={cn(
      'border-l-4 transition-all',
      isSaved ? 'border-l-green-500 bg-green-50/30 dark:bg-green-950/10' : 'border-l-primary',
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Badge variant="outline" className={cn('gap-1', config.color)}>
            <IconComponent className="h-3 w-3" />
            {config.label}
          </Badge>
          <span className="text-xs text-muted-foreground">Übung {index + 1}</span>
        </div>
        <CardTitle className="text-lg leading-relaxed">
          {exercise.question_text}
        </CardTitle>
        {exercise.hint_text && (
          <CardDescription className="text-sm">
            <button
              onClick={() => setShowHint(!showHint)}
              className="text-primary hover:underline flex items-center gap-1"
            >
              <Lightbulb className="h-3.5 w-3.5" />
              {showHint ? 'Hinweis ausblenden' : 'Hinweis anzeigen'}
            </button>
            {showHint && (
              <p className="mt-2 p-3 bg-primary/5 rounded-lg border border-primary/20">
                {exercise.hint_text}
              </p>
            )}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            Deine Antwort (nur für dich sichtbar)
          </label>
          <Textarea
            value={response}
            onChange={(e) => {
              setResponse(e.target.value);
              setIsSaved(false);
            }}
            placeholder="Schreibe hier deine Gedanken auf..."
            className="min-h-[100px] resize-none"
          />
        </div>

        <div className="flex items-center justify-between">
          <Button
            onClick={handleSave}
            disabled={isPending || !response.trim()}
            size="sm"
            variant={isSaved ? 'outline' : 'default'}
          >
            {isSaved ? (
              <>
                <CheckCircle className="h-4 w-4 mr-1" />
                Gespeichert
              </>
            ) : (
              'Antwort speichern'
            )}
          </Button>

          {(exercise.explanation_text || exercise.example_answer) && (
            <Collapsible open={showExplanation} onOpenChange={setShowExplanation}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1">
                  <Sparkles className="h-4 w-4" />
                  Erklärung & Beispiel
                  <ChevronDown className={cn(
                    'h-4 w-4 transition-transform',
                    showExplanation && 'rotate-180',
                  )} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4 space-y-3">
                {exercise.explanation_text && (
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                      <Lightbulb className="h-4 w-4 text-amber-500" />
                      Warum das wichtig ist
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      {exercise.explanation_text}
                    </p>
                  </div>
                )}
                {exercise.example_answer && (
                  <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                    <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                      <PenLine className="h-4 w-4 text-primary" />
                      Beispielantwort
                    </h4>
                    <p className="text-sm whitespace-pre-line">
                      {exercise.example_answer}
                    </p>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
