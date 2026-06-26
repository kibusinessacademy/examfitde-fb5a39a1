import { describe, it, expect } from "vitest";
import {
  buildVisualLearningArtifact,
  type VisualArtifactFactoryInput,
} from "../visual-artifact-factory";
import { reviewVisualLearningArtifact } from "../visual-artifact-review";
import { projectPublishedVisualArtifact } from "../visual-artifact-projection";
import { MISCONCEPTION_BADGE } from "../visual-grammar";
import type { VisualLearningArtifact, VisualNode, VisualEdge } from "../contracts";

const baseInput: VisualArtifactFactoryInput = {
  artifact_id: "art-1",
  curriculum_id: "curr-1",
  competence_id: "comp-1",
  lesson_id: "lesson-1",
  blueprint_id: "bp-1",
  purpose: "learn",
  competence_facets: {
    requires_sequence_understanding: true,
  },
  source_refs: ["ssot://curriculum/curr-1#comp-1"],
  seed_nodes: [
    { id: "n2", role: "process_step", label: "Schritt B" },
    { id: "n1", role: "process_step", label: "Schritt A" },
    { id: "n3", role: "rule", label: "Regel" },
  ],
  seed_edges: [
    { from: "n1", to: "n2", kind: "precedes" },
    { from: "n2", to: "n3", kind: "requires" },
  ],
  misconceptions: [
    { kind: "false_order", description: "Reihenfolge vertauscht" },
  ],
};

function makeValidArtifact(): VisualLearningArtifact {
  const { artifact } = buildVisualLearningArtifact(baseInput);
  return {
    ...artifact,
    accessibility: {
      text_summary: "Ablauf A → B mit Regel.",
      color_independent_labels: true,
      screen_reader_description: "Drei Knoten, zwei Kanten.",
    },
  };
}

describe("VISUAL.LEARNING.OS — Factory (Cut 2)", () => {
  it("1. ist deterministisch: gleicher Input → gleicher Output", () => {
    const a = buildVisualLearningArtifact(baseInput);
    const b = buildVisualLearningArtifact(baseInput);
    expect(a).toEqual(b);
  });

  it("2. setzt nie approved oder published", () => {
    const { artifact } = buildVisualLearningArtifact(baseInput);
    expect(artifact.status === "approved" || artifact.status === "published").toBe(false);
    expect(["draft", "review"]).toContain(artifact.status);
  });

  it("16. Pattern-Auswahl nutzt selectVisualPatternForCompetence deterministisch", () => {
    const { artifact, pattern_rationale } = buildVisualLearningArtifact(baseInput);
    expect(artifact.artifact_type).toBe("process_flow");
    expect(pattern_rationale).toMatch(/Abläufe/);
  });

  it("17. Misconception-Badges sind aus MISCONCEPTION_BADGE ableitbar", () => {
    const { artifact } = buildVisualLearningArtifact(baseInput);
    const kind = artifact.misconceptions![0].kind;
    expect(MISCONCEPTION_BADGE[kind]).toBeDefined();
    expect(MISCONCEPTION_BADGE[kind].label).toBe("Falsche Reihenfolge");
  });
});

