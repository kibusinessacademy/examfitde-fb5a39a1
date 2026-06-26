// @vitest-environment happy-dom
/**
 * VISUAL.LEARNING.OS — Cut 3 Tests.
 *
 * Pflichttests 1–20 für Admin Review UI / Preview Renderer.
 * Kein DB-Zugriff, kein HTTP, kein Supabase-Client.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  createAdminPreviewArtifact,
  isAdminPreviewArtifact,
} from "@/lib/visual-learning-os/admin-preview";
import {
  buildVisualLearningArtifact,
  type VisualArtifactFactoryInput,
} from "@/lib/visual-learning-os/visual-artifact-factory";
import { reviewVisualLearningArtifact } from "@/lib/visual-learning-os/visual-artifact-review";
import { projectPublishedVisualArtifact } from "@/lib/visual-learning-os/visual-artifact-projection";
import type { VisualLearningArtifact } from "@/lib/visual-learning-os/contracts";

import VisualArtifactPreview from "@/components/admin/visual-learning/VisualArtifactPreview";
import VisualArtifactReviewPanel from "@/components/admin/visual-learning/VisualArtifactReviewPanel";
import VisualArtifactRubricPanel from "@/components/admin/visual-learning/VisualArtifactRubricPanel";
import VisualArtifactSourceRefsPanel from "@/components/admin/visual-learning/VisualArtifactSourceRefsPanel";

const baseInput: VisualArtifactFactoryInput = {
  artifact_id: "art-1",
  curriculum_id: "curr-1",
  competence_id: "comp-1",
  lesson_id: "lesson-1",
  blueprint_id: "bp-1",
  purpose: "learn",
  competence_facets: { requires_sequence_understanding: true, has_common_misconceptions: true },
  source_refs: ["ssot://curriculum/curr-1#comp-1"],
  seed_nodes: [
    { id: "n1", role: "process_step", label: "Schritt A" },
    { id: "n2", role: "process_step", label: "Schritt B" },
    { id: "n3", role: "rule", label: "Regel" },
  ],
  seed_edges: [
    { from: "n1", to: "n2", kind: "precedes" },
    { from: "n2", to: "n3", kind: "requires" },
  ],
  misconceptions: [{ kind: "false_order", description: "Reihenfolge vertauscht" }],
};

function makeArtifact(overrides: Partial<VisualLearningArtifact> = {}): VisualLearningArtifact {
  const { artifact } = buildVisualLearningArtifact(baseInput);
  return {
    ...artifact,
    accessibility: {
      text_summary: "Linearer Ablauf mit Regel.",
      color_independent_labels: true,
      screen_reader_description: "Drei Knoten, zwei Kanten.",
    },
    ...overrides,
  };
}

// Files (für Static-Source-Scans, Regel 12/13/14/15/16).
const FILES = {
  preview: readFileSync(
    path.resolve(__dirname, "../VisualArtifactPreview.tsx"),
    "utf8",
  ),
  reviewPanel: readFileSync(
    path.resolve(__dirname, "../VisualArtifactReviewPanel.tsx"),
    "utf8",
  ),
  rubricPanel: readFileSync(
    path.resolve(__dirname, "../VisualArtifactRubricPanel.tsx"),
    "utf8",
  ),
  sourceRefsPanel: readFileSync(
    path.resolve(__dirname, "../VisualArtifactSourceRefsPanel.tsx"),
    "utf8",
  ),
  page: readFileSync(
    path.resolve(__dirname, "../../../../pages/admin/VisualLearningReviewPage.tsx"),
    "utf8",
  ),
};

const ALL_COMPONENT_FILES = [FILES.preview, FILES.reviewPanel, FILES.rubricPanel, FILES.sourceRefsPanel];

describe("VISUAL.LEARNING.OS — Cut 3 Admin Review UI", () => {
  it("1. VisualArtifactPreview rendert ohne DB/HTTP", () => {
    const preview = createAdminPreviewArtifact(makeArtifact());
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    render(<VisualArtifactPreview source={preview.preview} sourceRefs={["ssot://x"]} />);
    expect(screen.getByTestId("vlo-preview")).toBeInTheDocument();
  });

  it("2. Preview zeigt Nodes, Edges und Misconception-Badges", () => {
    const preview = createAdminPreviewArtifact(makeArtifact());
    if (!preview.ok) throw new Error();
    render(<VisualArtifactPreview source={preview.preview} sourceRefs={["ssot://x"]} />);
    expect(screen.getAllByTestId("vlo-node").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByTestId("vlo-edge").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByTestId("vlo-misconception").length).toBeGreaterThanOrEqual(1);
  });

  it("3. Preview zeigt Source-Refs sichtbar an", () => {
    const preview = createAdminPreviewArtifact(makeArtifact());
    if (!preview.ok) throw new Error();
    render(
      <VisualArtifactPreview
        source={preview.preview}
        sourceRefs={["ssot://curriculum/curr-1#comp-1"]}
      />,
    );
    const block = screen.getByTestId("vlo-source-refs");
    expect(within(block).getByText("ssot://curriculum/curr-1#comp-1")).toBeInTheDocument();
  });

  it("4. Farbe wird nie ohne Textlabel/Legende verwendet (Legende vorhanden, Nodes haben Labels)", () => {
    const preview = createAdminPreviewArtifact(makeArtifact());
    if (!preview.ok) throw new Error();
    render(<VisualArtifactPreview source={preview.preview} />);
    // Legende sichtbar
    expect(screen.getByText("Legende")).toBeInTheDocument();
    // Jeder Node hat sichtbares Text-Label
    for (const n of screen.getAllByTestId("vlo-node")) {
      expect(n.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("5. ReviewPanel zeigt Blocker und Warnings", () => {
    const a = makeArtifact({ curriculum_id: "" });
    const review = reviewVisualLearningArtifact({ artifact: a, source_refs: [] });
    render(<VisualArtifactReviewPanel review={review} />);
    expect(screen.getByTestId("vlo-blockers")).toBeInTheDocument();
    expect(screen.getByTestId("vlo-warnings")).toBeInTheDocument();
    expect(review.blockers.length).toBeGreaterThan(0);
  });

  it("6. ReviewPanel berechnet Status nicht selbst (zeigt nur übergebenen)", () => {
    const fakeReview = {
      status: "approved" as const,
      blockers: [],
      warnings: [],
      publishable: true,
    };
    render(<VisualArtifactReviewPanel review={fakeReview} />);
    const badge = screen.getByTestId("vlo-review-status");
    expect(badge.getAttribute("data-status")).toBe("approved");
    expect(screen.getByTestId("vlo-review-publishable").getAttribute("data-publishable")).toBe("true");
  });

  it("7. RubricPanel zeigt Gewichtung und Summe", () => {
    const a = makeArtifact();
    render(<VisualArtifactRubricPanel rubric={a.assessment_rubric} />);
    const sum = screen.getByTestId("vlo-rubric-sum");
    expect(sum.getAttribute("data-sum")).toBe("100");
    expect(sum.getAttribute("data-sum-valid")).toBe("true");
    expect(screen.getAllByTestId("vlo-rubric-check").length).toBeGreaterThan(0);
  });

  it("8. SourceRefsPanel markiert fehlende curriculum_id/competence_id", () => {
    render(
      <VisualArtifactSourceRefsPanel
        artifact={{ curriculum_id: "", competence_id: "" }}
        sourceRefs={[]}
      />,
    );
    expect(screen.getByTestId("vlo-ref-curriculum_id").getAttribute("data-missing")).toBe("true");
    expect(screen.getByTestId("vlo-ref-competence_id").getAttribute("data-missing")).toBe("true");
    expect(screen.getByTestId("vlo-source-refs-missing")).toBeInTheDocument();
  });

  it("9. Draft-Artefakt darf nur als Admin Preview angezeigt werden", () => {
    const draft = makeArtifact({ status: "draft" });
    const preview = createAdminPreviewArtifact(draft);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(isAdminPreviewArtifact(preview.preview)).toBe(true);
    expect(preview.preview.publishable).toBe(false);
    expect(preview.preview.preview_mode).toBe("admin_review_only");
  });

  it("10. Draft-Artefakt darf nicht als PublishedVisualArtifact projected werden", () => {
    const draft = makeArtifact({ status: "draft" });
    const projection = projectPublishedVisualArtifact(draft);
    expect(projection.ok).toBe(false);
  });

  it("11. Approved-Artefakt darf published-preview-fähig sein", () => {
    const approved = makeArtifact({ status: "approved" });
    const projection = projectPublishedVisualArtifact(approved);
    expect(projection.ok).toBe(true);
    if (!projection.ok) return;
    render(<VisualArtifactPreview source={projection.artifact} />);
    expect(screen.getByTestId("vlo-published-badge")).toBeInTheDocument();
  });

  it("12. Keine Komponente importiert Supabase direkt", () => {
    for (const src of [...ALL_COMPONENT_FILES, FILES.page]) {
      expect(src).not.toMatch(/from\s+["']@\/integrations\/supabase/);
      expect(src).not.toMatch(/@supabase\/supabase-js/);
    }
  });

  it("13. Keine Komponente ruft selectVisualPatternForCompetence() auf", () => {
    for (const src of ALL_COMPONENT_FILES) {
      expect(src).not.toMatch(/selectVisualPatternForCompetence/);
    }
  });

  it("14. Keine Komponente ruft buildVisualLearningArtifact() beim Rendern auf", () => {
    for (const src of ALL_COMPONENT_FILES) {
      expect(src).not.toMatch(/buildVisualLearningArtifact/);
    }
  });

  it("15. Keine Komponente enthält Hex-Farben", () => {
    const HEX = /#[0-9a-fA-F]{3,8}\b/;
    for (const src of [...ALL_COMPONENT_FILES, FILES.page]) {
      expect(HEX.test(src)).toBe(false);
    }
  });

  it("16. Keine Komponente enthält Tailwind-Farbklassen als semantische Statuslogik", () => {
    const TW =
      /\b(?:bg|text|border|ring|from|via|to|fill|stroke|placeholder|caret|decoration|divide|outline|shadow|accent)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black)(?:-\d{2,3})?\b/;
    for (const src of [...ALL_COMPONENT_FILES, FILES.page]) {
      expect(TW.test(src)).toBe(false);
    }
  });

  it("17. Admin Route ist noindex/nofollow", () => {
    expect(FILES.page).toMatch(/noindex,\s*nofollow/);
  });

  it("18. Publishing-CTA ist disabled oder nicht vorhanden", () => {
    // Statischer Check: Publish-CTA muss disabled sein.
    expect(FILES.page).toMatch(/data-testid="vlo-publish-cta"/);
    expect(FILES.page).toMatch(/disabled/);
  });

  it("19. Keine automatische Mutation beim Rendern (keine writes/mutations in components)", () => {
    for (const src of [...ALL_COMPONENT_FILES, FILES.page]) {
      expect(src).not.toMatch(/\.from\(["']/); // supabase.from(...)
      expect(src).not.toMatch(/\.rpc\(/);
      expect(src).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("20. createAdminPreviewArtifact ist pure & deterministisch", () => {
    const a = makeArtifact();
    const p1 = createAdminPreviewArtifact(a);
    const p2 = createAdminPreviewArtifact(a);
    expect(p1).toEqual(p2);
    expect(createAdminPreviewArtifact(null).ok).toBe(false);
  });
});
