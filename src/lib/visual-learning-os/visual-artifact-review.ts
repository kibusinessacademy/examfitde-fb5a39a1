/**
 * VISUAL.LEARNING.OS — Review Gate (Cut 2).
 *
 * Kombiniert Accessibility-Guard, Rubric-Validator, SSOT-Refs, Mindest­struktur,
 * Source-Refs und Forbidden-Behavior-Prüfung zu einem deterministischen Urteil.
 */
import type { VisualLearningArtifact } from "./contracts";
import { assertVisualAccessibility } from "./visual-accessibility";
import { validateRubric } from "./visual-assessment";
import { ALLOWED_SEMANTIC_COLOR_TOKENS, NODE_GRAMMAR } from "./visual-grammar";
import {
  blocker,
  containsHexColor,
  containsTailwindColorClass,
  EDGE_KINDS_REQUIRING_LABEL,
  MIN_EDGE_COUNT,
  MIN_NODE_COUNT,
  warning,
  type VisualArtifactBlocker,
  type VisualArtifactWarning,
} from "./visual-artifact-policy";

export interface VisualArtifactReviewResult {
  status: "approved" | "needs_revision" | "blocked";
  blockers: VisualArtifactBlocker[];
  warnings: VisualArtifactWarning[];
  publishable: boolean;
}

export interface VisualArtifactReviewInput {
  artifact: VisualLearningArtifact;
  /** Pflicht: source_refs fließen nicht ins Artefakt selbst, sondern in das Review. */
  source_refs: string[];
}

export function reviewVisualLearningArtifact(
  input: VisualArtifactReviewInput,
): VisualArtifactReviewResult {
  const blockers: VisualArtifactBlocker[] = [];
  const warnings: VisualArtifactWarning[] = [];
  const a = input.artifact;

  // SSOT-Refs
  if (!a.curriculum_id?.trim()) {
    blockers.push(blocker("missing_curriculum_id", "curriculum_id fehlt."));
  }
  if (!a.competence_id?.trim()) {
    blockers.push(blocker("missing_competence_id", "competence_id fehlt."));
  }
  if (!Array.isArray(input.source_refs) || input.source_refs.length === 0) {
    blockers.push(
      blocker("missing_source_refs", "Jede fachliche Aussage benötigt mindestens eine source_ref."),
    );
  }

  // Factory darf nicht direkt approved/published rauspusten.
  if (a.status === "approved" || a.status === "published") {
    blockers.push(
      blocker(
        "factory_published_status_forbidden",
        `Artefakt darf nicht im Status "${a.status}" zur Review kommen.`,
      ),
    );
  }

  // Mindeststruktur
  if (a.nodes.length < MIN_NODE_COUNT) {
    blockers.push(
      blocker(
        "insufficient_node_count",
        `Mindestens ${MIN_NODE_COUNT} Nodes erforderlich (aktuell ${a.nodes.length}).`,
      ),
    );
  }
  if (a.edges.length < MIN_EDGE_COUNT) {
    blockers.push(
      blocker(
        "insufficient_edge_count",
        `Mindestens ${MIN_EDGE_COUNT} Edge erforderlich (aktuell ${a.edges.length}).`,
      ),
    );
  }

  // Farb- und Class-Prüfung über Labels und Roles
  for (const n of a.nodes) {
    if (containsHexColor(n.label) || containsHexColor(n.aria_label)) {
      blockers.push(blocker("hex_color_forbidden", `Knoten ${n.id} enthält Hex-Farbe im Label.`));
    }
    if (containsTailwindColorClass(n.label) || containsTailwindColorClass(n.aria_label)) {
      blockers.push(
        blocker("tailwind_color_class_forbidden", `Knoten ${n.id} enthält Tailwind-Farbklasse.`),
      );
    }
    const rule = NODE_GRAMMAR[n.role];
    if (rule && !ALLOWED_SEMANTIC_COLOR_TOKENS.includes(rule.semantic_color_token)) {
      blockers.push(
        blocker(
          "disallowed_color_token",
          `Knoten ${n.id} nutzt nicht-semantisches Token ${rule.semantic_color_token}.`,
        ),
      );
    }
  }
  for (const e of a.edges) {
    if (containsHexColor(e.label)) {
      blockers.push(
        blocker("hex_color_forbidden", `Kante ${e.from}→${e.to} enthält Hex-Farbe im Label.`),
      );
    }
    if (containsTailwindColorClass(e.label)) {
      blockers.push(
        blocker(
          "tailwind_color_class_forbidden",
          `Kante ${e.from}→${e.to} enthält Tailwind-Farbklasse.`,
        ),
      );
    }
    if (EDGE_KINDS_REQUIRING_LABEL.includes(e.kind) && !e.label?.trim()) {
      blockers.push(
        blocker(
          "missing_edge_label_for_critical_kind",
          `Kante ${e.from}→${e.to} (${e.kind}) benötigt sichtbares Label.`,
        ),
      );
    }
  }

  // Rubric
  if (!a.assessment_rubric) {
    blockers.push(blocker("rubric_invalid", "assessment_rubric fehlt."));
  } else {
    const r = validateRubric(a.assessment_rubric);
    if (!r.ok) {
      blockers.push(blocker("rubric_invalid", r.reason ?? "Rubric ungültig."));
    }
  }

  // Accessibility (kombiniert Color-Only-Meaning + Token-Check)
  const acc = assertVisualAccessibility(a);
  if (!acc.ok) {
    for (const v of acc.violations) {
      if (v.rule === "color_independent_labels") {
        blockers.push(blocker("color_only_meaning", v.detail));
      } else if (v.rule === "non_semantic_color") {
        blockers.push(blocker("disallowed_color_token", v.detail));
      } else {
        blockers.push(blocker("accessibility_violation", `${v.rule}: ${v.detail}`));
      }
    }
  }

  // Warnings
  if (!a.misconceptions || a.misconceptions.length === 0) {
    warnings.push(
      warning("no_misconceptions_declared", "Keine typischen Fehlerbilder hinterlegt."),
    );
  }
  if (a.nodes.length < 4) {
    warnings.push(warning("low_node_count", "Wenige Nodes — Aussagekraft prüfen."));
  }
  if (a.edges.length < Math.max(1, a.nodes.length - 1)) {
    warnings.push(warning("low_edge_density", "Edge-Dichte gering."));
  }

  if (blockers.length > 0) {
    return { status: "blocked", blockers, warnings, publishable: false };
  }

  // Ohne Blocker, aber Status nicht review → braucht Revision (z. B. draft ohne Struktur).
  if (a.status !== "review") {
    return {
      status: "needs_revision",
      blockers,
      warnings,
      publishable: false,
    };
  }

  return { status: "approved", blockers, warnings, publishable: true };
}
