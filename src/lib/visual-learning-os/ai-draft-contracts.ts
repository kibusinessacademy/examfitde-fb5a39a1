/**
 * VISUAL.LEARNING.OS — AI Draft Contracts (Cut 6).
 *
 * Reine Typen. Keine Laufzeitlogik.
 */
import type {
  VisualArtifactType,
  VisualEdgeKind,
  VisualLearningArtifact,
  VisualMisconceptionKind,
  VisualNodeRole,
  VisualPurpose,
} from "./contracts";
import type { CompetenceVisualFacets } from "./visual-pattern-registry";
import type { VisualArtifactReviewResult } from "./visual-artifact-review";
import type {
  AiVisualDraftBlocker,
  AiVisualDraftWarning,
} from "./ai-draft-policy";

/** SSOT-Kontext, den der Aufrufer aus dem Backend in die Pipeline gibt. */
export interface VisualAiDraftContext {
  curriculum_id: string;
  competence_id: string;
  lesson_id?: string;
  blueprint_id?: string;
  purpose: VisualPurpose;
  competence_facets: CompetenceVisualFacets;
  source_refs: string[];
  /** Deterministische ID für das später erzeugte Artefakt. */
  artifact_id: string;
}

/** Vollständige Draft-Request inkl. erlaubter Grammar und Limits. */
export interface VisualAiDraftRequest {
  context: VisualAiDraftContext;
  allowed_node_types: ReadonlyArray<VisualNodeRole>;
  allowed_edge_types: ReadonlyArray<VisualEdgeKind>;
  allowed_misconception_types: ReadonlyArray<VisualMisconceptionKind>;
  allowed_color_tokens: ReadonlyArray<string>;
  allowed_purposes: ReadonlyArray<VisualPurpose>;
  max_nodes: number;
  max_edges: number;
  max_misconceptions: number;
  /** Strukturierte Output-Anforderungen für den Prompt-Builder. */
  output_requirements: VisualAiDraftPromptPayload;
}

/** Prompt-Payload — wird an einen separaten Backend-Caller übergeben. */
export interface VisualAiDraftPromptPayload {
  format: "structured_json_only";
  must_include: ReadonlyArray<
    | "nodes"
    | "edges"
    | "misconceptions"
    | "source_refs_per_element"
    | "text_labels"
    | "semantic_color_tokens_only"
  >;
  must_not_include: ReadonlyArray<
    | "hex_colors"
    | "tailwind_color_classes"
    | "color_only_meaning"
    | "publish_signals"
    | "learner_visibility_signals"
    | "free_claims_without_source_refs"
  >;
  instruction_summary: string;
}

/** Roh-Output vom LLM — nicht vertrauenswürdig. */
export interface VisualAiRawOutput {
  artifact_type?: string;
  title?: string;
  focus_question?: string;
  nodes?: Array<{
    id?: unknown;
    role?: unknown;
    label?: unknown;
    aria_label?: unknown;
    glossary_key?: unknown;
    source_ref?: unknown;
  }>;
  edges?: Array<{
    from?: unknown;
    to?: unknown;
    kind?: unknown;
    label?: unknown;
    source_ref?: unknown;
  }>;
  misconceptions?: Array<{
    kind?: unknown;
    description?: unknown;
    target_node_id?: unknown;
    target_edge?: { from?: unknown; to?: unknown };
    blueprint_misconception_id?: unknown;
    source_ref?: unknown;
  }>;
  /** Beliebige Zusatzfelder werden verworfen. */
  [extra: string]: unknown;
}

/** Normalisiertes, policy-konformes AI-Draft-Zwischenergebnis. */
export interface VisualAiNormalizedDraft {
  artifact_type_hint?: VisualArtifactType;
  title?: string;
  focus_question?: string;
  nodes: Array<{
    id: string;
    role: VisualNodeRole;
    label: string;
    aria_label?: string;
    glossary_key?: string;
    source_ref: string;
  }>;
  edges: Array<{
    from: string;
    to: string;
    kind: VisualEdgeKind;
    label?: string;
    source_ref: string;
  }>;
  misconceptions: Array<{
    kind: VisualMisconceptionKind;
    description: string;
    target_node_id?: string;
    blueprint_misconception_id?: string;
    source_ref: string;
  }>;
  /** Wie viele Elemente die AI ursprünglich vorgeschlagen hatte. */
  raw_counts: { nodes: number; edges: number; misconceptions: number };
  /** Welche Elemente wurden verworfen (für Admin-Transparenz). */
  discarded: {
    nodes: number;
    edges: number;
    misconceptions: number;
    reasons: ReadonlyArray<string>;
  };
}

/** Endergebnis des Draft-Flows. */
export interface VisualAiDraftResult {
  request: VisualAiDraftRequest;
  normalized_draft: VisualAiNormalizedDraft | null;
  artifact_draft: VisualLearningArtifact | null;
  review_result: VisualArtifactReviewResult | null;
  blockers: AiVisualDraftBlocker[];
  warnings: AiVisualDraftWarning[];
  admin_preview_ready: boolean;
  learner_visible: false;
  publishable: false;
}

export type { AiVisualDraftBlocker as VisualAiDraftBlocker };
export type { AiVisualDraftWarning as VisualAiDraftWarning };
