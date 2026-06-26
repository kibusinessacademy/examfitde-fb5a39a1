/**
 * VISUAL.LEARNING.OS — AI Draft Request Builder (Cut 6).
 *
 * Pure und deterministisch. Kein DB/HTTP/Clock/RNG/IO. Kein LLM-Call.
 * Baut nur eine strukturierte Request-/Prompt-Payload auf Basis des
 * freigegebenen SSOT-Kontextes.
 */
import {
  VISUAL_EDGE_KINDS,
  VISUAL_MISCONCEPTION_KINDS,
  VISUAL_NODE_ROLES,
  VISUAL_PURPOSES,
} from "./contracts";
import { ALLOWED_SEMANTIC_COLOR_TOKENS } from "./visual-grammar";
import { FROZEN_AI_VISUAL_DRAFT_POLICY } from "./ai-draft-policy";
import type {
  VisualAiDraftContext,
  VisualAiDraftPromptPayload,
  VisualAiDraftRequest,
} from "./ai-draft-contracts";

const PROMPT_PAYLOAD: VisualAiDraftPromptPayload = Object.freeze({
  format: "structured_json_only",
  must_include: Object.freeze([
    "nodes",
    "edges",
    "misconceptions",
    "source_refs_per_element",
    "text_labels",
    "semantic_color_tokens_only",
  ] as const),
  must_not_include: Object.freeze([
    "hex_colors",
    "tailwind_color_classes",
    "color_only_meaning",
    "publish_signals",
    "learner_visibility_signals",
    "free_claims_without_source_refs",
  ] as const),
  instruction_summary: [
    "Du erzeugst ausschließlich strukturierten JSON-Output für ein visuelles Lernartefakt.",
    "Du darfst nur die übergebenen allowed_node_types/allowed_edge_types/allowed_misconception_types verwenden.",
    "Jedes Node/Edge/Misconception MUSS einen source_ref aus context.source_refs nennen.",
    "Verwende ausschließlich semantische Farb-Tokens (siehe allowed_color_tokens).",
    "Farbe darf niemals alleiniger Bedeutungsträger sein — Label + Form + Icon sind Pflicht.",
    "Setze NIEMALS status=approved/published, publish=true, learner_visible=true.",
    "Erfinde keine Fachinhalte. Wenn unsicher, lasse Felder leer.",
  ].join(" "),
}) as VisualAiDraftPromptPayload;

export function buildVisualAiDraftRequest(
  context: VisualAiDraftContext,
): VisualAiDraftRequest {
  return Object.freeze({
    context: Object.freeze({
      ...context,
      source_refs: Object.freeze([...context.source_refs].sort()),
    }) as VisualAiDraftContext,
    allowed_node_types: VISUAL_NODE_ROLES,
    allowed_edge_types: VISUAL_EDGE_KINDS,
    allowed_misconception_types: VISUAL_MISCONCEPTION_KINDS,
    allowed_color_tokens: ALLOWED_SEMANTIC_COLOR_TOKENS,
    allowed_purposes: VISUAL_PURPOSES,
    max_nodes: FROZEN_AI_VISUAL_DRAFT_POLICY.max_nodes,
    max_edges: FROZEN_AI_VISUAL_DRAFT_POLICY.max_edges,
    max_misconceptions: FROZEN_AI_VISUAL_DRAFT_POLICY.max_misconceptions,
    output_requirements: PROMPT_PAYLOAD,
  }) as VisualAiDraftRequest;
}
