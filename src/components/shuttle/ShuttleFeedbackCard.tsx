import { CheckCircle2, XCircle, ArrowRight, Lightbulb, Loader2, Flame, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ShuttleFeedback, ShuttleQuestion } from '@/hooks/useShuttleMode';

interface ShuttleFeedbackCardProps {
  feedback: ShuttleFeedback;
  question: ShuttleQuestion;
  onNext: () => void;
  onExplain?: () => void;
}

export function ShuttleFeedbackCard({ feedback, question, onNext, onExplain }: ShuttleFeedbackCardProps) {
  return (
    <div className="flex flex-col gap-4 w-full max-w-lg mx-auto px-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* Result banner */}
      <div className={cn(
        "rounded-2xl p-5 border-2 flex items-start gap-3",
        feedback.is_correct
          ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800"
          : "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
      )}>
        {feedback.is_correct ? (
          <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
        ) : (
          <XCircle className="h-6 w-6 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        )}
        <div className="flex-1">
          <p className={cn(
            "font-semibold text-base",
            feedback.is_correct ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"
          )}>
            {feedback.is_correct ? 'Richtig!' : 'Leider falsch'}
          </p>
          {!feedback.is_correct && feedback.correct_option_text && (
            <p className="text-sm text-muted-foreground mt-1">
              Richtige Antwort: <span className="font-medium text-foreground">{feedback.correct_option_text}</span>
            </p>
          )}
        </div>
      </div>

      {/* XP + Streak micro rewards */}
      {(feedback.xp_awarded || feedback.streak) && (
        <div className="flex gap-2">
          {feedback.xp_awarded && feedback.xp_awarded > 0 && (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-semibold">
              <Star className="h-3 w-3" />
              +{feedback.xp_awarded} XP
            </div>
          )}
          {feedback.streak && feedback.streak > 0 && (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-100 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 text-xs font-semibold">
              <Flame className="h-3 w-3" />
              {feedback.streak}er Serie
            </div>
          )}
        </div>
      )}

      {/* Explanation */}
      {feedback.explanation && (
        <div className="bg-card rounded-2xl p-4 border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Erklärung</p>
          <p className="text-sm text-foreground leading-relaxed">{feedback.explanation}</p>
        </div>
      )}

      {/* Trap tags */}
      {!feedback.is_correct && feedback.trap_tags && feedback.trap_tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {feedback.trap_tags.map((tag, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 font-medium">
              ⚠ {tag}
            </span>
          ))}
        </div>
      )}

      {/* Explain My Mistake */}
      {!feedback.is_correct && !feedback.ai_explanation && onExplain && (
        <Button
          onClick={onExplain}
          variant="outline"
          className="w-full border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/20"
          disabled={feedback.ai_explanation_loading}
        >
          {feedback.ai_explanation_loading ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />KI erklärt...</>
          ) : (
            <><Lightbulb className="mr-2 h-4 w-4" />Fehler erklären lassen</>
          )}
        </Button>
      )}

      {/* AI Explanation */}
      {feedback.ai_explanation && (
        <div className="bg-amber-50 dark:bg-amber-900/10 rounded-2xl p-4 border border-amber-200 dark:border-amber-800">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">KI-Erklärung</p>
          </div>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{feedback.ai_explanation}</p>
        </div>
      )}

      {/* Next CTA */}
      <Button onClick={onNext} className="w-full h-12" size="lg">
        Nächste Frage <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
