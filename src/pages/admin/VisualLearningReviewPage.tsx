/**
 * VISUAL.LEARNING.OS — Admin Review Page (Cut 3).
 *
 * Admin-only Review-Surface. Nutzt eine Fixture aus der Factory, damit
 * Cut 3 ohne Persistenz auskommt. Es findet KEIN Auto-Publish statt und
 * KEINE Mutation beim Rendern. Publishing-CTA ist disabled (Placeholder).
 */
import { useEffect, useMemo } from "react";
import { Helmet } from "react-helmet-async";

import {
  buildVisualLearningArtifact,
  type VisualArtifactFactoryInput,
} from "@/lib/visual-learning-os/visual-artifact-factory";
import { reviewVisualLearningArtifact } from "@/lib/visual-learning-os/visual-artifact-review";
import { createAdminPreviewArtifact } from "@/lib/visual-learning-os/admin-preview";

import VisualArtifactPreview from "@/components/admin/visual-learning/VisualArtifactPreview";
import VisualArtifactReviewPanel from "@/components/admin/visual-learning/VisualArtifactReviewPanel";
import VisualArtifactRubricPanel from "@/components/admin/visual-learning/VisualArtifactRubricPanel";
import VisualArtifactSourceRefsPanel from "@/components/admin/visual-learning/VisualArtifactSourceRefsPanel";

/**
 * ADMIN PREVIEW FIXTURE — bewusst markiert.
 * Repräsentatives Artefakt aus der Factory, deterministisch, kein DB-Zugriff.
 */
const ADMIN_PREVIEW_FIXTURE: VisualArtifactFactoryInput = {
  artifact_id: "fixture-admin-preview-01",
  curriculum_id: "curr-automatenfachmann-2026",
  competence_id: "comp-warenwirtschaft-bestellprozess",
  lesson_id: "lesson-bestellprozess",
  blueprint_id: "bp-bestellprozess-v1",
  purpose: "learn",
  competence_facets: {
    requires_sequence_understanding: true,
    has_common_misconceptions: true,
  },
  source_refs: [
    "ssot://curriculum/curr-automatenfachmann-2026#comp-warenwirtschaft-bestellprozess",
    "ssot://lesson/lesson-bestellprozess",
  ],
  seed_nodes: [
    { id: "n1", role: "process_step", label: "Bedarf erkennen" },
    { id: "n2", role: "process_step", label: "Lieferant auswählen" },
    { id: "n3", role: "process_step", label: "Bestellung auslösen" },
    { id: "n4", role: "rule", label: "Mindestbestand prüfen" },
  ],
  seed_edges: [
    { from: "n1", to: "n2", kind: "precedes" },
    { from: "n2", to: "n3", kind: "precedes" },
    { from: "n3", to: "n4", kind: "requires" },
  ],
  misconceptions: [
    {
      kind: "false_order",
      description: "Bestellung wird vor der Bedarfsermittlung ausgelöst.",
    },
  ],
  title: "Bestellprozess — Ablauf & Pflichtschritte",
  focus_question: "In welcher Reihenfolge läuft ein korrekter Bestellprozess ab?",
};

const FIXTURE_SOURCE_REFS = ADMIN_PREVIEW_FIXTURE.source_refs;

export default function VisualLearningReviewPage() {
  const fixture = useMemo(() => {
    const { artifact, pattern_rationale } =
      buildVisualLearningArtifact(ADMIN_PREVIEW_FIXTURE);
    // Accessibility-Felder nur für Admin-Preview befüllt — keine Persistenz.
    const previewArtifact = {
      ...artifact,
      accessibility: {
        text_summary:
          "Linearer Bestellprozess in vier Schritten mit Pflichtregel zum Mindestbestand.",
        color_independent_labels: true,
        screen_reader_description:
          "Vier Knoten als Prozessschritte, drei gerichtete Kanten plus eine Pflichtregel.",
      },
    };
    const review = reviewVisualLearningArtifact({
      artifact: previewArtifact,
      source_refs: FIXTURE_SOURCE_REFS,
    });
    const preview = createAdminPreviewArtifact(previewArtifact);
    return { artifact: previewArtifact, review, preview, pattern_rationale };
  }, []);

  useEffect(() => {
    // Kein Auto-Publish, kein Schreibzugriff beim Mount.
  }, []);

  if (!fixture.preview.ok) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p className="text-sm text-muted-foreground">Keine Fixture verfügbar.</p>
      </main>
    );
  }

  return (
    <main
      className="mx-auto max-w-6xl space-y-6 p-6"
      data-testid="vlo-review-page"
      aria-label="VISUAL.LEARNING.OS Review"
    >
      <Helmet>
        <title>VISUAL.LEARNING.OS · Review</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <header className="space-y-1 border-b pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Admin · Governance
        </p>
        <h1 className="text-xl font-semibold text-foreground">
          VISUAL.LEARNING.OS — Review (Cut 3)
        </h1>
        <p className="text-sm text-muted-foreground">
          Read-only Admin Preview. Diese Seite zeigt die aktuelle Fixture aus der Visual Artifact
          Factory plus Review-Ergebnis. Es findet kein Publishing statt.
        </p>
        <p
          className="mt-2 inline-block rounded border bg-muted px-2 py-1 text-[11px] font-mono uppercase text-foreground"
          data-testid="vlo-fixture-banner"
        >
          Admin Preview Fixture · keine Persistenz · publishable=false
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <VisualArtifactPreview
            source={fixture.preview.preview}
            sourceRefs={FIXTURE_SOURCE_REFS}
          />
        </div>
        <div className="space-y-4">
          <VisualArtifactReviewPanel review={fixture.review} />
          <VisualArtifactRubricPanel rubric={fixture.artifact.assessment_rubric} />
          <VisualArtifactSourceRefsPanel
            artifact={fixture.artifact}
            sourceRefs={FIXTURE_SOURCE_REFS}
          />
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          Pattern-Begründung: <span className="font-mono">{fixture.pattern_rationale}</span>
        </p>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="cursor-not-allowed rounded border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground"
          data-testid="vlo-publish-cta"
          title="Publishing folgt in separatem Cut"
        >
          Publishing folgt in separatem Cut
        </button>
      </footer>
    </main>
  );
}
