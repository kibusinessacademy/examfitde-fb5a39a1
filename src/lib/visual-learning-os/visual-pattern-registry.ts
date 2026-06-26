/**
 * VISUAL.LEARNING.OS — Pattern Registry (Cut 1).
 *
 * Entscheidet anhand der Kompetenz-Eigenschaften, welcher visuelle
 * Artefakt-Typ einzusetzen ist. Verhindert visuelles Chaos.
 */
import type { VisualArtifactType, VisualPurpose } from "./contracts";

export interface CompetenceVisualFacets {
  requires_sequence_understanding?: boolean;
  requires_concept_differentiation?: boolean;
  requires_rule_application?: boolean;
  has_common_misconceptions?: boolean;
  requires_cause_effect?: boolean;
  requires_timeline?: boolean;
  requires_diagram_reading?: boolean;
  is_oral_exam_topic?: boolean;
}

export interface PatternRule {
  artifact_type: VisualArtifactType;
  /** Höhere Priorität gewinnt bei mehreren Treffern. */
  priority: number;
  matches: (facets: CompetenceVisualFacets, purpose: VisualPurpose) => boolean;
  rationale: string;
}

export const VISUAL_PATTERN_RULES: ReadonlyArray<PatternRule> = Object.freeze([
  {
    artifact_type: "oral_whiteboard",
    priority: 100,
    matches: (_, purpose) => purpose === "oral_exam",
    rationale: "Mündliche Prüfung benötigt Whiteboard-Format.",
  },
  {
    artifact_type: "error_map",
    priority: 90,
    matches: (f, p) => !!f.has_common_misconceptions && (p === "tutor_feedback" || p === "practice"),
    rationale: "Fehler sichtbar machen, wenn Misconceptions bekannt sind.",
  },
  {
    artifact_type: "process_flow",
    priority: 80,
    matches: (f) => !!f.requires_sequence_understanding,
    rationale: "Abläufe und Reihenfolgen.",
  },
  {
    artifact_type: "decision_tree",
    priority: 75,
    matches: (f) => !!f.requires_rule_application,
    rationale: "Regelanwendung, Wenn-dann-Logik.",
  },
  {
    artifact_type: "comparison_matrix",
    priority: 70,
    matches: (f) => !!f.requires_concept_differentiation,
    rationale: "Abgrenzung von Begriffen.",
  },
  {
    artifact_type: "cause_effect_map",
    priority: 65,
    matches: (f) => !!f.requires_cause_effect,
    rationale: "Ursache-Wirkungs-Zusammenhänge.",
  },
  {
    artifact_type: "timeline",
    priority: 60,
    matches: (f) => !!f.requires_timeline,
    rationale: "Fristen, zeitliche Abfolgen.",
  },
  {
    artifact_type: "dashboard_interpretation",
    priority: 55,
    matches: (f) => !!f.requires_diagram_reading,
    rationale: "Daten- und Diagramminterpretation.",
  },
  {
    artifact_type: "concept_map",
    priority: 10,
    matches: () => true,
    rationale: "Fallback für allgemeine Begriffs­zusammenhänge.",
  },
]);

/**
 * Wählt den passenden Artefakt-Typ. Reine Funktion — keine Seiteneffekte,
 * keine DB-Zugriffe, deterministisch.
 */
export function selectVisualPatternForCompetence(
  facets: CompetenceVisualFacets,
  purpose: VisualPurpose,
): { artifact_type: VisualArtifactType; rationale: string } {
  const ranked = [...VISUAL_PATTERN_RULES]
    .filter((r) => r.matches(facets, purpose))
    .sort((a, b) => b.priority - a.priority);
  const winner = ranked[0]!;
  return { artifact_type: winner.artifact_type, rationale: winner.rationale };
}
