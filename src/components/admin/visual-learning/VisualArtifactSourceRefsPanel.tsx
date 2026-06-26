/**
 * VISUAL.LEARNING.OS — Admin Source-Refs Panel (Cut 3).
 *
 * Zeigt SSOT-Bindungen (curriculum_id, competence_id, lesson_id, blueprint_id)
 * und Source-Refs. Markiert fehlende Pflichtbindungen sichtbar. Lädt nichts nach.
 */
import type { VisualLearningArtifact } from "@/lib/visual-learning-os/contracts";

export interface VisualArtifactSourceRefsPanelProps {
  artifact: Pick<
    VisualLearningArtifact,
    "curriculum_id" | "competence_id" | "lesson_id" | "blueprint_id"
  >;
  sourceRefs?: string[];
}

function RefRow({
  label,
  value,
  required,
}: {
  label: string;
  value: string | undefined;
  required: boolean;
}) {
  const missing = !value?.trim();
  return (
    <li
      className="flex items-center justify-between gap-3 rounded border bg-card p-2 text-sm"
      data-testid={`vlo-ref-${label.toLowerCase().replace(/\s+/g, "-")}`}
      data-missing={missing ? "true" : "false"}
      data-required={required ? "true" : "false"}
    >
      <span className="font-medium text-foreground">{label}</span>
      {missing ? (
        <span
          className="rounded border bg-muted px-1.5 py-0.5 text-[11px] font-mono uppercase text-foreground"
          aria-label={`${label} fehlt`}
        >
          {required ? "FEHLT · Pflicht" : "—"}
        </span>
      ) : (
        <span className="font-mono text-xs text-foreground">{value}</span>
      )}
    </li>
  );
}

export function VisualArtifactSourceRefsPanel({
  artifact,
  sourceRefs,
}: VisualArtifactSourceRefsPanelProps) {
  return (
    <section
      className="space-y-3 rounded-lg border bg-background p-4"
      aria-label="Visual Learning Source Refs Panel"
      data-testid="vlo-source-refs-panel"
    >
      <header className="border-b pb-2">
        <h2 className="text-sm font-semibold text-foreground">SSOT-Bindungen</h2>
        <p className="text-xs text-muted-foreground">
          Pflicht: curriculum_id + competence_id. Pro fachlicher Aussage mind. eine source_ref.
        </p>
      </header>

      <ul className="space-y-1">
        <RefRow label="curriculum_id" value={artifact.curriculum_id} required />
        <RefRow label="competence_id" value={artifact.competence_id} required />
        <RefRow label="lesson_id" value={artifact.lesson_id} required={false} />
        <RefRow label="blueprint_id" value={artifact.blueprint_id} required={false} />
      </ul>

      <div data-testid="vlo-source-refs-list">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Source-Refs ({sourceRefs?.length ?? 0})
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
          <p
            className="rounded border bg-muted p-2 text-xs text-foreground"
            data-testid="vlo-source-refs-missing"
          >
            Keine Source-Refs. Pflicht für jede fachliche Aussage.
          </p>
        )}
      </div>
    </section>
  );
}

export default VisualArtifactSourceRefsPanel;
