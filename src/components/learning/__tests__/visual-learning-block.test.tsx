/**
 * VISUAL.LEARNING.OS — Cut 4 Tests.
 *
 * Pflichttests 1–22 für Lesson Integration / Visual Learning Block.
 * Pure: kein DB/HTTP/Supabase im Pfad.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";

import {
  buildVisualLessonBlock,
  isVisualLessonBlockEmpty,
  type VisualLessonBlock,
  type VisualLessonStepPlacement,
} from "@/lib/visual-learning-os/lesson-visual-block";
import {
  LEARNER_SAFE_FIXTURE_ARTIFACT,
  LEARNER_SAFE_FIXTURE_ARTIFACT_2,
} from "@/lib/visual-learning-os/fixtures";
import type { PublishedVisualArtifact } from "@/lib/visual-learning-os/contracts";
import VisualLearningBlock from "@/components/learning/VisualLearningBlock";

const BASE_CTX = {
  curriculum_id: LEARNER_SAFE_FIXTURE_ARTIFACT.curriculum_id,
  competence_id: LEARNER_SAFE_FIXTURE_ARTIFACT.competence_id,
  lesson_id: LEARNER_SAFE_FIXTURE_ARTIFACT.lesson_id,
};

function makeBlock(
  overrides: {
    placement?: VisualLessonStepPlacement;
    artifacts?: PublishedVisualArtifact[];
    ctx?: Partial<typeof BASE_CTX>;
  } = {},
): VisualLessonBlock {
  return buildVisualLessonBlock({
    placement: overrides.placement ?? "understand",
    lesson_context: { ...BASE_CTX, ...overrides.ctx },
    artifacts: overrides.artifacts ?? [LEARNER_SAFE_FIXTURE_ARTIFACT],
  });
}

// Static-source scans
const FILES = {
  block: readFileSync(
    path.resolve(__dirname, "../VisualLearningBlock.tsx"),
    "utf8",
  ),
  helper: readFileSync(
    path.resolve(
      __dirname,
      "../../../lib/visual-learning-os/lesson-visual-block.ts",
    ),
    "utf8",
  ),
  policy: readFileSync(
    path.resolve(
      __dirname,
      "../../../lib/visual-learning-os/lesson-visual-policy.ts",
    ),
    "utf8",
  ),
};

describe("VISUAL.LEARNING.OS — Cut 4 Helper", () => {
  it("1. buildVisualLessonBlock ist deterministisch", () => {
    const a = makeBlock();
    const b = makeBlock();
    expect(a).toEqual(b);
  });

  it("2. Freigegebenes Artifact mit passenden IDs wird akzeptiert", () => {
    const block = makeBlock();
    expect(block.primary_visual?.id).toBe(LEARNER_SAFE_FIXTURE_ARTIFACT.id);
    expect(block.decision.blockers).toHaveLength(0);
  });

  it("3. Mismatch curriculum_id schließt aus", () => {
    const block = makeBlock({ ctx: { curriculum_id: "other-curr" } });
    expect(block.primary_visual).toBeNull();
    expect(
      block.decision.excluded.some((e) => e.reason === "VISUAL_LESSON_CURRICULUM_MISMATCH"),
    ).toBe(true);
  });

  it("4. Mismatch competence_id schließt aus", () => {
    const block = makeBlock({ ctx: { competence_id: "other-comp" } });
    expect(block.primary_visual).toBeNull();
    expect(
      block.decision.excluded.some((e) => e.reason === "VISUAL_LESSON_COMPETENCE_MISMATCH"),
    ).toBe(true);
  });

  it("5. Draft/Review/Unapproved Artefakte werden ausgeschlossen", () => {
    const draft = {
      ...LEARNER_SAFE_FIXTURE_ARTIFACT,
      // Defense-in-depth: simulate downstream contamination.
      status: "draft" as unknown as "approved",
    } as PublishedVisualArtifact;
    const block = buildVisualLessonBlock({
      placement: "understand",
      lesson_context: BASE_CTX,
      artifacts: [draft],
    });
    expect(block.primary_visual).toBeNull();
    expect(block.decision.blockers).toContain("VISUAL_LESSON_UNAPPROVED_ARTIFACT");
  });

  it("6. Kein Artifact ergibt gültigen Empty Block", () => {
    const block = makeBlock({ artifacts: [] });
    expect(isVisualLessonBlockEmpty(block)).toBe(true);
    expect(block.decision.warnings).toContain("VISUAL_LESSON_NO_ARTIFACT_AVAILABLE");
  });

  it("7. Maximal 1 Primary Visual pro Placement", () => {
    const block = makeBlock({
      artifacts: [LEARNER_SAFE_FIXTURE_ARTIFACT, LEARNER_SAFE_FIXTURE_ARTIFACT_2],
    });
    expect(block.primary_visual).not.toBeNull();
    // Es existiert genau ein primary visual — Rest ist supporting.
    expect(block.supporting_visuals.find((s) => s.id === block.primary_visual?.id)).toBeUndefined();
  });

  it("8. Supporting Visuals werden begrenzt und deterministisch sortiert", () => {
    const many: PublishedVisualArtifact[] = Array.from({ length: 8 }, (_, i) => ({
      ...LEARNER_SAFE_FIXTURE_ARTIFACT,
      id: `fixture-art-${String(i).padStart(2, "0")}`,
      version: 1,
    }));
    const block = buildVisualLessonBlock({
      placement: "understand",
      lesson_context: BASE_CTX,
      artifacts: many,
    });
    expect(block.supporting_visuals.length).toBeLessThanOrEqual(3);
    // Deterministische Sortierung (id asc bei gleicher version).
    const ids = [block.primary_visual?.id, ...block.supporting_visuals.map((s) => s.id)];
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(block.decision.warnings).toContain("VISUAL_LESSON_TOO_MANY_SUPPORTING_VISUALS");
  });

  it("mini_check_context ohne misconceptions warnt", () => {
    const noMisconceptions: PublishedVisualArtifact = {
      ...LEARNER_SAFE_FIXTURE_ARTIFACT,
      misconceptions: [],
    };
    const block = buildVisualLessonBlock({
      placement: "mini_check_context",
      lesson_context: BASE_CTX,
      artifacts: [noMisconceptions],
    });
    expect(block.decision.warnings).toContain("VISUAL_LESSON_NO_MISCONCEPTION_COVERAGE");
  });
});

describe("VISUAL.LEARNING.OS — Cut 4 Learner Renderer", () => {
  it("9. VisualLearningBlock rendert learner-safe ohne DB/HTTP", () => {
    const block = makeBlock();
    render(<VisualLearningBlock block={block} />);
    expect(screen.getByTestId("vlo-learner-block")).toBeInTheDocument();
    expect(screen.getByTestId("vlo-learner-primary")).toBeInTheDocument();
  });

  it("10. VisualLearningBlock zeigt Empty State sauber", () => {
    const block = makeBlock({ artifacts: [] });
    render(<VisualLearningBlock block={block} />);
    const empty = screen.getByTestId("vlo-learner-empty");
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toMatch(/keine visuelle Struktur/i);
  });

  it("11. VisualLearningBlock zeigt Legende und Textalternative", () => {
    const block = makeBlock();
    render(<VisualLearningBlock block={block} />);
    expect(screen.getByTestId("vlo-learner-legend")).toBeInTheDocument();
    expect(screen.getByTestId("vlo-learner-text-alternative")).toBeInTheDocument();
  });

  it("12. Farbe erscheint nie ohne Label/Text (alle Nodes haben Textinhalt)", () => {
    const block = makeBlock();
    render(<VisualLearningBlock block={block} />);
    for (const n of screen.getAllByTestId("vlo-learner-node")) {
      expect(n.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("13. Source-Refs werden kompakt sichtbar gemacht", () => {
    const block = makeBlock();
    render(<VisualLearningBlock block={block} sourceRefs={["ssot://x#y"]} />);
    const refs = screen.getByTestId("vlo-learner-source-refs");
    expect(within(refs).getByText("ssot://x#y")).toBeInTheDocument();
  });

  it("14. Misconception-Hinweise werden angezeigt, wenn vorhanden", () => {
    const block = makeBlock();
    render(<VisualLearningBlock block={block} />);
    expect(screen.getByTestId("vlo-learner-misconceptions")).toBeInTheDocument();
    expect(screen.getAllByTestId("vlo-learner-misconception").length).toBeGreaterThanOrEqual(1);
  });
});

describe("VISUAL.LEARNING.OS — Cut 4 Static Source Guards", () => {
  it("15. Keine Learning-Komponente importiert Supabase", () => {
    expect(FILES.block).not.toMatch(/from\s+["']@\/integrations\/supabase/);
    expect(FILES.block).not.toMatch(/@supabase\/supabase-js/);
  });

  it("16. Keine Learning-Komponente importiert selectVisualPatternForCompetence()", () => {
    expect(FILES.block).not.toMatch(/selectVisualPatternForCompetence/);
  });

  it("17. Keine Learning-Komponente importiert buildVisualLearningArtifact()", () => {
    expect(FILES.block).not.toMatch(/buildVisualLearningArtifact/);
  });

  it("18. Keine Learning-Komponente importiert reviewVisualLearningArtifact()", () => {
    expect(FILES.block).not.toMatch(/reviewVisualLearningArtifact/);
  });

  it("19. Keine Draft/Admin-Preview-Texte erscheinen im Lernenden-Renderer", () => {
    expect(FILES.block).not.toMatch(/admin[_\s-]?preview/i);
    expect(FILES.block).not.toMatch(/\bdraft\b/i);
    expect(FILES.block).not.toMatch(/publishable/i);
    expect(FILES.block).not.toMatch(/review[_\s-]?status/i);
  });

  it("20. Helper enthält keine HTTP/DB/IO-Aufrufe", () => {
    expect(FILES.helper).not.toMatch(/\bfetch\s*\(/);
    expect(FILES.helper).not.toMatch(/supabase/i);
    expect(FILES.helper).not.toMatch(/\.rpc\(/);
  });

  it("21. Policy-Codes sind frozen exportiert", () => {
    expect(FILES.policy).toMatch(/FROZEN_LESSON_VISUAL_POLICY/);
    expect(FILES.policy).toMatch(/Object\.freeze/);
  });

  it("22. Bestehender Lesson-Flow bleibt mit und ohne Visual Block renderbar (Empty State erträglich)", () => {
    const empty = makeBlock({ artifacts: [] });
    const filled = makeBlock();
    expect(() => render(<VisualLearningBlock block={empty} />)).not.toThrow();
    expect(() => render(<VisualLearningBlock block={filled} />)).not.toThrow();
  });
});
