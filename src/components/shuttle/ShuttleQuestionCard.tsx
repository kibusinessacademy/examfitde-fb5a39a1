import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ShuttleQuestion as ShuttleQuestionType } from '@/hooks/useShuttleMode';

interface ShuttleQuestionCardProps {
  question: ShuttleQuestionType;
  onSubmit: (idx: number) => void;
  disabled: boolean;
}

export function ShuttleQuestionCard({ question, onSubmit, disabled }: ShuttleQuestionCardProps) {
  const [selected, setSelected] = useState<number | null>(null);

  const handleSelect = (idx: number) => {
    if (disabled) return;
    setSelected(idx);
    onSubmit(idx);
  };

  useEffect(() => {
    setSelected(null);
  }, [question.id]);

  return (
    <div className="flex flex-col gap-4 w-full max-w-lg mx-auto px-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="bg-card rounded-2xl p-5 shadow-sm border">
        <p className="text-base font-medium text-foreground leading-relaxed">
          {question.question_text}
        </p>
        {question.difficulty && (
          <span className={cn(
            "inline-block mt-3 text-xs px-2.5 py-0.5 rounded-full font-medium",
            question.difficulty === 'easy' && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
            question.difficulty === 'medium' && "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
            question.difficulty === 'hard' && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
          )}>
            {question.difficulty === 'easy' ? 'Leicht' : question.difficulty === 'medium' ? 'Mittel' : 'Schwer'}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {question.options.map((option, idx) => (
          <button
            key={idx}
            onClick={() => handleSelect(idx)}
            disabled={disabled}
            className={cn(
              "w-full text-left p-4 rounded-xl border-2 transition-all duration-200",
              "hover:border-primary/40 hover:bg-primary/5",
              "active:scale-[0.98]",
              selected === idx
                ? "border-primary bg-primary/10 ring-2 ring-primary/20 shadow-sm"
                : "border-border bg-card",
              disabled && "opacity-60 cursor-not-allowed"
            )}
          >
            <div className="flex items-start gap-3">
              <span className={cn(
                "flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold",
                selected === idx
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}>
                {String.fromCharCode(65 + idx)}
              </span>
              <span className="text-sm text-foreground leading-relaxed pt-0.5">
                {typeof option === 'string' ? option : (option as any)?.text || JSON.stringify(option)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
