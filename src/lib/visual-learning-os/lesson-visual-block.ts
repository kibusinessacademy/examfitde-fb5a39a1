/**
 * VISUAL.LEARNING.OS — Lesson Visual Block (Cut 4).
 *
 * Pure SSOT Helper: erzeugt aus einer bereits learner-safe projizierten
 * Artifact-Liste einen VisualLessonBlock für eine bestimmte Placement-Position
 * im 5-Schritte-Modell.
 *
 * HARTE REGELN:
 * - Eingaben sind bereits `PublishedVisualArtifact` (approved/published).
 * - Kein DB/HTTP/Clock/RNG/IO.
 * - Keine Pattern-Auswahl.
 * - Kein Throw bei fehlenden Artefakten — leerer, gültiger Block.
 * - Deterministische Sortierung und Auswahl.
 */
import type { PublishedVisualArtifact } from "./contracts";
import {
  FROZEN_LESSON_VISUAL_POLICY,
  type VisualLessonBlockerCode,
  type VisualLessonWarningCode,
} from "./lesson-visual-policy";

export const VISUAL_LESSON_STEP_PLACEMENTS = [
  "entry",
  "understand",
  "apply",
  "repeat",
  "mini_check_context",
] as const;
export type VisualLessonStepPlacement = (typeof VISUAL_LESSON_STEP_PLACEMENTS)[number];

export interface VisualLessonBlockInput {
  placement: VisualLessonStepPlacement;
  lesson_context: {
    curriculum_id: string;
    competence_id: string;
    /** Optional — falls vorhanden, müssen Artefakt-lesson_ids matchen. */
    lesson_id?: string;
  };
  /** Bereits projizierte, learner-safe Artefakte. */
  artifacts: ReadonlyArray<PublishedVisualArtifact>;
}

export interface VisualLessonBlockDecision {
  blockers: VisualLessonBlockerCode[];
  warnings: VisualLessonWarningCode[];
  /** IDs, die aus dem Ergebnis ausgeschlossen wurden, plus Grund. */
  excluded: Array<{ artifact_id: string; reason: VisualLessonBlockerCode }>;
}

export interface VisualLessonBlock {
  placement: VisualLessonStepPlacement;
  lesson_context: VisualLessonBlockInput["lesson_context"];
  primary_visual: PublishedVisualArtifact | null;
  supporting_visuals: PublishedVisualArtifact[];
  decision: VisualLessonBlockDecision;
}

function sortDeterministic(
  list: ReadonlyArray<PublishedVisualArtifact>,
): PublishedVisualArtifact[] {
  return [...list].sort((a, b) => {
    if (b.version !== a.version) return b.version - a.version;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

export function buildVisualLessonBlock(
  input: VisualLessonBlockInput,
): VisualLessonBlock {
  const { placement, lesson_context, artifacts } = input;
  const blockers = new Set<VisualLessonBlockerCode>();
  const warnings = new Set<VisualLessonWarningCode>();
  const excluded: VisualLessonBlockDecision["excluded"] = [];

  const eligible: PublishedVisualArtifact[] = [];

  for (const a of artifacts) {
    // Defense-in-depth: status muss approved/published sein.
    if (a.status !== "approved" && a.status !== "published") {
      excluded.push({ artifact_id: a.id, reason: "VISUAL_LESSON_UNAPPROVED_ARTIFACT" });
      blockers.add("VISUAL_LESSON_UNAPPROVED_ARTIFACT");
      continue;
    }
    if (a.curriculum_id !== lesson_context.curriculum_id) {
      excluded.push({ artifact_id: a.id, reason: "VISUAL_LESSON_CURRICULUM_MISMATCH" });
      continue;
    }
    if (a.competence_id !== lesson_context.competence_id) {
      excluded.push({ artifact_id: a.id, reason: "VISUAL_LESSON_COMPETENCE_MISMATCH" });
      continue;
    }
    if (
      lesson_context.lesson_id &&
      a.lesson_id &&
      a.lesson_id !== lesson_context.lesson_id
    ) {
      excluded.push({ artifact_id: a.id, reason: "VISUAL_LESSON_LESSON_MISMATCH" });
      continue;
    }
    // Barrierearmut: Farbe darf nie alleinige Bedeutung sein.
    if (!a.accessibility?.color_independent_labels) {
      blockers.add("VISUAL_LESSON_COLOR_ONLY_MEANING");
      excluded.push({ artifact_id: a.id, reason: "VISUAL_LESSON_COLOR_ONLY_MEANING" });
      continue;
    }
    eligible.push(a);
  }

  const sorted = sortDeterministic(eligible);
  const primary = sorted[0] ?? null;
  const remainder = sorted.slice(1);
  const supporting = remainder.slice(0, FROZEN_LESSON_VISUAL_POLICY.max_supporting_visuals);

  if (!primary) {
    warnings.add("VISUAL_LESSON_NO_ARTIFACT_AVAILABLE");
  }
  if (remainder.length > FROZEN_LESSON_VISUAL_POLICY.max_supporting_visuals) {
    warnings.add("VISUAL_LESSON_TOO_MANY_SUPPORTING_VISUALS");
  }
  if (
    placement === "mini_check_context" &&
    primary &&
    (!primary.misconceptions || primary.misconceptions.length === 0)
  ) {
    warnings.add("VISUAL_LESSON_NO_MISCONCEPTION_COVERAGE");
  }

  return {
    placement,
    lesson_context,
    primary_visual: primary,
    supporting_visuals: supporting,
    decision: {
      blockers: [...blockers],
      warnings: [...warnings],
      excluded,
    },
  };
}

export function isVisualLessonBlockEmpty(block: VisualLessonBlock): boolean {
  return block.primary_visual === null && block.supporting_visuals.length === 0;
}
