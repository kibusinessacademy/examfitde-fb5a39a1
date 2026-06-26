/**
 * VISUAL.LEARNING.OS — AI Draft Review Panel (Cut 6).
 *
 * Admin-only Darstellung für AI-Draft-Ergebnisse. Pure Präsentation.
 * Kein LLM-Call. Kein Fetch. Kein Supabase. Keine Service Keys.
 * Keine eigene Review-Logik. Keine Pattern-Auswahl. Keine Factory im Render.
 * Drafts werden NICHT an Learner-Komponenten weitergegeben.
 */
import type { VisualAiDraftResult } from "@/lib/visual-learning-os/ai-draft-contracts";

export interface VisualAiDraftReviewPanelProps {
  draft: VisualAiDraftResult;
}

export function VisualAiDraftReviewPanel({ draft }: VisualAiDraftReviewPanelProps) {
  const status = draft.admin_preview_ready ? "READY_FOR_ADMIN_REVIEW" : "BLOCKED";
  const reviewStatus = draft.review_result?.status ?? "n/a";

  return (
    <section
      className="space-y-3 rounded-lg border bg-background p-4"
      aria-label="Visual Learning AI Draft Review Panel"
      data-testid="vlo-ai-draft-panel"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            AI Draft — Admin Review erforderlich
          </p>
          <h2 className="text-sm font-semibold text-foreground">
            VISUAL.LEARNING.OS · AI Draft
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rounded border bg-muted px-2 py-1 text-[11px] font-mono uppercase text-foreground"
            data-testid="vlo-ai-draft-status"
            data-status={status}
          >
            {status}
          </span>
          <span
            className="rounded border bg-muted px-2 py-1 text-[11px] font-mono uppercase text-foreground"
            data-testid="vlo-ai-draft-review-status"
            data-review-status={reviewStatus}
          >
            Review: {reviewStatus}
          </span>
          <span
            className="rounded border bg-muted px-2 py-1 text-[11px] font-mono uppercase text-foreground"
            data-testid="vlo-ai-draft-publishable"
            data-publishable="false"
          >
            Publishable: nein
          </span>
          <span
            className="rounded border bg-muted px-2 py-1 text-[11px] font-mono uppercase text-foreground"
            data-testid="vlo-ai-draft-learner-visible"
            data-learner-visible="false"
          >
            Learner-sichtbar: nein
          </span>
        </div>
      </header>

      <p
        className="rounded border bg-muted p-2 text-xs text-foreground"
        data-testid="vlo-ai-draft-admin-notice"
      >
        AI Draft — Admin Review erforderlich. Diese Daten sind nicht für Lernende sichtbar
        und werden ohne expliziten Admin-Approval-Schritt nicht veröffentlicht.
      </p>

      {draft.normalized_draft && (
        <div
          className="grid grid-cols-3 gap-2 text-xs"
          data-testid="vlo-ai-draft-counts"
        >
          <div className="rounded border bg-card p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Nodes</div>
            <div className="font-mono text-foreground">
              {draft.normalized_draft.nodes.length} / {draft.normalized_draft.raw_counts.nodes}
            </div>
          </div>
          <div className="rounded border bg-card p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Edges</div>
            <div className="font-mono text-foreground">
              {draft.normalized_draft.edges.length} / {draft.normalized_draft.raw_counts.edges}
            </div>
          </div>
          <div className="rounded border bg-card p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Misconceptions</div>
            <div className="font-mono text-foreground">
              {draft.normalized_draft.misconceptions.length} /{" "}
              {draft.normalized_draft.raw_counts.misconceptions}
            </div>
          </div>
        </div>
      )}

      <div data-testid="vlo-ai-draft-blockers">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Blocker ({draft.blockers.length})
        </h3>
        {draft.blockers.length === 0 ? (
          <p className="text-xs text-muted-foreground">Keine Blocker.</p>
        ) : (
          <ul className="space-y-1">
            {draft.blockers.map((b, i) => (
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

      <div data-testid="vlo-ai-draft-warnings">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Warnungen ({draft.warnings.length})
        </h3>
        {draft.warnings.length === 0 ? (
          <p className="text-xs text-muted-foreground">Keine Warnungen.</p>
        ) : (
          <ul className="space-y-1">
            {draft.warnings.map((w, i) => (
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

      {draft.normalized_draft &&
        draft.normalized_draft.discarded.reasons.length > 0 && (
          <div data-testid="vlo-ai-draft-discarded">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Verworfene Elemente
            </h3>
            <ul className="flex flex-wrap gap-1">
              {draft.normalized_draft.discarded.reasons.map((r) => (
                <li
                  key={r}
                  className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
                >
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-[11px] text-muted-foreground">
          AI darf nur Draft liefern. Approval, Persistenz und Publishing erfolgen in
          separaten Cuts mit explizitem Admin-Intent.
        </p>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="cursor-not-allowed rounded border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground"
          data-testid="vlo-ai-draft-publish-cta"
          title="Publishing folgt in separatem Cut"
        >
          Publishing folgt in separatem Cut
        </button>
      </footer>
    </section>
  );
}

export default VisualAiDraftReviewPanel;
