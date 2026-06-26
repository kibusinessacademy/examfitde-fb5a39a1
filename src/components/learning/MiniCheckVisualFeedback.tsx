/**
 * VISUAL.LEARNING.OS — MiniCheck Visual Feedback Renderer (Cut 5).
 *
 * Reiner Learner Renderer für visuelle Fehlerbilder nach MiniCheck-Abgabe.
 *
 * HARTE REGELN:
 * - Keine Supabase-Aufrufe, kein fetch, keine Mutationen.
 * - Keine Pattern-/Factory-/Review-Aufrufe.
 * - Keine Admin-/Draft-/Review-Begriffe.
 * - Keine Mastery-/Prüfungsreife-Aussage.
 * - Empty State läuft sauber.
 * - Farbe nie ohne Label/Text.
 */
import type {
  MiniCheckVisualFeedbackItem,
  MiniCheckVisualFeedbackResult,
} from "@/lib/visual-learning-os/minicheck-visual-feedback";
import { isMiniCheckVisualFeedbackEmpty } from "@/lib/visual-learning-os/minicheck-visual-feedback";
import { MISCONCEPTION_BADGE } from "@/lib/visual-learning-os/visual-grammar";

export interface MiniCheckVisualFeedbackProps {
  result: MiniCheckVisualFeedbackResult;
  /**
   * Steuert Sichtbarkeit. Vor MiniCheck-Abgabe MUSS `false` übergeben werden.
   */
  isSubmitted: boolean;
}

function FeedbackItemCard({ item }: { item: MiniCheckVisualFeedbackItem }) {
  const badge = item.misconception_label
    ? MISCONCEPTION_BADGE[item.misconception_label as keyof typeof MISCONCEPTION_BADGE]
    : null;
  return (
    <article
      className="space-y-3 rounded-lg border bg-background p-4"
      data-testid="mcvf-item"
      data-question-id={item.question_id}
      data-severity={item.severity}
      aria-label={`Visuelles Fehlerbild zu Frage ${item.question_order}`}
    >
      <header className="flex flex-wrap items-center gap-2 border-b pb-2">
        <span
          className="rounded border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
          aria-label={`Frage ${item.question_order}`}
        >
          Frage {item.question_order}
        </span>
        {badge ? (
          <span
            className="rounded border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
            aria-label={`Typischer Fehler: ${badge.label}`}
            data-testid="mcvf-misconception-label"
          >
            Typischer Fehler: {badge.label}
          </span>
        ) : null}
        {item.artifact_title ? (
          <span className="text-xs text-muted-foreground">{item.artifact_title}</span>
        ) : null}
      </header>

      {item.misconception_description ? (
        <p className="text-sm text-foreground" data-testid="mcvf-misconception-desc">
          {item.misconception_description}
        </p>
      ) : null}

      {item.relevant_nodes.length > 0 ? (
        <div>
          <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Relevante Elemente
          </h5>
          <ul className="space-y-1 text-sm">
            {item.relevant_nodes.map((n) => (
              <li
                key={n.id}
                className="flex items-center gap-2 rounded border bg-card px-2 py-1"
                data-testid="mcvf-node"
              >
                <span className="rounded border bg-muted px-1 py-0.5 text-[10px] font-medium">
                  {n.role}
                </span>
                <span>{n.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {item.relevant_edges.length > 0 ? (
        <div>
          <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Beziehungen
          </h5>
          <ul className="space-y-1 text-sm">
            {item.relevant_edges.map((e, i) => (
              <li
                key={`${e.from}-${e.to}-${i}`}
                className="flex items-center gap-2 rounded border bg-card px-2 py-1"
                data-testid="mcvf-edge"
              >
                <span className="font-mono text-xs text-muted-foreground">{e.from}</span>
                <span className="rounded border bg-muted px-1 py-0.5 text-[10px]">
                  {e.label ?? e.kind}
                </span>
                <span className="font-mono text-xs text-muted-foreground">→ {e.to}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p
        className="rounded border bg-muted/30 p-2 text-sm text-foreground"
        data-testid="mcvf-repetition-hint"
      >
        {item.repetition_hint}
      </p>

      {item.source_refs.length > 0 ? (
        <details
          className="rounded border bg-muted/20 p-2 text-xs"
          data-testid="mcvf-source-refs"
        >
          <summary className="cursor-pointer font-medium">Quellen</summary>
          <ul className="mt-1 space-y-1">
            {item.source_refs.map((ref, i) => (
              <li key={i} className="font-mono text-foreground">
                {ref}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

export function MiniCheckVisualFeedback({
  result,
  isSubmitted,
}: MiniCheckVisualFeedbackProps) {
  if (!isSubmitted) return null;
  if (!result.learner_visible) return null;

  const empty = isMiniCheckVisualFeedbackEmpty(result);

  return (
    <section
      className="space-y-4 rounded-lg border bg-background p-4"
      data-testid="mcvf-root"
      aria-label="Dein visuelles Fehlerbild"
    >
      <header className="border-b pb-2">
        <h3 className="text-sm font-semibold text-foreground">Dein visuelles Fehlerbild</h3>
        <p className="text-xs text-muted-foreground">
          Diese Struktur zeigt dir, welcher Zusammenhang bei der Aufgabe wichtig war.
        </p>
      </header>

      {empty ? (
        <p
          className="rounded border bg-muted/30 p-3 text-sm text-muted-foreground"
          data-testid="mcvf-empty"
        >
          Für deine Antworten liegt noch kein visuelles Fehlerbild vor.
        </p>
      ) : (
        <>
          {result.items.length > 0 ? (
            <div className="space-y-3" data-testid="mcvf-items">
              {result.items.map((it) => (
                <FeedbackItemCard
                  key={`${it.question_id}-${it.misconception_id ?? ""}-${it.visual_artifact_id ?? ""}`}
                  item={it}
                />
              ))}
            </div>
          ) : null}

          {result.positive_signals.length > 0 ? (
            <div
              className="rounded border bg-muted/20 p-3 text-sm text-foreground"
              data-testid="mcvf-positive"
            >
              <p className="font-medium">Diese Struktur hast du sicher erkannt.</p>
              <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                {result.positive_signals.map((p) => (
                  <li key={p.question_id}>Frage {p.question_order}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export default MiniCheckVisualFeedback;
