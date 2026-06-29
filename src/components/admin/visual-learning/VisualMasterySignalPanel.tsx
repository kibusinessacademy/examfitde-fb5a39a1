/**
 * Cut 8 — Admin Visual Mastery Signal Panel.
 *
 * Reines Renderer-Component. Keine Mutationen, keine AI-Aufrufe,
 * keine eigene Signalberechnung.
 */
import * as React from "react";
import type { VisualMasteryAdminProjection } from "@/lib/visual-learning-os/mastery-signals";

export interface VisualMasterySignalPanelProps {
  projection: VisualMasteryAdminProjection;
  className?: string;
}

export const VisualMasterySignalPanel: React.FC<VisualMasterySignalPanelProps> = ({
  projection,
  className,
}) => {
  return (
    <section
      data-testid="visual-mastery-signal-panel"
      className={className ?? "rounded-lg border border-border bg-card p-4"}
      aria-label="Visual Mastery Signal Panel"
    >
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Visual Mastery Signale
          </h3>
          <p className="text-xs text-muted-foreground">
            Kompetenz: <code>{projection.competence_id}</code> · Curriculum:{" "}
            <code>{projection.curriculum_id}</code>
          </p>
        </div>
        <span
          data-testid="vlo-mastery-supplemental-note"
          className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
        >
          ergänzendes Signal
        </span>
      </header>

      <p className="mt-2 text-xs text-muted-foreground">{projection.note}</p>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
        {Object.entries(projection.totals).map(([kind, count]) => (
          <div key={kind} className="rounded border border-border p-2">
            <dt className="font-medium text-foreground">{kind}</dt>
            <dd className="text-muted-foreground">{count}</dd>
          </div>
        ))}
      </dl>

      {projection.warnings.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold text-foreground">Warnings</h4>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {projection.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`} data-testid={`vlo-mastery-warning-${w.code}`}>
                <code>{w.code}</code> — {w.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {projection.blockers.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold text-destructive">Blockers</h4>
          <ul className="mt-1 space-y-0.5 text-xs text-destructive">
            {projection.blockers.map((b, i) => (
              <li key={`${b.code}-${i}`}>
                <code>{b.code}</code> — {b.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3">
        <h4 className="text-xs font-semibold text-foreground">Signale</h4>
        <ul className="mt-1 divide-y divide-border text-xs">
          {projection.signals.map((s, i) => (
            <li
              key={`${s.signal_kind}-${s.misconception_id ?? "x"}-${i}`}
              className="py-2"
              data-testid={`vlo-mastery-signal-${s.signal_kind}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{s.signal_kind}</span>
                <span className="text-muted-foreground">
                  confidence: {s.confidence}
                </span>
                {s.misconception_id && (
                  <span className="text-muted-foreground">
                    misconception: <code>{s.misconception_id}</code>
                  </span>
                )}
                {s.visual_artifact_id && (
                  <span className="text-muted-foreground">
                    artifact: <code>{s.visual_artifact_id}</code>
                  </span>
                )}
              </div>
              <p className="mt-1 text-muted-foreground">{s.reason}</p>
              {s.evidence.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {s.evidence.map((e, j) => (
                    <li key={j}>
                      <code>{e.source}</code>
                      {e.question_id ? ` · q=${e.question_id}` : ""}
                      {e.detail ? ` · ${e.detail}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default VisualMasterySignalPanel;
