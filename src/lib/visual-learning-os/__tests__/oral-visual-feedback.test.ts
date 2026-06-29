/**
 * Cut 9 — Oral Visual Feedback Engine + Projections.
 *
 * Tests:
 *  - deterministisch
 *  - Blocker bei fehlenden Pflichtfeldern
 *  - Mapping über explizite IDs (keine NLP)
 *  - Learner Projection enthält keine Note/Bestanden/Prüfungsreife
 *  - Admin Projection enthält Hinweis auf keine finale Bewertung
 */
import { describe, expect, it } from "vitest";
import {
  buildOralVisualFeedback,
  projectOralVisualFeedbackForAdmin,
  projectOralVisualFeedbackForLearner,
  type OralVisualArtifactMapping,
  type OralVisualFeedbackInput,
  type OralVisualQuestionContext,
} from "../oral-visual-feedback";
import {
  LEARNER_SAFE_FIXTURE_ARTIFACT_WITH_MAPPED_MISCONCEPTION,
  ORAL_ARTIFACT_MAPPING_FIXTURE,
  ORAL_QUESTION_CONTEXT_FIXTURE,
} from "../fixtures";
import type { PublishedVisualArtifact } from "../contracts";

const SOURCE_REF = "ssot://curriculum/fixture-curr#fixture-comp/oral";

function baseInput(
  overrides: Partial<OralVisualFeedbackInput> = {},
): OralVisualFeedbackInput {
  return {
    context: { ...ORAL_QUESTION_CONTEXT_FIXTURE },
    artifacts: [LEARNER_SAFE_FIXTURE_ARTIFACT_WITH_MAPPED_MISCONCEPTION],
    mappings: [ORAL_ARTIFACT_MAPPING_FIXTURE],
    source_refs: [SOURCE_REF],
    ...overrides,
  };
}

