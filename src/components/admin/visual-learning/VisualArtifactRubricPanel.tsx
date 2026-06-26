/**
 * VISUAL.LEARNING.OS — Admin Rubric Panel (Cut 3).
 *
 * Zeigt die Gewichtungen einer Rubric. Berechnet keine Scoring-Logik —
 * Validierung erfolgt ausschließlich über `validateRubric()` aus
 * `src/lib/visual-learning-os/visual-assessment.ts`.
 */
import type { VisualAssessmentRubric } from "@/lib/visual-learning-os/contracts";
import { validateRubric } from "@/lib/visual-learning-os/visual-assessment";

export interface VisualArtifactRubricPanelProps {
  rubric: VisualAssessmentRubric | undefined | null;
}

export function VisualArtifactRubricPanel({ rubric }: VisualArtifactRubricPanelProps) {
  if (!rubric) {
    return (
      <section
        className="rounded-lg border bg-background p-4"
        data-testid="vlo-rubric-panel"
        data-rubric-present="false"
        aria-label="Visual Learning Rubric Panel"
      >
        <h2 className="mb-1 text-sm font-semibold text-foreground">Rubric</h2>
        <p className="text-xs text-muted-foreground">Keine Rubric hinterlegt.</p>
      </section>
    );
  }

  const validation = validateRubric(rubric);
  const sum = rubric.checks.reduce((s, c) => s + c.weight, 0);

  return (
    <section
      className="space-y-3 rounded-lg border bg-background p-4"
      data-testid="vlo-rubric-panel"
      data-rubric-present="true"
      data-rubric-valid={validation.ok ? "true" : "false"}
      aria-label="Visual Learning Rubric Panel"
    >
      <header className="flex items-center justify-between border-b pb-2">
        <h2 className="text-sm font-semibold text-foreground">Rubric</h2>
        <span
          className="rounded border bg-muted px-2 py-1 text-[11px] font-mono uppercase text-foreground"
          data-testid="vlo-rubric-sum"
          data-sum={sum}
          data-sum-valid={sum === 100 ? "true" : "false"}
          aria-label={`Gewichtssumme ${sum}`}
        >
          Σ {sum} {sum === 100 ? "OK" : "INVALID"}
        </span>
      </header>

      <ul className="space-y-1">
        {rubric.checks.map((c, i) => (
          <li
            key={`${c.kind}-${i}`}
            className="flex items-center justify-between rounded border bg-card p-2 text-sm"
            data-testid="vlo-rubric-check"
            data-check-kind={c.kind}
          >
            <span className="font-mono text-xs text-foreground">{c.kind}</span>
            <span className="rounded border bg-muted px-1.5 py-0.5 text-[11px] font-mono text-foreground">
              {c.weight}%
            </span>
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        Passing Score: <span className="font-mono">{rubric.passing_score}</span>
      </p>

      {!validation.ok ? (
        <p
          className="rounded border bg-muted p-2 text-xs text-foreground"
          data-testid="vlo-rubric-invalid-reason"
        >
          Ungültig: {validation.reason}
        </p>
      ) : null}
    </section>
  );
}

export default VisualArtifactRubricPanel;
