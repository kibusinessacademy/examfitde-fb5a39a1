/**
 * VISUAL.LEARNING.OS — AI Draft Policy (Cut 6).
 *
 * Frozen Policy für AI-assisted Visual Drafting.
 * AI darf nur Draft-Vorschläge liefern. Jeder Vorschlag muss durch
 * Factory + Review-Gate + Admin Review. Kein Auto-Publish, keine
 * Learner-Sichtbarkeit, keine LLM-Logik im Frontend.
 *
 * Pure: kein DB/HTTP/Clock/RNG/IO.
 */
import { containsHexColor, containsTailwindColorClass } from "./visual-artifact-policy";

export const AI_VISUAL_DRAFT_BLOCKER_CODES = [
  "AI_VISUAL_MISSING_CURRICULUM_ID",
  "AI_VISUAL_MISSING_COMPETENCE_ID",
  "AI_VISUAL_MISSING_SOURCE_REFS",
  "AI_VISUAL_UNSUPPORTED_PURPOSE",
  "AI_VISUAL_OUTPUT_NOT_STRUCTURED",
  "AI_VISUAL_OUTPUT_CONTAINS_FREE_CLAIMS",
  "AI_VISUAL_OUTPUT_CONTAINS_HEX_COLOR",
  "AI_VISUAL_OUTPUT_CONTAINS_TAILWIND_COLOR",
  "AI_VISUAL_OUTPUT_COLOR_ONLY_MEANING",
  "AI_VISUAL_OUTPUT_UNSUPPORTED_NODE_TYPE",
  "AI_VISUAL_OUTPUT_UNSUPPORTED_EDGE_TYPE",
  "AI_VISUAL_OUTPUT_UNSUPPORTED_MISCONCEPTION_TYPE",
  "AI_VISUAL_DIRECT_PUBLISH_FORBIDDEN",
  "AI_VISUAL_LEARNER_VISIBLE_FORBIDDEN",
  "AI_VISUAL_FRONTEND_PROMPTING_FORBIDDEN",
  "AI_VISUAL_SERVICE_KEY_CLIENT_FORBIDDEN",
] as const;
export type AiVisualDraftBlockerCode = (typeof AI_VISUAL_DRAFT_BLOCKER_CODES)[number];

export const AI_VISUAL_DRAFT_WARNING_CODES = [
  "AI_VISUAL_LOW_SOURCE_REF_COVERAGE",
  "AI_VISUAL_NO_MISCONCEPTIONS_PROPOSED",
  "AI_VISUAL_TOO_MANY_NODES",
  "AI_VISUAL_TOO_MANY_EDGES",
  "AI_VISUAL_NEEDS_ADMIN_REVIEW",
  "AI_VISUAL_REDUCED_TO_SAFE_SUBSET",
] as const;
export type AiVisualDraftWarningCode = (typeof AI_VISUAL_DRAFT_WARNING_CODES)[number];

export interface AiVisualDraftBlocker {
  code: AiVisualDraftBlockerCode;
  detail: string;
}

export interface AiVisualDraftWarning {
  code: AiVisualDraftWarningCode;
  detail: string;
}

export const FROZEN_AI_VISUAL_DRAFT_POLICY = Object.freeze({
  version: "1.0.0",
  /** AI darf maximal so viele Elemente vorschlagen. Alles darüber wird zurückgekürzt. */
  max_nodes: 24,
  max_edges: 36,
  max_misconceptions: 8,
  /** AI-Output bleibt immer Draft/Review. Never approved/published. */
  allowed_output_status: Object.freeze(["draft", "review"] as const),
  /** Schwelle für Source-Ref-Abdeckung (Warning bei Unterschreitung). */
  min_source_ref_coverage_ratio: 0.8,
  forbidden_behaviors: Object.freeze([
    "AI-Output direkt als approved/published persistieren.",
    "AI-Output direkt an Lernende rendern.",
    "AI-Prompts in React-Komponenten erzeugen.",
    "Service-Role-Keys im Client verwenden.",
    "Hex-Farben oder Tailwind-Farbklassen vorschlagen.",
    "Farbe als alleiniger Bedeutungsträger.",
    "Fachliche Behauptung ohne source_ref.",
    "Unbekannte Node-/Edge-/Misconception-Typen einführen.",
    "Pattern-Auswahl umgehen (Factory ist Pflicht).",
    "Review-Gate überspringen.",
  ]),
});

export function aiBlocker(code: AiVisualDraftBlockerCode, detail: string): AiVisualDraftBlocker {
  return { code, detail };
}

export function aiWarning(code: AiVisualDraftWarningCode, detail: string): AiVisualDraftWarning {
  return { code, detail };
}

/** Verbotene Publish-Signale im rohen AI-Output. */
export function containsForbiddenPublishSignal(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  const status = typeof obj.status === "string" ? obj.status.toLowerCase() : "";
  if (status === "approved" || status === "published") return true;
  if (obj.publish === true || obj.publishable === true || obj.auto_publish === true) return true;
  if (obj.publish_now === true || obj.is_published === true) return true;
  return false;
}

/** Verbotene Learner-Sichtbarkeitssignale im rohen AI-Output. */
export function containsForbiddenLearnerVisibilitySignal(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  if (obj.learner_visible === true || obj.visible_to_learner === true) return true;
  if (obj.show_to_learner === true || obj.expose_to_learner === true) return true;
  return false;
}

/** Verbotene Farbsignale (Hex oder Tailwind) in beliebigem String-Feld. */
export function containsForbiddenColorSignal(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return containsHexColor(value) || containsTailwindColorClass(value);
}

/** Heuristik: roher Output sieht "frei" aus (Prosa statt strukturierter Daten). */
export function looksLikeUnstructuredFreeText(raw: unknown): boolean {
  if (typeof raw === "string") return true;
  if (!raw || typeof raw !== "object") return true;
  const obj = raw as Record<string, unknown>;
  // Mindestens nodes ODER edges muss als Array vorhanden sein.
  if (!Array.isArray(obj.nodes) && !Array.isArray(obj.edges)) return true;
  return false;
}
