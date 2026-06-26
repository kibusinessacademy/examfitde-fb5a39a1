/**
 * VISUAL.LEARNING.OS — Learner Visual Block (Cut 4).
 *
 * Reiner Renderer für Lernende.
 *
 * HARTE REGELN:
 * - Keine Supabase-Aufrufe, kein fetch, keine Mutationen.
 * - Keine Pattern-Auswahl, keine Factory-, keine Review-Aufrufe.
 * - Keine Admin-Badges, keine Draft-Hinweise.
 * - Empty State läuft sauber durch.
 * - Farbe nie als alleinige Bedeutung (Label/Icon/Shape begleiten).
 */
import type { ReactNode } from "react";
import type {
  PublishedVisualArtifact,
  VisualEdge,
  VisualMisconception,
  VisualNode,
} from "@/lib/visual-learning-os/contracts";
import {
  EDGE_GRAMMAR,
  MISCONCEPTION_BADGE,
  NODE_GRAMMAR,
} from "@/lib/visual-learning-os/visual-grammar";
import {
  isVisualLessonBlockEmpty,
  type VisualLessonBlock,
  type VisualLessonStepPlacement,
} from "@/lib/visual-learning-os/lesson-visual-block";

export interface VisualLearningBlockProps {
  block: VisualLessonBlock;
  /** Optionale, bereits validierte Source-Refs — niemals aus DB im Component lesen. */
  sourceRefs?: string[];
}

const PLACEMENT_COPY: Record<
  VisualLessonStepPlacement,
  { headline: string; intro: string }
> = {
  entry: {
    headline: "Einstieg",
    intro: "Orientiere dich am Gesamtbild.",
  },
  understand: {
    headline: "Verstehen",
    intro: "Erkenne die Zusammenhänge.",
  },
  apply: {
    headline: "Anwenden",
    intro: "Nutze die Struktur zur Lösung.",
  },
  repeat: {
    headline: "Wiederholen",
    intro: "Prüfe die wichtigsten Beziehungen.",
  },
  mini_check_context: {
    headline: "Prüfungsvorbereitung",
    intro: "Achte auf typische Fehler.",
  },
};

function NodeChip({ node }: { node: VisualNode }) {
  const rule = NODE_GRAMMAR[node.role];
  return (
    <li
      className="flex items-start gap-2 rounded-md border bg-card p-3"
      data-testid="vlo-learner-node"
      data-role={node.role}
      data-shape={rule?.shape}
      aria-label={node.aria_label ?? node.label}
    >
      <span
        className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-sm border bg-muted px-1 text-[10px] font-medium text-muted-foreground"
        aria-hidden="true"
      >
        {rule?.badge_label ?? node.role}
      </span>
      <div className="flex-1">
        <div className="text-sm font-medium text-foreground">{node.label}</div>
      </div>
    </li>
  );
}

function EdgeRow({ edge }: { edge: VisualEdge }) {
  const rule = EDGE_GRAMMAR[edge.kind];
  return (
    <li
      className="flex items-center gap-2 rounded-md border bg-card p-2 text-sm"
      data-testid="vlo-learner-edge"
      data-kind={edge.kind}
    >
      <span className="font-mono text-xs text-muted-foreground">{edge.from}</span>
      <span
        className="rounded border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
        aria-label={`Beziehung ${edge.kind}`}
      >
        {edge.label ?? rule?.default_label ?? edge.kind}
      </span>
      <span className="font-mono text-xs text-muted-foreground">→ {edge.to}</span>
    </li>
  );
}

function MisconceptionItem({ m }: { m: VisualMisconception }) {
  const badge = MISCONCEPTION_BADGE[m.kind];
  return (
    <li
      className="flex items-start gap-2 rounded-md border bg-card p-2 text-sm"
      data-testid="vlo-learner-misconception"
      data-kind={m.kind}
    >
      <span
        className="rounded border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
        aria-label={badge?.label ?? m.kind}
      >
        {badge?.label ?? m.kind}
      </span>
      <span className="text-sm text-foreground">{m.description}</span>
    </li>
  );
}

