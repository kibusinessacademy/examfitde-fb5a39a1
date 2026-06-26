/**
 * VISUAL.LEARNING.OS — Frozen Contracts (Cut 1).
 *
 * Single Source of Truth für visuelle Lern- und Prüfungsartefakte.
 * Diese Typen sind eingefroren und nur per Major-Version änderbar.
 *
 * Lifecycle: draft → review → approved → published.
 * Frontend rendert nur `approved` oder `published`.
 */

export const VISUAL_LEARNING_OS_CONTRACT_VERSION = "1.0.0" as const;

/** Artefakt-Typen — entsprechen Pattern Registry. */
export const VISUAL_ARTIFACT_TYPES = [
  "concept_map",
  "process_flow",
  "decision_tree",
  "comparison_matrix",
  "timeline",
  "cause_effect_map",
  "error_map",
  "dashboard_interpretation",
  "oral_whiteboard",
] as const;
export type VisualArtifactType = (typeof VISUAL_ARTIFACT_TYPES)[number];

/** Einsatzzweck — bestimmt Pipeline und UI-Surface. */
export const VISUAL_PURPOSES = [
  "learn",
  "practice",
  "exam",
  "oral_exam",
  "tutor_feedback",
  "handbook",
] as const;
export type VisualPurpose = (typeof VISUAL_PURPOSES)[number];

/** Knotenrollen — SSOT für Visual Grammar. */
export const VISUAL_NODE_ROLES = [
  "concept",
  "process_step",
  "actor",
  "document",
  "rule",
  "exception",
  "risk",
  "decision",
  "example",
  "misconception",
] as const;
export type VisualNodeRole = (typeof VISUAL_NODE_ROLES)[number];

/** Beziehungstypen zwischen Knoten — kanonisch. */
export const VISUAL_EDGE_KINDS = [
  "requires",
  "causes",
  "belongs_to",
  "contrasts_with",
  "precedes",
  "blocks",
  "explains",
  "exception_of",
] as const;
export type VisualEdgeKind = (typeof VISUAL_EDGE_KINDS)[number];

/** Misconception-Klassen — Eingang für Tutor- und Assessment-Logik. */
export const VISUAL_MISCONCEPTION_KINDS = [
  "wrong_link",
  "missing_node",
  "false_order",
  "overgeneralization",
  "exception_ignored",
  "diagram_misread",
] as const;
export type VisualMisconceptionKind = (typeof VISUAL_MISCONCEPTION_KINDS)[number];

/** Lifecycle-Status. */
export const VISUAL_ARTIFACT_STATUS = ["draft", "review", "approved", "published"] as const;
export type VisualArtifactStatus = (typeof VISUAL_ARTIFACT_STATUS)[number];

export interface VisualNode {
  id: string;
  role: VisualNodeRole;
  label: string;
  /** Optionaler Glossar-Schlüssel — SSOT-gebunden. */
  glossary_key?: string;
  /** Optionaler Hinweis für Screen-Reader (überschreibt Label). */
  aria_label?: string;
  /** Optionale Position für deterministisches Rendering (0..1). */
  x?: number;
  y?: number;
}

export interface VisualEdge {
  from: string;
  to: string;
  kind: VisualEdgeKind;
  /** Kurzer Beziehungstext, der im Diagramm sichtbar wird. */
  label?: string;
}

export interface VisualMisconception {
  kind: VisualMisconceptionKind;
  /** Knoten oder Kante, an dem der typische Fehler auftritt. */
  target_node_id?: string;
  target_edge?: { from: string; to: string };
  description: string;
  /** Verweis auf bestehende Blueprint-Misconception, falls vorhanden. */
  blueprint_misconception_id?: string;
}

export interface VisualAssessmentCheck {
  kind:
    | "node_position_correct"
    | "edge_relation_correct"
    | "sequence_correct"
    | "misconception_avoided"
    | "explanation_quality"
    | "node_grouping_correct";
  /** Gewicht in Prozentpunkten (Summe aller Checks = 100). */
  weight: number;
}

export interface VisualAssessmentRubric {
  checks: VisualAssessmentCheck[];
  /** Minimal-Score (0–100) für „bestanden". */
  passing_score: number;
}

export interface VisualAccessibility {
  /** Pflicht: textliche Zusammenfassung des Artefakts. */
  text_summary: string;
  /** Bestätigung, dass keine Information nur über Farbe getragen wird. */
  color_independent_labels: boolean;
  /** Beschreibung für Screen-Reader (semantisch, nicht visuell). */
  screen_reader_description: string;
}

/** Das zentrale Kernobjekt. */
export interface VisualLearningArtifact {
  id: string;
  contract_version: typeof VISUAL_LEARNING_OS_CONTRACT_VERSION;

  curriculum_id: string;
  competence_id: string;
  lesson_id?: string;
  blueprint_id?: string;

  artifact_type: VisualArtifactType;
  purpose: VisualPurpose;

  title: string;
  focus_question: string;

  nodes: VisualNode[];
  edges: VisualEdge[];

  misconceptions?: VisualMisconception[];
  assessment_rubric?: VisualAssessmentRubric;

  accessibility: VisualAccessibility;

  status: VisualArtifactStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

/** Frontend-sichere Projektion — niemals Drafts ausliefern. */
export type PublishedVisualArtifact = VisualLearningArtifact & {
  status: "approved" | "published";
};

export const FROZEN_VISUAL_CONTRACTS = Object.freeze({
  version: VISUAL_LEARNING_OS_CONTRACT_VERSION,
  artifactTypes: VISUAL_ARTIFACT_TYPES,
  purposes: VISUAL_PURPOSES,
  nodeRoles: VISUAL_NODE_ROLES,
  edgeKinds: VISUAL_EDGE_KINDS,
  misconceptionKinds: VISUAL_MISCONCEPTION_KINDS,
  status: VISUAL_ARTIFACT_STATUS,
});
