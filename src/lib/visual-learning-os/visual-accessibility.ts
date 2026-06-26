/**
 * VISUAL.LEARNING.OS — Accessibility Rules (Cut 1).
 *
 * WCAG-konformer Guard: Farbe darf nie alleinige Informationsquelle sein.
 * Pflicht: text_summary + screen_reader_description + color_independent_labels.
 */
import type { VisualLearningArtifact } from "./contracts";
import { ALLOWED_SEMANTIC_COLOR_TOKENS, NODE_GRAMMAR } from "./visual-grammar";

export interface AccessibilityReport {
  ok: boolean;
  violations: Array<{ rule: string; detail: string }>;
}

/**
 * Read-only Guard: prüft ein Artefakt auf Accessibility-Konformität,
 * ohne es zu mutieren. Wird vom Review-Gate vor `approved` aufgerufen.
 */
export function assertVisualAccessibility(a: VisualLearningArtifact): AccessibilityReport {
  const violations: AccessibilityReport["violations"] = [];

  if (!a.accessibility?.text_summary?.trim()) {
    violations.push({ rule: "text_summary_required", detail: "text_summary fehlt." });
  }
  if (!a.accessibility?.screen_reader_description?.trim()) {
    violations.push({ rule: "screen_reader_description_required", detail: "screen_reader_description fehlt." });
  }
  if (a.accessibility?.color_independent_labels !== true) {
    violations.push({
      rule: "color_independent_labels",
      detail: "Farbe darf nicht alleinige Informationsquelle sein (WCAG 1.4.1).",
    });
  }

  // Pflicht: jeder Knoten hat sichtbares Label ODER aria_label.
  for (const n of a.nodes) {
    if (!n.label?.trim() && !n.aria_label?.trim()) {
      violations.push({ rule: "node_label_required", detail: `Knoten ${n.id} ohne Label.` });
    }
    const rule = NODE_GRAMMAR[n.role];
    if (!rule) {
      violations.push({ rule: "unknown_node_role", detail: `Knoten ${n.id}: Rolle ${n.role} nicht in Grammar.` });
      continue;
    }
    if (!ALLOWED_SEMANTIC_COLOR_TOKENS.includes(rule.semantic_color_token)) {
      violations.push({
        rule: "non_semantic_color",
        detail: `Knoten ${n.id} nutzt nicht-semantisches Color-Token ${rule.semantic_color_token}.`,
      });
    }
  }

  // Kanten: Label ist Pflicht für „contrasts_with" / „exception_of" / „blocks".
  for (const e of a.edges) {
    const needsLabel = ["contrasts_with", "exception_of", "blocks"].includes(e.kind);
    if (needsLabel && !e.label?.trim()) {
      violations.push({
        rule: "edge_label_required",
        detail: `Kante ${e.from}→${e.to} (${e.kind}) benötigt sichtbares Label.`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