function ArtifactCard({
  artifact,
  variant,
}: {
  artifact: PublishedVisualArtifact;
  variant: "primary" | "supporting";
}): ReactNode {
  return (
    <article
      className="space-y-3 rounded-lg border bg-background p-4"
      data-testid={
        variant === "primary"
          ? "vlo-learner-primary"
          : "vlo-learner-supporting"
      }
      data-artifact-id={artifact.id}
      aria-label={artifact.title}
    >
      <header className="border-b pb-2">
        <h4 className="text-sm font-semibold text-foreground">{artifact.title}</h4>
        <p className="text-xs text-muted-foreground">{artifact.focus_question}</p>
      </header>

      <div>
        <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Elemente
        </h5>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {artifact.nodes.map((n) => (
            <NodeChip key={n.id} node={n} />
          ))}
        </ul>
      </div>

      {artifact.edges.length > 0 ? (
        <div>
          <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Beziehungen
          </h5>
          <ul className="space-y-1">
            {artifact.edges.map((e, i) => (
              <EdgeRow key={`${e.from}-${e.to}-${e.kind}-${i}`} edge={e} />
            ))}
          </ul>
        </div>
      ) : null}

      {artifact.misconceptions && artifact.misconceptions.length > 0 ? (
        <div data-testid="vlo-learner-misconceptions">
          <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Typische Fehler
          </h5>
          <ul className="space-y-1">
            {artifact.misconceptions.map((m, i) => (
              <MisconceptionItem key={i} m={m} />
            ))}
          </ul>
        </div>
      ) : null}

      <details
        className="rounded border bg-muted/30 p-2 text-xs text-foreground"
        data-testid="vlo-learner-text-alternative"
      >
        <summary className="cursor-pointer font-medium">
          Textalternative
        </summary>
        <p className="mt-2 whitespace-pre-line text-muted-foreground">
          {artifact.accessibility.text_summary}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {artifact.accessibility.screen_reader_description}
        </p>
      </details>
    </article>
  );
}

function Legend() {
  return (
    <div data-testid="vlo-learner-legend">
      <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Legende
      </h5>
      <ul className="grid grid-cols-2 gap-1 text-xs text-muted-foreground md:grid-cols-3">
        {Object.entries(NODE_GRAMMAR).map(([role, rule]) => (
          <li key={role} className="flex items-center gap-2">
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm border bg-muted px-1 text-[10px]">
              {rule.badge_label ?? role}
            </span>
            <span className="font-mono">{role}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VisualLearningBlock({ block, sourceRefs }: VisualLearningBlockProps) {
  const copy = PLACEMENT_COPY[block.placement];

  if (isVisualLessonBlockEmpty(block)) {
    return (
      <section
        className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground"
        data-testid="vlo-learner-empty"
        data-placement={block.placement}
        aria-label="Visuelle Lernstruktur nicht verfügbar"
      >
        <p className="font-medium text-foreground">{copy.headline}</p>
        <p>Für diese Lektion ist noch keine visuelle Struktur verfügbar.</p>
      </section>
    );
  }

  return (
    <section
      className="space-y-4 rounded-lg border bg-background p-4"
      data-testid="vlo-learner-block"
      data-placement={block.placement}
      aria-label={`Visuelle Lernhilfe: ${copy.headline}`}
    >
      <header className="border-b pb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {copy.headline}
        </p>
        <p className="text-sm text-foreground">{copy.intro}</p>
      </header>

      {block.primary_visual ? (
        <ArtifactCard artifact={block.primary_visual} variant="primary" />
      ) : null}

      {block.supporting_visuals.length > 0 ? (
        <div className="space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Weitere Strukturen
          </h4>
          {block.supporting_visuals.map((a) => (
            <ArtifactCard key={a.id} artifact={a} variant="supporting" />
          ))}
        </div>
      ) : null}

      <Legend />

      {sourceRefs && sourceRefs.length > 0 ? (
        <div data-testid="vlo-learner-source-refs">
          <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Quellen
          </h5>
          <ul className="space-y-1 text-xs">
            {sourceRefs.map((ref, i) => (
              <li
                key={i}
                className="rounded border bg-muted/40 px-2 py-1 font-mono text-foreground"
              >
                {ref}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export default VisualLearningBlock;
