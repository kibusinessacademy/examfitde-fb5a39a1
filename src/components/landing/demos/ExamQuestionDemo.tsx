import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/tracking/track";

const QUESTION = {
  prompt: "Welcher Wert beschreibt die Differenz zwischen Brutto- und Nettoumsatzerlösen?",
  options: [
    { id: "a", text: "Erlösschmälerungen", correct: true },
    { id: "b", text: "Vertriebskosten", correct: false },
    { id: "c", text: "Skonto­zinsen", correct: false },
    { id: "d", text: "Wareneinsatz", correct: false },
  ],
  explanation:
    "Erlösschmälerungen wie Skonti, Boni und Rabatte werden vom Bruttoumsatz abgezogen, um den Nettoumsatz zu ermitteln.",
};

export function ExamQuestionDemo() {
  const [picked, setPicked] = useState<string | null>(null);
  const correctId = QUESTION.options.find((o) => o.correct)!.id;
  const showFeedback = picked !== null;

  return (
    <div
      className="rounded-2xl bg-surface-raised border border-border-subtle p-5 sm:p-6 shadow-elev-2"
      data-demo="exam-question"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
          Beispiel · Prüfungsaufgabe
        </span>
        <span className="text-xs text-text-tertiary">Sofort-Feedback</span>
      </div>

      <h3 className="text-base sm:text-lg font-semibold text-text-primary mb-4">
        {QUESTION.prompt}
      </h3>

      <div className="space-y-2 mb-4">
        {QUESTION.options.map((opt) => {
          const isPicked = picked === opt.id;
          const isCorrect = opt.id === correctId;
          let cls = "border-border bg-surface hover:border-primary";
          if (showFeedback && isCorrect) cls = "border-success bg-success-bg-subtle";
          else if (showFeedback && isPicked && !isCorrect)
            cls = "border-destructive bg-destructive-bg-subtle";
          return (
            <button
              key={opt.id}
              type="button"
              disabled={showFeedback}
              onClick={() => setPicked(opt.id)}
              aria-pressed={isPicked}
              className={`w-full text-left flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${cls}`}
            >
              <span className="flex-1 text-text-primary">{opt.text}</span>
              {showFeedback && isCorrect && <Check className="h-4 w-4 text-success" />}
              {showFeedback && isPicked && !isCorrect && (
                <X className="h-4 w-4 text-destructive" />
              )}
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="sr-only">
        {showFeedback
          ? picked === correctId
            ? "Richtig. " + QUESTION.explanation
            : "Falsch. " + QUESTION.explanation
          : ""}
      </div>

      {showFeedback && (
        <div className="rounded-lg bg-info-bg-subtle border border-info-border p-3 mb-4 text-sm text-info">
          {QUESTION.explanation}
        </div>
      )}

      <Link
        to="/shop"
        onClick={() =>
          trackEvent({
            eventName: "cta_click",
            metadata: { location: "demo_exam_question", target: "/shop" },
          })
        }
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl"
      >
        <Button variant="petrol" size="lg" className="w-full rounded-xl group">
          Mehr Prüfungsfragen trainieren
          <ArrowRight className="h-4 w-4 ml-1 group-hover:translate-x-0.5 transition-transform" />
        </Button>
      </Link>
    </div>
  );
}
