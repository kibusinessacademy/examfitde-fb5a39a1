import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, X } from "lucide-react";
import { ANSWER_OPTIONS, CATEGORY_LABELS, type Question } from "./types";

interface Props {
  question: Question;
  onAnswer: (score: 0 | 1 | 2 | 3, mcCorrect: boolean | null) => void;
  onBack?: () => void;
  canGoBack: boolean;
}

type Stage = "mc" | "self";

export function QuizQuestionCard({ question, onAnswer, onBack, canGoBack }: Props) {
  const hasMc = !!question.mc;
  const [stage, setStage] = useState<Stage>(hasMc ? "mc" : "self");
  const [mcCorrect, setMcCorrect] = useState<boolean | null>(null);
  const [mcPick, setMcPick] = useState<number | null>(null);

  // Reset on question change.
  useEffect(() => {
    setStage(question.mc ? "mc" : "self");
    setMcCorrect(null);
    setMcPick(null);
  }, [question.id, question.mc]);

  function handleMcPick(idx: number) {
    if (!question.mc || mcPick !== null) return;
    const correct = idx === question.mc.correctIndex;
    setMcPick(idx);
    setMcCorrect(correct);
    // small delay so user sees the result before stage 2
    window.setTimeout(() => setStage("self"), 600);
  }

  function handleSelfAnswer(score: 0 | 1 | 2 | 3) {
    onAnswer(score, hasMc ? mcCorrect : null);
  }

  return (
    <div className="rounded-2xl p-6 sm:p-8 bg-surface-raised border border-border-subtle shadow-elev-2">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-surface-sunken text-text-secondary">
          {CATEGORY_LABELS[question.category]}
          {hasMc && (
            <span className="ml-1.5 text-text-tertiary">
              · {stage === "mc" ? "Schritt 1/2" : "Schritt 2/2"}
            </span>
          )}
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

      {hasMc && stage === "mc" ? (
        <>
          <p className="text-sm text-text-secondary mb-4">
            Wähle die korrekte Antwort:
          </p>
          <div className="flex flex-col gap-3" role="radiogroup" aria-label="Antwortoptionen">
            {question.mc!.options.map((opt, idx) => {
              const isPicked = mcPick === idx;
              const isCorrect = idx === question.mc!.correctIndex;
              const showResult = mcPick !== null;
              const stateClass = !showResult
                ? "border-border bg-surface hover:border-primary hover:bg-primary/5"
                : isCorrect
                  ? "border-success-border bg-success-bg-subtle"
                  : isPicked
                    ? "border-status-error/60 bg-status-error-subtle"
                    : "border-border bg-surface opacity-60";
              return (
                <button
                  key={idx}
                  type="button"
                  role="radio"
                  aria-checked={isPicked}
                  data-testid="quiz-mc-option"
                  data-mc-index={idx}
                  data-mc-correct={isCorrect ? "true" : "false"}
                  disabled={mcPick !== null}
                  onClick={() => handleMcPick(idx)}
                  className={`flex items-center justify-between text-left px-4 py-4 rounded-xl border transition-all text-base text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${stateClass}`}
                >
                  <span className="font-medium">{opt}</span>
                  {showResult && isCorrect && <Check className="h-4 w-4 text-success shrink-0" />}
                  {showResult && isPicked && !isCorrect && <X className="h-4 w-4 text-status-error shrink-0" />}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-text-secondary mb-4">
            {hasMc
              ? mcCorrect
                ? "Richtig — und wie sicher fühlst du dich bei diesem Thema insgesamt?"
                : "Knapp daneben — wie sicher fühlst du dich bei diesem Thema insgesamt?"
              : "Wie sicher fühlst du dich?"}
          </p>
          <div className="flex flex-col gap-3" role="radiogroup" aria-label="Selbsteinschätzung">
            {ANSWER_OPTIONS.map((opt, idx) => (
              <button
                key={opt.score}
                type="button"
                role="radio"
                aria-checked={false}
                data-testid="quiz-answer"
                data-answer-index={idx}
                onClick={() => handleSelfAnswer(opt.score)}
                className="text-left px-4 py-4 rounded-xl border border-border bg-surface hover:border-primary hover:bg-primary/5 active:scale-[0.99] transition-all text-base text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <span className="block font-medium">{opt.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
