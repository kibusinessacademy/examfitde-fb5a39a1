import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ANSWER_OPTIONS, CATEGORY_LABELS, type Question } from "./types";

interface Props {
  question: Question;
  onAnswer: (score: 0 | 1 | 2 | 3) => void;
  onBack?: () => void;
  canGoBack: boolean;
}

export function QuizQuestionCard({ question, onAnswer, onBack, canGoBack }: Props) {
  return (
    <div className="rounded-2xl p-6 sm:p-8 bg-surface-raised border border-border-subtle shadow-elev-2">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-surface-sunken text-text-secondary">
          {CATEGORY_LABELS[question.category]}
        </span>
        {canGoBack && onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} className="h-8 px-2 text-text-secondary">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Zurück
          </Button>
        )}
      </div>

      <h2 className="text-xl sm:text-2xl font-semibold text-text-primary mb-6 leading-snug">
        {question.text}
      </h2>

      <div className="flex flex-col gap-3">
        {ANSWER_OPTIONS.map((opt) => (
          <button
            key={opt.score}
            type="button"
            onClick={() => onAnswer(opt.score)}
            className="text-left px-4 py-4 rounded-xl border border-border bg-surface hover:border-primary hover:bg-primary/5 active:scale-[0.99] transition-all text-base text-text-primary"
          >
            <span className="block font-medium">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
