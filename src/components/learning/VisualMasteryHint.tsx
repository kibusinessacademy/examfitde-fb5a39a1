/**
 * Cut 8 — Learner-safe Visual Mastery Hint Renderer.
 *
 * Pure presentational. Keine Supabase-/Fetch-Aufrufe. Keine Diagnose.
 * Kein Score-Gewicht, keine Prüfungsreife-Aussage.
 */
import * as React from "react";
import type { VisualMasteryLearnerProjection } from "@/lib/visual-learning-os/mastery-signals";

export interface VisualMasteryHintProps {
  projection?: VisualMasteryLearnerProjection | null;
  className?: string;
}

export const VisualMasteryHint: React.FC<VisualMasteryHintProps> = ({
  projection,
  className,
}) => {
  const hasHints = !!projection && projection.learner_visible && projection.hints.length > 0;

  return (
    <section
      data-testid="visual-mastery-hint"
      className={className ?? "rounded-lg border border-border bg-card p-4"}
      aria-label="Dein visueller Lernhinweis"
    >
      <h3 className="text-sm font-semibold text-foreground">
        Dein visueller Lernhinweis
      </h3>
      {hasHints ? (
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          {projection!.hints.map((h, i) => (
            <li key={`${h.kind}-${i}`} data-testid={`vlo-mastery-hint-${h.kind}`}>
              {h.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Aktuell liegen noch keine visuellen Lernhinweise vor.
        </p>
      )}
    </section>
  );
};

export default VisualMasteryHint;
