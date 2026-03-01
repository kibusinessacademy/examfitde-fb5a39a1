import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CheckCircle2, XCircle, ChevronDown, Send, BookOpen, RotateCcw } from 'lucide-react';
import { checkLessonAnswer, type AnswerCheckResult } from '@/hooks/useLessonAnswerKey';
import { cn } from '@/lib/utils';

interface LessonAnswerCheckProps {
  lessonId: string;
  exemplarAnswer: string;
}

export default function LessonAnswerCheck({ lessonId, exemplarAnswer }: LessonAnswerCheckProps) {
  const [userAnswer, setUserAnswer] = useState('');
  const [result, setResult] = useState<AnswerCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [showExemplar, setShowExemplar] = useState(false);

  const handleCheck = async () => {
    if (!userAnswer.trim() || userAnswer.trim().length < 10) return;
    setChecking(true);
    try {
      const res = await checkLessonAnswer(lessonId, userAnswer);
      setResult(res);
    } catch (e) {
      console.error('Answer check failed:', e);
    } finally {
      setChecking(false);
    }
  };

  const handleRetry = () => {
    setResult(null);
    setUserAnswer('');
    setShowExemplar(false);
  };

  const scoreColor = (score: number) =>
    score >= 80 ? 'text-green-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400';

  const scoreBg = (score: number) =>
    score >= 80 ? 'bg-green-500/10 border-green-500/30' : score >= 50 ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-red-500/10 border-red-500/30';

  return (
    <div className="mt-6 space-y-4">
      {/* Answer input */}
      {!result && (
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">
            Deine Antwort:
          </label>
          <Textarea
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            placeholder="Schreibe deine Antwort hier..."
            className="min-h-[120px] bg-muted/30 border-border"
            disabled={checking}
          />
          <Button
            onClick={handleCheck}
            disabled={checking || userAnswer.trim().length < 10}
            className="gap-2 gradient-primary text-primary-foreground"
          >
            <Send className="h-4 w-4" />
            {checking ? 'Wird geprüft…' : 'Antwort prüfen'}
          </Button>
        </div>
      )}

      {/* Result */}
      {result && !result.error && (
        <Card className={cn('border', scoreBg(result.score))}>
          <CardContent className="p-5 space-y-4">
            {/* Score header */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-muted-foreground">Dein Score</span>
                <div className={cn('text-3xl font-bold font-display', scoreColor(result.score))}>
                  {result.score}%
                </div>
              </div>
              <Badge variant={result.score >= 60 ? 'default' : 'destructive'} className="text-sm">
                {result.score >= 80 ? 'Sehr gut!' : result.score >= 60 ? 'Gut' : 'Noch üben'}
              </Badge>
            </div>

            {/* Found keywords */}
            {result.found_keywords.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">✅ Gefunden:</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.found_keywords.map((kw) => (
                    <Badge key={kw} variant="outline" className="gap-1 text-green-400 border-green-500/30">
                      <CheckCircle2 className="h-3 w-3" />
                      {kw}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Missing keywords */}
            {result.missing_keywords.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">❌ Fehlt noch:</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.missing_keywords.map((kw) => (
                    <Badge key={kw} variant="outline" className="gap-1 text-red-400 border-red-500/30">
                      <XCircle className="h-3 w-3" />
                      {kw}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Checklist */}
            {(result.found_checklist.length > 0 || result.missing_checklist.length > 0) && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Checkliste:</p>
                {result.found_checklist.map((ci) => (
                  <div key={ci} className="flex items-center gap-2 text-sm text-green-400">
                    <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                    {ci}
                  </div>
                ))}
                {result.missing_checklist.map((ci) => (
                  <div key={ci} className="flex items-center gap-2 text-sm text-red-400">
                    <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    {ci}
                  </div>
                ))}
              </div>
            )}

            <Button variant="outline" size="sm" className="gap-2" onClick={handleRetry}>
              <RotateCcw className="h-3.5 w-3.5" />
              Nochmal versuchen
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Exemplar answer accordion */}
      <Collapsible open={showExemplar} onOpenChange={setShowExemplar}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground w-full justify-start">
            <BookOpen className="h-4 w-4" />
            Musterlösung anzeigen
            <ChevronDown className={cn('h-4 w-4 ml-auto transition-transform', showExemplar && 'rotate-180')} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-2 border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-primary mb-2">Musterlösung:</p>
              <div className="text-sm whitespace-pre-wrap leading-relaxed">
                {exemplarAnswer}
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
