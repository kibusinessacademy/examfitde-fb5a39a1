/**
 * VISUAL.LEARNING.OS — AI Draft Pipeline (Cut 6).
 *
 * Orchestriert ausschließlich Pure-Funktionen:
 *   buildVisualAiDraftRequest → normalizeVisualAiOutput
 *   → buildVisualLearningArtifact → reviewVisualLearningArtifact
 *
 * Ruft KEIN LLM. Schreibt nichts. Veröffentlicht nichts.
 */
import { buildVisualLearningArtifact } from "./visual-artifact-factory";
import { reviewVisualLearningArtifact } from "./visual-artifact-review";
import { buildVisualAiDraftRequest } from "./ai-draft-request";
import { normalizeVisualAiOutput } from "./ai-output-normalizer";
import { aiWarning } from "./ai-draft-policy";
import type {
  VisualAiDraftContext,
  VisualAiDraftResult,
  VisualAiRawOutput,
} from "./ai-draft-contracts";

export interface PrepareVisualArtifactDraftFromAiInput {
  context: VisualAiDraftContext;
  raw_output: VisualAiRawOutput | unknown;
  /** Optionaler Override für Tests — deterministisch. Default: EPOCH. */
  created_at?: string;
}

export function prepareVisualArtifactDraftFromAi(
  input: PrepareVisualArtifactDraftFromAiInput,
): VisualAiDraftResult {
  const request = buildVisualAiDraftRequest(input.context);
  const normalized = normalizeVisualAiOutput(input.raw_output, request);

  // Wenn Normalizer blockiert hat → Pipeline stoppt vor Factory/Review.
  if (normalized.blockers.length > 0 || !normalized.normalized_draft) {
    return {
      ...normalized,
      artifact_draft: null,
      review_result: null,
      admin_preview_ready: false,
    };
  }

  const draft = normalized.normalized_draft;

  // Übergabe an die deterministische Factory.
  const { artifact } = buildVisualLearningArtifact({
    artifact_id: input.context.artifact_id,
    curriculum_id: input.context.curriculum_id,
    competence_id: input.context.competence_id,
    lesson_id: input.context.lesson_id,
    blueprint_id: input.context.blueprint_id,
    purpose: input.context.purpose,
    competence_facets: input.context.competence_facets,
    source_refs: input.context.source_refs,
    seed_nodes: draft.nodes.map((n) => ({
      id: n.id,
      role: n.role,
      label: n.label,
      aria_label: n.aria_label,
      glossary_key: n.glossary_key,
    })),
    seed_edges: draft.edges.map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: e.label,
    })),
    misconceptions: draft.misconceptions.map((m) => ({
      kind: m.kind,
      description: m.description,
      target_node_id: m.target_node_id,
      blueprint_misconception_id: m.blueprint_misconception_id,
    })),
    title: draft.title,
    focus_question: draft.focus_question,
    created_at: input.created_at,
  });

  // Defensive Sicherung: niemals approved/published aus AI-Pipeline.
  const safeArtifact =
    artifact.status === "approved" || artifact.status === "published"
      ? { ...artifact, status: "review" as const }
      : artifact;

  const review = reviewVisualLearningArtifact({
    artifact: safeArtifact,
    source_refs: input.context.source_refs,
  });

  const warnings = [...normalized.warnings];
  warnings.push(
    aiWarning(
      "AI_VISUAL_NEEDS_ADMIN_REVIEW",
      `Review-Status nach Gate: ${review.status}. Admin-Freigabe erforderlich.`,
    ),
  );

  return {
    request,
    normalized_draft: draft,
    artifact_draft: safeArtifact,
    review_result: review,
    blockers: normalized.blockers,
    warnings,
    admin_preview_ready: review.status !== "blocked",
    learner_visible: false,
    publishable: false,
  };
}
