import { QuizRiskBadge } from "./QuizRiskBadge";
import { WeaknessList } from "./WeaknessList";
import { ResultCtaBlock } from "./ResultCtaBlock";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import { CATEGORY_LABELS, classifyScore, type CategoryKey } from "./types";

interface Props {
  score: number;
  weakest: CategoryKey[];
  contextLabel?: string | null;
  bundleTitle?: string | null;
  primaryHref: string;
  secondaryHref: string;
  onPrimary: () => void;
  onSecondary: () => void;
  onWeaknessClick?: (cat: CategoryKey) => void;
  onReset: () => void;
}

export function QuizResultScreen({
  score,
  weakest,
  contextLabel,
  bundleTitle,
  primaryHref,
  secondaryHref,
  onPrimary,
  onSecondary,
  onWeaknessClick,
  onReset,
}: Props) {
  const meta = classifyScore(score);
  const focusCategory = weakest[0];

  return (
    <div
      className="rounded-2xl p-6 sm:p-8 bg-surface-raised border border-border-subtle shadow-elev-2 space-y-6"
      data-testid="quiz-result"
    >
      <header className="space-y-3 text-center" aria-live="polite" aria-atomic="true">
        <QuizRiskBadge meta={meta} />
        <h1 className="text-3xl sm:text-4xl font-bold text-text-primary">
          Dein Prüfungsreife-Score: <span className="text-primary">{score}/100</span>
        </h1>
        <p className="text-text-secondary">{meta.headline}</p>
        {contextLabel && (
          <p className="text-xs text-text-tertiary">Auswertung für: {contextLabel}</p>
        )}
      </header>

      <div className="h-2 rounded-full bg-surface-sunken overflow-hidden">
        <div
          className="h-full bg-primary transition-[width] duration-500"
          style={{ width: `${score}%` }}
        />
      </div>

      <WeaknessList weakest={weakest} bundleHref={primaryHref} onItemClick={onWeaknessClick} />

      {focusCategory && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-1">Empfohlener Lernfokus</h3>
          <p className="text-sm text-text-secondary">
            Starte mit <strong className="text-text-primary">{CATEGORY_LABELS[focusCategory]}</strong> —
            dort holst du am schnellsten Punkte.
          </p>
        </div>
      )}

      <ResultCtaBlock
        primaryHref={primaryHref}
        secondaryHref={secondaryHref}
        secondaryLabel={contextLabel ? "Beruf wechseln" : "Berufe ansehen"}
        bundleTitle={bundleTitle ?? null}
        onPrimary={onPrimary}
        onSecondary={onSecondary}
      />

      <div className="text-center">
        <Button variant="ghost" size="sm" onClick={onReset} className="text-text-tertiary">
          <RotateCcw className="h-4 w-4 mr-2" />
          Test wiederholen
        </Button>
      </div>
    </div>
  );
}
