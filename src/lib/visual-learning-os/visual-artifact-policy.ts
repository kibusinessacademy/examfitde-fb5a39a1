/**
 * VISUAL.LEARNING.OS — Factory Policies (Cut 2).
 *
 * Frozen Forbidden Behaviors für die Visual Artifact Factory und das
 * Review-Gate. Diese Regeln sind unverletzbar — wer dagegen verstößt,
 * darf weder approved noch published werden.
 */
import { ALLOWED_SEMANTIC_COLOR_TOKENS } from "./visual-grammar";
import type { VisualArtifactStatus, VisualLearningArtifact } from "./contracts";

export const VISUAL_ARTIFACT_BLOCKER_CODES = [
  "missing_curriculum_id",
  "missing_competence_id",
  "missing_source_refs",
  "unsupported_status_transition",
  "disallowed_color_token",
  "hex_color_forbidden",
  "tailwind_color_class_forbidden",
  "color_only_meaning",
  "frontend_only_logic_forbidden",
  "unreviewed_publish_attempt",
  "insufficient_node_count",
  "insufficient_edge_count",
  "missing_edge_label_for_critical_kind",
  "rubric_invalid",
  "accessibility_violation",
  "pattern_decision_outside_registry",
  "unknown_artifact_type",
  "factory_published_status_forbidden",
] as const;
export type VisualArtifactBlockerCode = (typeof VISUAL_ARTIFACT_BLOCKER_CODES)[number];

export const VISUAL_ARTIFACT_WARNING_CODES = [
  "no_misconceptions_declared",
  "low_node_count",
  "low_edge_density",
] as const;
export type VisualArtifactWarningCode = (typeof VISUAL_ARTIFACT_WARNING_CODES)[number];

export interface VisualArtifactBlocker {
  code: VisualArtifactBlockerCode;
  detail: string;
}

export interface VisualArtifactWarning {
  code: VisualArtifactWarningCode;
  detail: string;
}

/** Frozen Forbidden Behaviors — als Dokumentation und Runtime-Referenz. */
export const VISUAL_ARTIFACT_FORBIDDEN_BEHAVIORS = Object.freeze([
  "Artefakt ohne curriculum_id erzeugen oder veröffentlichen.",
  "Artefakt ohne competence_id erzeugen oder veröffentlichen.",
  "Published-Output direkt aus Draft.",
  "Hex-Farben in Nodes/Edges/Grammar.",
  "Tailwind-Farbklassen (text-red-500, bg-blue-600, …).",
  "Farbe als alleiniger Bedeutungsträger (ohne Label/Shape/Icon).",
  "Fachliche Aussage ohne source_refs.",
  "Pattern-Auswahl im Frontend.",
  "LLM-generierte Artefakte ohne Review-Gate.",
  "Factory erzeugt status = approved oder published.",
]);

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const TAILWIND_COLOR_RE =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|placeholder|caret|decoration|divide|outline|shadow|accent)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black)(?:-\d{2,3})?\b/;

export function isAllowedSemanticColorToken(token: string): boolean {
  return ALLOWED_SEMANTIC_COLOR_TOKENS.includes(token);
}

export function containsHexColor(value: string | undefined | null): boolean {
  if (!value) return false;
  return HEX_RE.test(value);
}

export function containsTailwindColorClass(value: string | undefined | null): boolean {
  if (!value) return false;
  return TAILWIND_COLOR_RE.test(value);
}

/** Erlaubte Übergänge — Factory darf NIE direkt approved/published setzen. */
const ALLOWED_TRANSITIONS: Record<VisualArtifactStatus, VisualArtifactStatus[]> = {
  draft: ["draft", "review"],
  review: ["review", "approved", "draft"],
  approved: ["approved", "published"],
  published: ["published"],
};

export function isAllowedStatusTransition(
  from: VisualArtifactStatus,
  to: VisualArtifactStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Factory darf maximal draft oder review setzen. */
export const FACTORY_ALLOWED_OUTPUT_STATUS: ReadonlyArray<VisualArtifactStatus> = Object.freeze([
  "draft",
  "review",
]);

/** Pflicht-Label für kritische Edge-Typen. */
export const EDGE_KINDS_REQUIRING_LABEL = Object.freeze([
  "contrasts_with",
  "exception_of",
  "blocks",
]);

/** Mindeststruktur. */
export const MIN_NODE_COUNT = 2;
export const MIN_EDGE_COUNT = 1;

export interface PolicyCheckContext {
  artifact: VisualLearningArtifact;
}

export function blocker(code: VisualArtifactBlockerCode, detail: string): VisualArtifactBlocker {
  return { code, detail };
}

export function warning(code: VisualArtifactWarningCode, detail: string): VisualArtifactWarning {
  return { code, detail };
}
