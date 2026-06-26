/**
 * VISUAL.LEARNING.OS — Cut 5 Tests.
 *
 * Pflichttests 1–31 für MiniCheck Visual Feedback.
 * Pure: kein DB/HTTP/Supabase im Pfad.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";

import {
  buildMiniCheckVisualFeedback,
  isMiniCheckVisualFeedbackEmpty,
  type MiniCheckVisualAnswerSignal,
  type MiniCheckVisualFeedbackInput,
  type MiniCheckVisualMapping,
} from "@/lib/visual-learning-os/minicheck-visual-feedback";
import {
  LEARNER_SAFE_FIXTURE_ARTIFACT_WITH_MAPPED_MISCONCEPTION as ART,
} from "@/lib/visual-learning-os/fixtures";
import type { PublishedVisualArtifact } from "@/lib/visual-learning-os/contracts";
import MiniCheckVisualFeedback from "@/components/learning/MiniCheckVisualFeedback";

const BASE_CTX = {
  curriculum_id: ART.curriculum_id,
  competence_id: ART.competence_id,
  lesson_id: ART.lesson_id,
  mini_check_id: "mc-fixture-1",
};

const SIG_INCORRECT: MiniCheckVisualAnswerSignal = {
  question_id: "q1",
  question_order: 1,
  correctness: "incorrect",
  answer_key: "a-wrong",
};
const SIG_CORRECT: MiniCheckVisualAnswerSignal = {
  question_id: "q2",
  question_order: 2,
  correctness: "correct",
};
const SIG_UNSURE: MiniCheckVisualAnswerSignal = {
  question_id: "q3",
  question_order: 3,
  correctness: "unsure",
};

const MAP_Q1: MiniCheckVisualMapping = {
  question_id: "q1",
  answer_key: "a-wrong",
  misconception_id: "mc-1",
  visual_artifact_id: ART.id,
};
const MAP_Q3: MiniCheckVisualMapping = {
  question_id: "q3",
  misconception_id: "mc-1",
  visual_artifact_id: ART.id,
};

function makeInput(
  overrides: Partial<MiniCheckVisualFeedbackInput> = {},
): MiniCheckVisualFeedbackInput {
  return {
    context: { ...BASE_CTX },
    signals: [SIG_INCORRECT, SIG_CORRECT, SIG_UNSURE],
    mappings: [MAP_Q1, MAP_Q3],
    artifacts: [ART],
    source_refs: ["LF-1 §3"],
    ...overrides,
  };
}

// Static-source scans (architecture guards).
const FILES = {
  renderer: readFileSync(
    path.resolve(__dirname, "../MiniCheckVisualFeedback.tsx"),
    "utf8",
  ),
  block: readFileSync(
    path.resolve(__dirname, "../VisualLearningBlock.tsx"),
    "utf8",
  ),
  lesson: readFileSync(
    path.resolve(__dirname, "../../lesson/LessonContent.tsx"),
    "utf8",
  ),
  policy: readFileSync(
    path.resolve(
      __dirname,
      "../../../lib/visual-learning-os/minicheck-visual-policy.ts",
    ),
    "utf8",
  ),
  engine: readFileSync(
    path.resolve(
      __dirname,
      "../../../lib/visual-learning-os/minicheck-visual-feedback.ts",
    ),
    "utf8",
  ),
};

describe("VISUAL.LEARNING.OS — Cut 5 Engine", () => {
  it("1. buildMiniCheckVisualFeedback ist deterministisch", () => {
    const a = buildMiniCheckVisualFeedback(makeInput());
    const b = buildMiniCheckVisualFeedback(makeInput());
    expect(a).toEqual(b);
  });

  it("2. Richtige Antwort erzeugt keine Fehlerdiagnose", () => {
    const r = buildMiniCheckVisualFeedback(
      makeInput({ signals: [SIG_CORRECT], mappings: [] }),
    );
    expect(r.items).toHaveLength(0);
    expect(r.positive_signals.map((p) => p.question_id)).toEqual(["q2"]);
  });

  it("3. Falsche Antwort mit Mapping erzeugt Feedback Item", () => {
    const r = buildMiniCheckVisualFeedback(
      makeInput({ signals: [SIG_INCORRECT], mappings: [MAP_Q1] }),
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].severity).toBe("correction");
    expect(r.items[0].visual_artifact_id).toBe(ART.id);
  });

  it("4. Unsichere Antwort mit Mapping erzeugt Feedback Item (hint)", () => {
    const r = buildMiniCheckVisualFeedback(
      makeInput({ signals: [SIG_UNSURE], mappings: [MAP_Q3] }),
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].severity).toBe("hint");
  });

  it("5. Fehlendes Mapping → valid result mit Warning, kein Crash", () => {
    const r = buildMiniCheckVisualFeedback(
      makeInput({ signals: [SIG_INCORRECT], mappings: [] }),
    );
    expect(r.items).toHaveLength(0);
    expect(r.warnings.some((w) => w.code === "MINICHECK_VISUAL_NO_MAPPING_AVAILABLE")).toBe(
      true,
    );
    expect(r.learner_visible).toBe(true);
  });

  it("6. Fehlende curriculum_id blockiert", () => {
    const r = buildMiniCheckVisualFeedback(
      makeInput({ context: { ...BASE_CTX, curriculum_id: "" } }),
    );
    expect(r.blockers.some((b) => b.code === "MINICHECK_VISUAL_MISSING_CURRICULUM_ID")).toBe(
      true,
    );
    expect(r.learner_visible).toBe(false);
  });

  it("7. Fehlende competence_id blockiert", () => {
    const r = buildMiniCheckVisualFeedback(
      makeInput({ context: { ...BASE_CTX, competence_id: "" } }),
    );
    expect(r.blockers.some((b) => b.code === "MINICHECK_VISUAL_MISSING_COMPETENCE_ID")).toBe(
      true,
    );
  });

  it("8. Fehlende mini_check_id blockiert", () => {
    const r = buildMiniCheckVisualFeedback(
      makeInput({ context: { ...BASE_CTX, mini_check_id: "" } }),
    );
    expect(r.blockers.some((b) => b.code === "MINICHECK_VISUAL_MISSING_MINICHECK_ID")).toBe(
      true,
    );
  });

  it("9. Fehlende question_id blockiert", () => {
    const bad: MiniCheckVisualAnswerSignal = {
      question_id: "",
      question_order: 1,
      correctness: "incorrect",
    };
    const r = buildMiniCheckVisualFeedback(makeInput({ signals: [bad], mappings: [] }));
    expect(r.blockers.some((b) => b.code === "MINICHECK_VISUAL_MISSING_QUESTION_ID")).toBe(
      true,
    );
  });

  it("10. Curriculum-Mismatch schließt Artifact aus (text-only fallback)", () => {
    const r = buildMiniCheckVisualFeedback(
      makeInput({ context: { ...BASE_CTX, curriculum_id: "other-curr" } }),
    );
    expect(r.items.every((i) => !i.artifact_title)).toBe(true);
  });

  it("11. Competence-Mismatch schließt Artifact aus", () => {
    const r = buildMiniCheckVisualFeedback(
      makeInput({ context: { ...BASE_CTX, competence_id: "other-comp" } }),
    );
    expect(r.items.every((i) => !i.artifact_title)).toBe(true);
  });

  it("12. Lesson-Mismatch schließt Artifact aus, falls lesson_id gesetzt", () => {
    const r = buildMiniCheckVisualFeedback(
      makeInput({ context: { ...BASE_CTX, lesson_id: "other-lesson" } }),
    );
    expect(r.items.every((i) => !i.artifact_title)).toBe(true);
  });

  it("13. Draft/needs_review/blocked Artefakte erscheinen nie im Learner Feedback", () => {
    const draft = { ...ART, status: "draft" } as unknown as PublishedVisualArtifact;
    const r = buildMiniCheckVisualFeedback(makeInput({ artifacts: [draft] }));
    expect(r.blockers.some((b) => b.code === "MINICHECK_VISUAL_UNAPPROVED_ARTIFACT")).toBe(
      true,
    );
    expect(r.learner_visible).toBe(false);
  });

  it("14. Fehlende source_refs → Warning gemäß Policy", () => {
    const r = buildMiniCheckVisualFeedback(makeInput({ source_refs: [] }));
    expect(r.warnings.some((w) => w.code === "MINICHECK_VISUAL_SPARSE_SOURCE_REFS")).toBe(
      true,
    );
  });

  it("15. Ergebnis ist deterministisch sortiert (severity desc, order asc)", () => {
    const r = buildMiniCheckVisualFeedback(makeInput());
    const ranks = r.items.map((i) => i.severity);
    // correction (q1) sollte vor hint (q3) stehen
    expect(ranks[0]).toBe("correction");
    expect(ranks[1]).toBe("hint");
  });

  it("16. Ergebnis ist auf max 3 primäre Feedback Items begrenzt", () => {
    const many: MiniCheckVisualAnswerSignal[] = Array.from({ length: 7 }, (_, i) => ({
      question_id: `qx${i}`,
      question_order: i + 10,
      correctness: "incorrect",
    }));
    const mappings: MiniCheckVisualMapping[] = many.map((s) => ({
      question_id: s.question_id,
      misconception_id: "mc-1",
      visual_artifact_id: ART.id,
    }));
    const r = buildMiniCheckVisualFeedback(
      makeInput({ signals: many, mappings }),
    );
    expect(r.items.length).toBeLessThanOrEqual(3);
  });
});

describe("VISUAL.LEARNING.OS — Cut 5 Renderer", () => {
  it("17. MiniCheckVisualFeedback rendert ohne DB/HTTP", () => {
    const r = buildMiniCheckVisualFeedback(makeInput());
    render(<MiniCheckVisualFeedback result={r} isSubmitted />);
    expect(screen.getByTestId("mcvf-root")).toBeTruthy();
  });

  it("18. Empty State rendert sauber (keine Items, keine Positives)", () => {
    const r = buildMiniCheckVisualFeedback(
      makeInput({ signals: [], mappings: [] }),
    );
    expect(isMiniCheckVisualFeedbackEmpty(r)).toBe(true);
    render(<MiniCheckVisualFeedback result={r} isSubmitted />);
    expect(screen.getByTestId("mcvf-empty")).toBeTruthy();
  });

  it("19. Feedback zeigt Misconception Label und Wiederholungsimpuls", () => {
    const r = buildMiniCheckVisualFeedback(makeInput());
    render(<MiniCheckVisualFeedback result={r} isSubmitted />);
    expect(screen.getAllByTestId("mcvf-misconception-label").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("mcvf-repetition-hint").length).toBeGreaterThan(0);
  });

  it("20. Feedback zeigt Source-Refs kompakt", () => {
    const r = buildMiniCheckVisualFeedback(makeInput());
    render(<MiniCheckVisualFeedback result={r} isSubmitted />);
    expect(screen.getAllByTestId("mcvf-source-refs").length).toBeGreaterThan(0);
  });

  it("21. Farbe erscheint nie ohne Label/Text (kein Hex/Tailwind-Farbklasse im Renderer)", () => {
    expect(/#[0-9a-fA-F]{3,8}\b/.test(FILES.renderer)).toBe(false);
    expect(
      /\b(?:bg|text|border)-(?:red|green|blue|yellow|orange|purple|pink|rose|amber|emerald|cyan|sky|indigo|violet|fuchsia|lime|teal)(?:-\d{2,3})?\b/.test(
        FILES.renderer,
      ),
    ).toBe(false);
  });

  it("22. Keine Learning-Komponente importiert Supabase", () => {
    expect(FILES.renderer.includes("@/integrations/supabase")).toBe(false);
    expect(FILES.block.includes("@/integrations/supabase")).toBe(false);
  });

  it("23. Keine Learning-Komponente importiert selectVisualPatternForCompetence", () => {
    expect(FILES.renderer.includes("selectVisualPatternForCompetence")).toBe(false);
    expect(FILES.block.includes("selectVisualPatternForCompetence")).toBe(false);
  });

  it("24. Keine Learning-Komponente importiert buildVisualLearningArtifact", () => {
    expect(FILES.renderer.includes("buildVisualLearningArtifact")).toBe(false);
    expect(FILES.block.includes("buildVisualLearningArtifact")).toBe(false);
  });

  it("25. Keine Learning-Komponente importiert reviewVisualLearningArtifact", () => {
    expect(FILES.renderer.includes("reviewVisualLearningArtifact")).toBe(false);
    expect(FILES.block.includes("reviewVisualLearningArtifact")).toBe(false);
  });

  it("26. Keine Draft/Admin-/Review-Texte im Learner Renderer (außerhalb Kommentare)", () => {
    const stripped = FILES.renderer
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\*.*$/gm, "")
      .replace(/\/\/.*$/gm, "")
      .toLowerCase();
    expect(stripped.includes("draft")).toBe(false);
    expect(stripped.includes("review-status")).toBe(false);
    expect(stripped.includes("admin")).toBe(false);
  });

  it("27. Vor MiniCheck-Abgabe wird kein Fehlerbild angezeigt", () => {
    const r = buildMiniCheckVisualFeedback(makeInput());
    const { container } = render(
      <MiniCheckVisualFeedback result={r} isSubmitted={false} />,
    );
    expect(container.querySelector('[data-testid="mcvf-root"]')).toBeNull();
  });

  it("28. Nach MiniCheck-Abgabe kann Fehlerbild angezeigt werden", () => {
    const r = buildMiniCheckVisualFeedback(makeInput());
    render(<MiniCheckVisualFeedback result={r} isSubmitted />);
    expect(screen.getByTestId("mcvf-root")).toBeTruthy();
  });

  it("29. MiniCheck bleibt im Lesson-Flow vorhanden (LessonContent referenziert MiniCheckPlayer)", () => {
    expect(FILES.lesson.includes("MiniCheckPlayer")).toBe(true);
  });

  it("30. Keine Mastery- oder Prüfungsreife-Aussage in Cut 5 (außerhalb Kommentare)", () => {
    const strip = (s: string) =>
      s
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\*.*$/gm, "")
        .replace(/\/\/.*$/gm, "")
        .toLowerCase();
    const lower = strip(FILES.renderer) + strip(FILES.engine) + strip(FILES.policy);
    expect(lower.includes("mastery")).toBe(false);
    expect(lower.includes("prüfungsreife")).toBe(false);
    expect(lower.includes("pruefungsreife")).toBe(false);
  });


  it("31. Renderer/Engine/Policy enthalten keine direkten Supabase-Reads", () => {
    expect(FILES.engine.includes("@/integrations/supabase")).toBe(false);
    expect(FILES.policy.includes("@/integrations/supabase")).toBe(false);
    expect(FILES.engine.includes("fetch(")).toBe(false);
    expect(FILES.engine.includes("Date.now")).toBe(false);
    expect(FILES.engine.includes("Math.random")).toBe(false);
  });
});