describe("buildOralVisualFeedback — determinism + guards", () => {
  it("ist deterministisch (gleicher Input → gleicher Output)", () => {
    const a = buildOralVisualFeedback(baseInput());
    const b = buildOralVisualFeedback(baseInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("blockiert fehlende curriculum_id", () => {
    const r = buildOralVisualFeedback(
      baseInput({
        context: {
          ...ORAL_QUESTION_CONTEXT_FIXTURE,
          curriculum_id: "",
        } as OralVisualQuestionContext,
      }),
    );
    expect(r.blockers.some((b) => b.code === "VLO_ORAL_MISSING_CURRICULUM_ID")).toBe(true);
    expect(r.items).toEqual([]);
    expect(r.learner_visible).toBe(false);
  });

  it("blockiert fehlende competence_id", () => {
    const r = buildOralVisualFeedback(
      baseInput({
        context: {
          ...ORAL_QUESTION_CONTEXT_FIXTURE,
          competence_id: "",
        } as OralVisualQuestionContext,
      }),
    );
    expect(r.blockers.some((b) => b.code === "VLO_ORAL_MISSING_COMPETENCE_ID")).toBe(true);
  });

  it("blockiert fehlende oral_question_id", () => {
    const r = buildOralVisualFeedback(
      baseInput({
        context: {
          ...ORAL_QUESTION_CONTEXT_FIXTURE,
          oral_question_id: "",
        } as OralVisualQuestionContext,
      }),
    );
    expect(r.blockers.some((b) => b.code === "VLO_ORAL_MISSING_ORAL_QUESTION_ID")).toBe(true);
  });

  it("blockiert fehlenden learner_context", () => {
    const r = buildOralVisualFeedback(
      baseInput({
        context: {
          ...ORAL_QUESTION_CONTEXT_FIXTURE,
          learner: {},
        },
      }),
    );
    expect(r.blockers.some((b) => b.code === "VLO_ORAL_MISSING_LEARNER_CONTEXT")).toBe(true);
  });

  it("blockiert unpublished Artifact", () => {
    const unpub: PublishedVisualArtifact = {
      ...LEARNER_SAFE_FIXTURE_ARTIFACT_WITH_MAPPED_MISCONCEPTION,
      status: "draft" as unknown as PublishedVisualArtifact["status"],
    };
    const r = buildOralVisualFeedback(baseInput({ artifacts: [unpub] }));
    expect(r.blockers.some((b) => b.code === "VLO_ORAL_UNPUBLISHED_ARTIFACT")).toBe(true);
  });

  it("blockiert Curriculum-Mismatch", () => {
    const wrong: PublishedVisualArtifact = {
      ...LEARNER_SAFE_FIXTURE_ARTIFACT_WITH_MAPPED_MISCONCEPTION,
      curriculum_id: "other-curr",
    };
    const r = buildOralVisualFeedback(baseInput({ artifacts: [wrong] }));
    expect(r.blockers.some((b) => b.code === "VLO_ORAL_CURRICULUM_MISMATCH")).toBe(true);
  });

  it("blockiert Competence-Mismatch", () => {
    const wrong: PublishedVisualArtifact = {
      ...LEARNER_SAFE_FIXTURE_ARTIFACT_WITH_MAPPED_MISCONCEPTION,
      competence_id: "other-comp",
    };
    const r = buildOralVisualFeedback(baseInput({ artifacts: [wrong] }));
    expect(r.blockers.some((b) => b.code === "VLO_ORAL_COMPETENCE_MISMATCH")).toBe(true);
  });

  it("blockiert Blueprint-Mismatch wenn gesetzt", () => {
    const ctx: OralVisualQuestionContext = {
      ...ORAL_QUESTION_CONTEXT_FIXTURE,
      blueprint_id: "bp-x",
    };
    const mapping: OralVisualArtifactMapping = {
      ...ORAL_ARTIFACT_MAPPING_FIXTURE,
      blueprint_id: "bp-other",
    };
    const r = buildOralVisualFeedback(
      baseInput({ context: ctx, mappings: [mapping] }),
    );
    expect(r.blockers.some((b) => b.code === "VLO_ORAL_BLUEPRINT_MISMATCH")).toBe(true);
  });

  it("warnt bei fehlenden source_refs", () => {
    const r = buildOralVisualFeedback(baseInput({ source_refs: [] }));
    expect(r.warnings.some((w) => w.code === "VLO_ORAL_SPARSE_STRUCTURE_EVIDENCE")).toBe(true);
  });
});

describe("buildOralVisualFeedback — signals", () => {
  it("fehlende Key Nodes erzeugen key_node_missing", () => {
    const r = buildOralVisualFeedback(baseInput());
    expect(r.items.some((i) => i.signal_kind === "key_node_missing")).toBe(true);
    expect(r.warnings.some((w) => w.code === "VLO_ORAL_MISSING_KEY_NODE_COVERAGE")).toBe(true);
  });

  it("fehlende Edges erzeugen relation_missing", () => {
    const r = buildOralVisualFeedback(baseInput());
    expect(r.items.some((i) => i.signal_kind === "relation_missing")).toBe(true);
    expect(r.warnings.some((w) => w.code === "VLO_ORAL_MISSING_EDGE_COVERAGE")).toBe(true);
  });

  it("Misconception-Match erzeugt misconception_risk", () => {
    const r = buildOralVisualFeedback(baseInput());
    expect(
      r.items.some(
        (i) => i.signal_kind === "misconception_risk" && i.misconception_id === "mc-1",
      ),
    ).toBe(true);
  });

  it("gute Coverage erzeugt structure_aligned", () => {
    const m: OralVisualArtifactMapping = {
      ...ORAL_ARTIFACT_MAPPING_FIXTURE,
      covered_node_ids: ["n1", "n2", "n3"],
      covered_edge_ids: ["n1->n2", "n2->n3"],
      misconception_ids: [],
    };
    const r = buildOralVisualFeedback(baseInput({ mappings: [m] }));
    expect(r.items.some((i) => i.signal_kind === "structure_aligned")).toBe(true);
  });

  it("geringe Coverage erzeugt answer_too_unstructured", () => {
    const m: OralVisualArtifactMapping = {
      ...ORAL_ARTIFACT_MAPPING_FIXTURE,
      covered_node_ids: [],
      covered_edge_ids: [],
      misconception_ids: [],
    };
    const r = buildOralVisualFeedback(baseInput({ mappings: [m] }));
    expect(r.items.some((i) => i.signal_kind === "answer_too_unstructured")).toBe(true);
  });

  it("Ergebnis ist deterministisch sortiert", () => {
    const r = buildOralVisualFeedback(baseInput());
    const ordered = [...r.items].sort((a, b) => {
      const rank = (k: string) =>
        [
          "answer_too_unstructured",
          "good_practice_reference",
          "key_node_missing",
          "misconception_risk",
          "needs_followup_question",
          "relation_missing",
          "structure_aligned",
        ].indexOf(k);
      return rank(a.signal_kind) - rank(b.signal_kind);
    });
    expect(r.items.map((i) => i.signal_kind)).toEqual(
      ordered.map((i) => i.signal_kind),
    );
  });

  it("kein Mapping → valid-empty Result mit Warning", () => {
    const r = buildOralVisualFeedback(baseInput({ mappings: [] }));
    expect(r.items).toEqual([]);
    expect(r.blockers).toEqual([]);
    expect(r.warnings.some((w) => w.code === "VLO_ORAL_NO_VISUAL_ARTIFACT_AVAILABLE")).toBe(true);
    expect(r.is_final_oral_grade).toBe(false);
  });
});

describe("projectOralVisualFeedbackForLearner — safety", () => {
  it("maximal 4 Hinweise", () => {
    const r = buildOralVisualFeedback(baseInput());
    const p = projectOralVisualFeedbackForLearner(r);
    expect(p.hints.length).toBeLessThanOrEqual(4);
  });

  it("vor Antwortabgabe (answer_submitted=false) → empty", () => {
    const r = buildOralVisualFeedback(
      baseInput({
        context: { ...ORAL_QUESTION_CONTEXT_FIXTURE, answer_submitted: false },
      }),
    );
    const p = projectOralVisualFeedbackForLearner(r);
    expect(p.learner_visible).toBe(false);
    expect(p.empty).toBe(true);
    expect(p.hints).toEqual([]);
  });

  it("nach Antwortabgabe → Hinweise sichtbar", () => {
    const r = buildOralVisualFeedback(baseInput());
    const p = projectOralVisualFeedbackForLearner(r);
    expect(p.learner_visible).toBe(true);
    expect(p.hints.length).toBeGreaterThan(0);
  });

  it("enthält keine Score-Gewichte, Note, bestanden/nicht bestanden, Prüfungsreife", () => {
    const r = buildOralVisualFeedback(baseInput());
    const p = projectOralVisualFeedbackForLearner(r);
    const serialized = JSON.stringify(p).toLowerCase();
    expect(serialized).not.toContain("score-gewicht");
    expect(serialized).not.toMatch(/\bnote\b/);
    expect(serialized).not.toContain("bestanden");
    expect(serialized).not.toContain("prüfungsreife");
    expect(serialized).not.toContain("pruefungsreife");
    expect(serialized).not.toContain("grade");
  });
});

describe("projectOralVisualFeedbackForAdmin — evidence", () => {
  it("enthält vollständige Evidence (expected/covered/missing/mc)", () => {
    const input = baseInput();
    const r = buildOralVisualFeedback(input);
    const p = projectOralVisualFeedbackForAdmin(r, input);
    expect(p.expected_node_ids).toEqual(["n1", "n2", "n3"]);
    expect(p.covered_node_ids).toEqual(["n1"]);
    expect(p.missing_node_ids).toEqual(["n2", "n3"]);
    expect(p.expected_edge_ids).toEqual(["n1->n2", "n2->n3"]);
    expect(p.misconception_ids).toEqual(["mc-1"]);
    expect(p.signals.length).toBeGreaterThan(0);
    expect(p.is_final_oral_grade).toBe(false);
  });

  it("enthält Hinweis auf keine finale mündliche Bewertung", () => {
    const input = baseInput();
    const r = buildOralVisualFeedback(input);
    const p = projectOralVisualFeedbackForAdmin(r, input);
    expect(p.note.toLowerCase()).toContain("strukturfeedback");
    expect(p.note.toLowerCase()).toContain("keine finale");
  });
});