describe("VISUAL.LEARNING.OS — Review Gate (Cut 2)", () => {
  it("3. fehlende curriculum_id blockiert", () => {
    const a = makeValidArtifact();
    a.curriculum_id = "";
    const r = reviewVisualLearningArtifact({ artifact: a, source_refs: ["x"] });
    expect(r.status).toBe("blocked");
    expect(r.blockers.some((b) => b.code === "missing_curriculum_id")).toBe(true);
  });

  it("4. fehlende competence_id blockiert", () => {
    const a = makeValidArtifact();
    a.competence_id = "";
    const r = reviewVisualLearningArtifact({ artifact: a, source_refs: ["x"] });
    expect(r.blockers.some((b) => b.code === "missing_competence_id")).toBe(true);
  });

  it("5. fehlende source_refs blockieren", () => {
    const a = makeValidArtifact();
    const r = reviewVisualLearningArtifact({ artifact: a, source_refs: [] });
    expect(r.blockers.some((b) => b.code === "missing_source_refs")).toBe(true);
  });

  it("7. Hex-Farben in Labels blockieren", () => {
    const a = makeValidArtifact();
    a.nodes[0] = { ...a.nodes[0], label: "Hot #ff0000 alert" };
    const r = reviewVisualLearningArtifact({ artifact: a, source_refs: ["x"] });
    expect(r.blockers.some((b) => b.code === "hex_color_forbidden")).toBe(true);
  });

  it("8. Tailwind-Farbklassen in Labels blockieren", () => {
    const a = makeValidArtifact();
    a.nodes[0] = { ...a.nodes[0], label: "Schritt bg-red-500" };
    const r = reviewVisualLearningArtifact({ artifact: a, source_refs: ["x"] });
    expect(r.blockers.some((b) => b.code === "tailwind_color_class_forbidden")).toBe(true);
  });

  it("9. color_only_meaning blockiert", () => {
    const a = makeValidArtifact();
    a.accessibility.color_independent_labels = false;
    const r = reviewVisualLearningArtifact({ artifact: a, source_refs: ["x"] });
    expect(r.blockers.some((b) => b.code === "color_only_meaning")).toBe(true);
  });

  it("10. kritische Edge-Typen brauchen Label", () => {
    const a = makeValidArtifact();
    const extraEdge: VisualEdge = { from: "n1", to: "n3", kind: "contrasts_with" };
    a.edges = [...a.edges, extraEdge];
    const r = reviewVisualLearningArtifact({ artifact: a, source_refs: ["x"] });
    expect(r.blockers.some((b) => b.code === "missing_edge_label_for_critical_kind")).toBe(true);

    // mit Label grün
    const a2 = makeValidArtifact();
    a2.edges = [
      ...a2.edges,
      { from: "n1", to: "n3", kind: "contrasts_with", label: "im Gegensatz zu" },
    ];
    const r2 = reviewVisualLearningArtifact({ artifact: a2, source_refs: ["x"] });
    expect(r2.blockers.filter((b) => b.code === "missing_edge_label_for_critical_kind")).toHaveLength(0);
  });

  it("11. Rubric-Summe ungleich 100 blockiert", () => {
    const a = makeValidArtifact();
    a.assessment_rubric = {
      passing_score: 70,
      checks: [{ kind: "explanation_quality", weight: 80 }],
    };
    const r = reviewVisualLearningArtifact({ artifact: a, source_refs: ["x"] });
    expect(r.blockers.some((b) => b.code === "rubric_invalid")).toBe(true);
  });

  it("12. approved nur wenn alles grün ist", () => {
    const a = makeValidArtifact();
    const r = reviewVisualLearningArtifact({ artifact: a, source_refs: ["ssot://x"] });
    expect(r.status).toBe("approved");
    expect(r.publishable).toBe(true);
    expect(r.blockers).toHaveLength(0);
  });
});

describe("VISUAL.LEARNING.OS — Projection (Cut 2)", () => {
  it("13. Draft-Artefakt kann nicht projected werden", () => {
    const a = makeValidArtifact();
    a.status = "draft";
    const r = projectPublishedVisualArtifact(a);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_approved");
  });

  it("14. Approved-Artefakt kann projected werden", () => {
    const a = makeValidArtifact();
    a.status = "approved";
    const r = projectPublishedVisualArtifact(a);
    expect(r.ok).toBe(true);
  });

  it("15. Projektion enthält keine internen Review-/Raw-Felder", () => {
    const a = makeValidArtifact();
    a.status = "approved";
    a.misconceptions = [
      { kind: "false_order", description: "x", blueprint_misconception_id: "secret-bp" },
    ];
    const r = projectPublishedVisualArtifact(a);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.artifact as any).assessment_rubric).toBeUndefined();
      expect((r.artifact as any).blueprint_id).toBeUndefined();
      expect(r.artifact.misconceptions?.[0]).not.toHaveProperty("blueprint_misconception_id");
    }
  });
});

describe("VISUAL.LEARNING.OS — Determinism guard (Cut 2)", () => {
  it("18. nutzt keinen DB/HTTP/Clock/RNG — deterministische Ausgabe mit Default-Timestamp", () => {
    const { artifact } = buildVisualLearningArtifact(baseInput);
    expect(artifact.created_at).toBe("1970-01-01T00:00:00.000Z");
    expect(artifact.updated_at).toBe("1970-01-01T00:00:00.000Z");
    // Nodes deterministisch sortiert
    expect(artifact.nodes.map((n: VisualNode) => n.id)).toEqual(["n1", "n2", "n3"]);
  });
});
