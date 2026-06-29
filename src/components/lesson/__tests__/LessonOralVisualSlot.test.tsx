/**
 * Welle-2 Cut-9-Slot — learner-safe Guards.
 *
 * Sichert die Hardregeln des Slots ab:
 *  1) kein Render vor Antwortabgabe (answerSubmitted=false → null)
 *  2) Note/Prüfungsreife-Tokens werden aus Hints gefiltert
 *  3) ungültige Hint-Kinds werden verworfen
 *  4) `learner_visible:false` → kein Render
 *  5) keine Admin-/Severity-Felder im DOM
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  LessonOralVisualSlot,
  extractOralVisualProjection,
} from "@/components/lesson/LessonOralVisualSlot";

const VALID_CONTENT = {
  oral_visual_projection: {
    curriculum_id: "c1",
    competence_id: "k1",
    oral_question_id: "q1",
    learner_visible: true,
    empty: false,
    disclaimer: "Strukturhinweise zu deiner Antwort — keine mündliche Bewertung.",
    hints: [
      {
        kind: "key_node_missing",
        message: "Ein Kernpunkt fehlt noch in deiner Antwortstruktur.",
        text_alt: "Strukturhinweis: fehlender Kernpunkt.",
      },
      {
        kind: "structure_aligned",
        message: "Deine Antwort folgt einer gut erkennbaren Struktur.",
        text_alt: "Strukturhinweis: gute Strukturabdeckung.",
      },
    ],
  },
};

describe("LessonOralVisualSlot (Cut 9 — learner-safe)", () => {
  it("rendert nichts, solange die Antwort nicht abgegeben wurde", () => {
    const { container } = render(
      <LessonOralVisualSlot content={VALID_CONTENT} answerSubmitted={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("rendert die Projection nach Antwortabgabe", () => {
    render(
      <LessonOralVisualSlot content={VALID_CONTENT} answerSubmitted={true} />,
    );
    expect(screen.getByTestId("lesson-oral-visual-slot")).toBeInTheDocument();
    expect(
      screen.getByText(/Ein Kernpunkt fehlt noch/i),
    ).toBeInTheDocument();
  });

  it("rendert nichts, wenn learner_visible=false ist", () => {
    const content = {
      oral_visual_projection: {
        ...VALID_CONTENT.oral_visual_projection,
        learner_visible: false,
      },
    };
    const { container } = render(
      <LessonOralVisualSlot content={content} answerSubmitted={true} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("rendert nichts ohne Slot in lesson.content", () => {
    const { container } = render(
      <LessonOralVisualSlot
        content={{ some: "other" }}
        answerSubmitted={true}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("extractOralVisualProjection — Hardregel-Sanitizer", () => {
  it("filtert Hints mit Note-/Prüfungsreife-Tokens raus", () => {
    const p = extractOralVisualProjection({
      oral_visual_projection: {
        curriculum_id: "c1",
        competence_id: "k1",
        oral_question_id: "q1",
        learner_visible: true,
        empty: false,
        disclaimer: "ok",
        hints: [
          {
            kind: "structure_aligned",
            message: "Du hast die Prüfungsreife erreicht.",
            text_alt: "ok",
          },
          {
            kind: "key_node_missing",
            message: "Ein Kernpunkt fehlt noch.",
            text_alt: "Strukturhinweis: fehlender Kernpunkt.",
          },
          {
            kind: "good_practice_reference",
            message: "Diese Struktur ist ein gutes Antwortmuster.",
            text_alt: "Note: 2",
          },
        ],
      },
    });
    expect(p).not.toBeNull();
    expect(p!.hints).toHaveLength(1);
    expect(p!.hints[0].kind).toBe("key_node_missing");
  });

  it("verwirft unbekannte Hint-Kinds", () => {
    const p = extractOralVisualProjection({
      oral_visual_projection: {
        curriculum_id: "c1",
        competence_id: "k1",
        oral_question_id: "q1",
        learner_visible: true,
        empty: false,
        disclaimer: "ok",
        hints: [
          { kind: "final_grade", message: "x", text_alt: "y" },
          {
            kind: "needs_followup_question",
            message: "An dieser Stelle ist eine Rückfrage sinnvoll.",
            text_alt: "Strukturhinweis: Rückfrage sinnvoll.",
          },
        ],
      },
    });
    expect(p!.hints).toHaveLength(1);
    expect(p!.hints[0].kind).toBe("needs_followup_question");
  });

  it("kappt bei max 5 Hints", () => {
    const hints = Array.from({ length: 8 }).map(() => ({
      kind: "structure_aligned",
      message: "Deine Antwort folgt einer gut erkennbaren Struktur.",
      text_alt: "Strukturhinweis: gute Strukturabdeckung.",
    }));
    const p = extractOralVisualProjection({
      oral_visual_projection: {
        curriculum_id: "c1",
        competence_id: "k1",
        oral_question_id: "q1",
        learner_visible: true,
        empty: false,
        disclaimer: "ok",
        hints,
      },
    });
    expect(p!.hints.length).toBeLessThanOrEqual(5);
  });
});

describe("Slot rendert KEINE Admin-/Severity-Felder", () => {
  it("DOM enthält keine severity/confidence/source_refs/blockers", () => {
    const { container } = render(
      <LessonOralVisualSlot content={VALID_CONTENT} answerSubmitted={true} />,
    );
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toContain("severity");
    expect(html).not.toContain("confidence");
    expect(html).not.toContain("source_refs");
    expect(html).not.toContain("blocker");
    // keine "Note" / "Prüfungsreife"-Aussagen
    expect(html).not.toContain("prüfungsreife");
    expect(html).not.toContain("bestanden");
  });
});
