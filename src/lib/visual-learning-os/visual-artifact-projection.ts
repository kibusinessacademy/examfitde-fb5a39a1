/**
 * VISUAL.LEARNING.OS — Frontend-Safe Projection (Cut 2).
 *
 * Wandelt ein VisualLearningArtifact in eine PublishedVisualArtifact-Projektion
 * um. Erlaubt NUR für status `approved` oder `published`. Bei anderen Status
 * wird eine blockierende Antwort zurückgegeben — niemals ein Default-Render.
 */
import type {
  PublishedVisualArtifact,
  VisualLearningArtifact,
} from "./contracts";

export type VisualArtifactProjectionResult =
  | { ok: true; artifact: PublishedVisualArtifact }
  | { ok: false; reason: "not_approved"; status: VisualLearningArtifact["status"] };

export function projectPublishedVisualArtifact(
  artifact: VisualLearningArtifact,
): VisualArtifactProjectionResult {
  if (artifact.status !== "approved" && artifact.status !== "published") {
    return { ok: false, reason: "not_approved", status: artifact.status };
  }

  // Whitelist-Projektion — niemals interne Reviewdaten oder Raw-Blueprintdaten ausgeben.
  const projected: PublishedVisualArtifact = {
    id: artifact.id,
    contract_version: artifact.contract_version,
    curriculum_id: artifact.curriculum_id,
    competence_id: artifact.competence_id,
    lesson_id: artifact.lesson_id,
    // blueprint_id wird bewusst NICHT projiziert (interne SSOT-Verkettung).
    artifact_type: artifact.artifact_type,
    purpose: artifact.purpose,
    title: artifact.title,
    focus_question: artifact.focus_question,
    nodes: artifact.nodes.map((n) => ({
      id: n.id,
      role: n.role,
      label: n.label,
      glossary_key: n.glossary_key,
      aria_label: n.aria_label,
      x: n.x,
      y: n.y,
    })),
    edges: artifact.edges.map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      label: e.label,
    })),
    misconceptions: artifact.misconceptions?.map((m) => ({
      kind: m.kind,
      target_node_id: m.target_node_id,
      target_edge: m.target_edge,
      description: m.description,
      // blueprint_misconception_id bewusst entfernt.
    })),
    accessibility: {
      text_summary: artifact.accessibility.text_summary,
      color_independent_labels: artifact.accessibility.color_independent_labels,
      screen_reader_description: artifact.accessibility.screen_reader_description,
    },
    // assessment_rubric bewusst NICHT projiziert (interne Scoring-Logik).
    status: artifact.status,
    version: artifact.version,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
  };

  return { ok: true, artifact: projected };
}
