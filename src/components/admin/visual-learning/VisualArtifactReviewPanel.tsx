/**
 * VISUAL.LEARNING.OS — Admin Review Panel (Cut 3).
 *
 * Reiner Darstellungs-Layer. Berechnet KEINE Review-Logik selbst —
 * konsumiert das vom Aufrufer übergebene Ergebnis aus
 * `reviewVisualLearningArtifact()`.
 */
import type { VisualArtifactReviewResult } from "@/lib/visual-learning-os/visual-artifact-review";

export interface VisualArtifactReviewPanelProps {
  review: VisualArtifactReviewResult;
}

const STATUS_LABEL: Record<VisualArtifactReviewResult["status"], string> = {
  approved: "APPROVED",
  needs_revision: "NEEDS REVISION",
  blocked: "BLOCKED",
};

function StatusBadge({ status }: { status: VisualArtifactReviewResult["status"] }) {
  return (
    <span
      className="rounded border bg-muted px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-foreground"
      data-testid="vlo-review-status"
      data-status={status}
      aria-label={`Review-Status ${STATUS_LABEL[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function deriveGateState(
  review: VisualArtifactReviewResult,
  codePrefixes: string[],
): { ok: boolean; hits: typeof review.blockers } {
  const hits = review.blockers.filter((b) =>
    codePrefixes.some((p) => b.code.startsWith(p)),
  );
  return { ok: hits.length === 0, hits };
}

function GateRow({
  label,
  state,
}: {
  label: string;
  state: { ok: boolean; hits: VisualArtifactReviewResult["blockers"] };
}) {
  return (
    <li
      className="flex items-start justify-between gap-3 rounded border bg-card p-2 text-sm"
      data-testid={`vlo-gate-${label.toLowerCase().replace(/\s+/g, "-")}`}
      data-gate-ok={state.ok ? "true" : "false"}
    >
      <span className="font-medium text-foreground">{label}</span>
      <span
        className="rounded border bg-muted px-1.5 py-0.5 text-[11px] font-mono uppercase text-foreground"
        aria-label={state.ok ? "Gate ok" : "Gate failed"}
      >
        {state.ok ? "OK" : `FAIL · ${state.hits.length}`}
      </span>
    </li>
  );
}

export function VisualArtifactReviewPanel({ review }: VisualArtifactReviewPanelProps) {
  const accessibility = deriveGateState(review, [
    "color_only_meaning",
    "accessibility_violation",
    "disallowed_color_token",
    "hex_color_forbidden",
    "tailwind_color_class_forbidden",
  ]);
  const rubric = deriveGateState(review, ["rubric_invalid"]);
  const ssot = deriveGateState(review, [
    "missing_curriculum_id",
    "missing_competence_id",
    "unsupported_status_transition",
    "factory_published_status_forbidden",
  ]);
  const sourceRefs = deriveGateState(review, ["missing_source_refs"]);

  return (
    <section
      className="space-y-3 rounded-lg border bg-background p-4"
      aria-label="Visual Learning Review Panel"
      data-testid="vlo-review-panel"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
        <h2 className="text-sm font-semibold text-foreground">Review-Ergebnis</h2>
        <div className="flex items-center gap-2">
          <StatusBadge status={review.status} />
          <span
            className="rounded border bg-muted px-2 py-1 text-[11px] font-mono uppercase text-foreground"
            data-testid="vlo-review-publishable"
            data-publishable={review.publishable ? "true" : "false"}
          >
            Publishable: {review.publishable ? "ja" : "nein"}
          </span>
        </div>
      </header>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Gates
        </h3>
        <ul className="space-y-1">
          <GateRow label="Accessibility" state={accessibility} />
          <GateRow label="Rubric" state={rubric} />
          <GateRow label="SSOT" state={ssot} />
          <GateRow label="Source Refs" state={sourceRefs} />
        </ul>
      </div>

      <div data-testid="vlo-blockers">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Blocker ({review.blockers.length})
        </h3>
        {review.blockers.length === 0 ? (
          <p className="text-xs text-muted-foreground">Keine Blocker.</p>
        ) : (
          <ul className="space-y-1">
            {review.blockers.map((b, i) => (
              <li
                key={`${b.code}-${i}`}
                className="rounded border bg-card p-2 text-sm"
                data-blocker-code={b.code}
              >
                <span className="font-mono text-[11px] text-muted-foreground">{b.code}</span>
                <span className="mx-2 text-muted-foreground">·</span>
                <span className="text-foreground">{b.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div data-testid="vlo-warnings">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Warnungen ({review.warnings.length})
        </h3>
        {review.warnings.length === 0 ? (
          <p className="text-xs text-muted-foreground">Keine Warnungen.</p>
        ) : (
          <ul className="space-y-1">
            {review.warnings.map((w, i) => (
              <li
                key={`${w.code}-${i}`}
                className="rounded border bg-card p-2 text-sm"
                data-warning-code={w.code}
              >
                <span className="font-mono text-[11px] text-muted-foreground">{w.code}</span>
                <span className="mx-2 text-muted-foreground">·</span>
                <span className="text-foreground">{w.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default VisualArtifactReviewPanel;
