/**
 * VISUAL.LEARNING.OS — Admin Preview Renderer (Cut 3).
 *
 * Reiner Renderer. Keine DB-Zugriffe, keine Pattern-Auswahl, keine Review-
 * Berechnung. Nimmt entweder eine PublishedVisualArtifact-Projektion oder
 * ein AdminPreviewArtifact und stellt Nodes, Edges, Misconceptions, Legende
 * und Source-Refs sichtbar dar. Jede farbliche Bedeutung wird zusätzlich
 * durch Label/Icon/Shape getragen (WCAG 1.4.1).
 */
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
  isAdminPreviewArtifact,
  type AdminPreviewArtifact,
} from "@/lib/visual-learning-os/admin-preview";

export interface VisualArtifactPreviewProps {
  source: PublishedVisualArtifact | AdminPreviewArtifact;
  /** Optionale Quellenliste (sichtbare Referenzen). */
  sourceRefs?: string[];
}

function unwrap(source: VisualArtifactPreviewProps["source"]) {
  if (isAdminPreviewArtifact(source)) {
    return { artifact: source.artifact, isAdminPreview: true as const };
  }
  return { artifact: source, isAdminPreview: false as const };
}

function NodeChip({ node }: { node: VisualNode }) {
  const rule = NODE_GRAMMAR[node.role];
  return (
    <li
      className="flex items-start gap-2 rounded-md border bg-card p-3"
      data-testid="vlo-node"
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
        <div className="text-xs text-muted-foreground">
          Rolle: <span className="font-mono">{node.role}</span>
          {rule?.shape ? <> · Form: <span className="font-mono">{rule.shape}</span></> : null}
          {rule?.icon ? <> · Icon: <span className="font-mono">{rule.icon}</span></> : null}
        </div>
      </div>
    </li>
  );
}

function EdgeRow({ edge }: { edge: VisualEdge }) {
  const rule = EDGE_GRAMMAR[edge.kind];
  return (
    <li
      className="flex items-center gap-2 rounded-md border bg-card p-2 text-sm"
      data-testid="vlo-edge"
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
      <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
        {rule?.line}
      </span>
    </li>
  );
}

function MisconceptionBadge({ m }: { m: VisualMisconception }) {
  const badge = MISCONCEPTION_BADGE[m.kind];
  return (
    <li
      className="flex items-start gap-2 rounded-md border bg-card p-2 text-sm"
      data-testid="vlo-misconception"
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

export function VisualArtifactPreview({ source, sourceRefs }: VisualArtifactPreviewProps) {
  const { artifact, isAdminPreview } = unwrap(source);

  return (
    <section
      className="space-y-4 rounded-lg border bg-background p-4"
      aria-label="Visual Learning Artifact Preview"
      data-testid="vlo-preview"
      data-admin-preview={isAdminPreview ? "true" : "false"}
      data-status={artifact.status}
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b pb-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{artifact.title}</h2>
          <p className="text-xs text-muted-foreground">{artifact.focus_question}</p>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            Typ: <span className="font-mono">{artifact.artifact_type}</span> · Zweck:{" "}
            <span className="font-mono">{artifact.purpose}</span> · Status:{" "}
            <span className="font-mono">{artifact.status}</span>
          </p>
        </div>
        {isAdminPreview ? (
          <span
            className="rounded border bg-muted px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-foreground"
            data-testid="vlo-admin-preview-badge"
          >
            Admin Preview · nicht publishable
          </span>
        ) : (
          <span
            className="rounded border bg-muted px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-foreground"
            data-testid="vlo-published-badge"
          >
            Published Projection
          </span>
        )}
      </header>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Nodes ({artifact.nodes.length})
        </h3>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {artifact.nodes.map((n) => (
            <NodeChip key={n.id} node={n} />
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Edges ({artifact.edges.length})
        </h3>
        <ul className="space-y-1">
          {artifact.edges.map((e, i) => (
            <EdgeRow key={`${e.from}-${e.to}-${e.kind}-${i}`} edge={e} />
          ))}
        </ul>
      </div>

      {artifact.misconceptions && artifact.misconceptions.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Misconceptions ({artifact.misconceptions.length})
          </h3>
          <ul className="space-y-1">
            {artifact.misconceptions.map((m, i) => (
              <MisconceptionBadge key={i} m={m} />
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Legende
        </h3>
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

      <div data-testid="vlo-source-refs">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Source-Refs
        </h3>
        {sourceRefs && sourceRefs.length > 0 ? (
          <ul className="space-y-1 text-xs">
            {sourceRefs.map((ref, i) => (
              <li key={i} className="rounded border bg-muted/40 px-2 py-1 font-mono text-foreground">
                {ref}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Keine Source-Refs übergeben.</p>
        )}
      </div>

      <footer className="border-t pt-3 text-[11px] text-muted-foreground">
        Accessibility: {artifact.accessibility.text_summary || "—"}
      </footer>
    </section>
  );
}

export default VisualArtifactPreview;
