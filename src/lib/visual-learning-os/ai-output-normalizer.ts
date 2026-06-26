/**
 * VISUAL.LEARNING.OS — AI Output Normalizer (Cut 6).
 *
 * Pure, deterministisch. Kein DB/HTTP/Clock/RNG/IO. Kein LLM-Call.
 * Akzeptiert nur strukturierte Outputs, verwirft Unbekanntes,
 * blockiert verbotene Signale, sortiert deterministisch.
 *
 * Erzeugt NIEMALS approved/published Artefakte.
 */
import {
  VISUAL_EDGE_KINDS,
  VISUAL_MISCONCEPTION_KINDS,
  VISUAL_NODE_ROLES,
  type VisualEdgeKind,
  type VisualMisconceptionKind,
  type VisualNodeRole,
} from "./contracts";
import {
  aiBlocker,
  aiWarning,
  containsForbiddenColorSignal,
  containsForbiddenLearnerVisibilitySignal,
  containsForbiddenPublishSignal,
  FROZEN_AI_VISUAL_DRAFT_POLICY,
  looksLikeUnstructuredFreeText,
  type AiVisualDraftBlocker,
  type AiVisualDraftWarning,
} from "./ai-draft-policy";
import type {
  VisualAiDraftRequest,
  VisualAiDraftResult,
  VisualAiNormalizedDraft,
  VisualAiRawOutput,
} from "./ai-draft-contracts";

const NODE_ROLE_SET = new Set<string>(VISUAL_NODE_ROLES);
const EDGE_KIND_SET = new Set<string>(VISUAL_EDGE_KINDS);
const MISC_KIND_SET = new Set<string>(VISUAL_MISCONCEPTION_KINDS);

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

export function normalizeVisualAiOutput(
  rawOutput: VisualAiRawOutput | unknown,
  request: VisualAiDraftRequest,
): VisualAiDraftResult {
  const blockers: AiVisualDraftBlocker[] = [];
  const warnings: AiVisualDraftWarning[] = [];

  // 1) Context-Pflichten.
  if (!request.context.curriculum_id?.trim()) {
    blockers.push(aiBlocker("AI_VISUAL_MISSING_CURRICULUM_ID", "curriculum_id fehlt im Kontext."));
  }
  if (!request.context.competence_id?.trim()) {
    blockers.push(aiBlocker("AI_VISUAL_MISSING_COMPETENCE_ID", "competence_id fehlt im Kontext."));
  }
  if (!Array.isArray(request.context.source_refs) || request.context.source_refs.length === 0) {
    blockers.push(
      aiBlocker(
        "AI_VISUAL_MISSING_SOURCE_REFS",
        "Mindestens eine source_ref im Kontext erforderlich.",
      ),
    );
  }
  if (!request.allowed_purposes.includes(request.context.purpose)) {
    blockers.push(
      aiBlocker(
        "AI_VISUAL_UNSUPPORTED_PURPOSE",
        `Purpose "${request.context.purpose}" nicht in allowed_purposes.`,
      ),
    );
  }

  // 2) Strukturprüfung des Rohs.
  if (looksLikeUnstructuredFreeText(rawOutput)) {
    blockers.push(
      aiBlocker(
        "AI_VISUAL_OUTPUT_NOT_STRUCTURED",
        "AI-Output ist kein strukturierter JSON-Body mit nodes/edges.",
      ),
    );
    return earlyExit(request, blockers, warnings);
  }

  const raw = rawOutput as VisualAiRawOutput;

  // 3) Verbotene Top-Level-Signale.
  if (containsForbiddenPublishSignal(raw)) {
    blockers.push(
      aiBlocker(
        "AI_VISUAL_DIRECT_PUBLISH_FORBIDDEN",
        "AI-Output enthält Publish-Signal — verboten.",
      ),
    );
  }
  if (containsForbiddenLearnerVisibilitySignal(raw)) {
    blockers.push(
      aiBlocker(
        "AI_VISUAL_LEARNER_VISIBLE_FORBIDDEN",
        "AI-Output enthält Learner-Sichtbarkeitssignal — verboten.",
      ),
    );
  }

  const allowedSourceRefs = new Set(request.context.source_refs);
  const discardReasons: string[] = [];
  let discardedNodes = 0;
  let discardedEdges = 0;
  let discardedMisconceptions = 0;

  // 4) Nodes normalisieren.
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const nodes: VisualAiNormalizedDraft["nodes"] = [];
  for (const n of rawNodes) {
    const id = asTrimmedString(n?.id);
    const role = asTrimmedString(n?.role);
    const label = asTrimmedString(n?.label);
    const sourceRef = asTrimmedString(n?.source_ref);
    if (!id || !role || !label) {
      discardedNodes++;
      discardReasons.push("node:missing_required_field");
      continue;
    }
    if (!NODE_ROLE_SET.has(role)) {
      blockers.push(
        aiBlocker(
          "AI_VISUAL_OUTPUT_UNSUPPORTED_NODE_TYPE",
          `Knoten ${id} nutzt unbekannte Rolle "${role}".`,
        ),
      );
      discardedNodes++;
      discardReasons.push("node:unsupported_role");
      continue;
    }
    if (
      containsForbiddenColorSignal(label) ||
      containsForbiddenColorSignal(asTrimmedString(n?.aria_label))
    ) {
      blockers.push(
        aiBlocker(
          "AI_VISUAL_OUTPUT_CONTAINS_HEX_COLOR",
          `Knoten ${id} enthält verbotenes Farbsignal.`,
        ),
      );
      discardedNodes++;
      discardReasons.push("node:forbidden_color");
      continue;
    }
    if (!sourceRef || !allowedSourceRefs.has(sourceRef)) {
      blockers.push(
        aiBlocker(
          "AI_VISUAL_MISSING_SOURCE_REFS",
          `Knoten ${id} ohne gültige source_ref aus dem Kontext.`,
        ),
      );
      discardedNodes++;
      discardReasons.push("node:missing_source_ref");
      continue;
    }
    nodes.push({
      id,
      role: role as VisualNodeRole,
      label,
      aria_label: asTrimmedString(n?.aria_label),
      glossary_key: asTrimmedString(n?.glossary_key),
      source_ref: sourceRef,
    });
  }

  // 5) Edges normalisieren.
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  const edges: VisualAiNormalizedDraft["edges"] = [];
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  for (const e of rawEdges) {
    const from = asTrimmedString(e?.from);
    const to = asTrimmedString(e?.to);
    const kind = asTrimmedString(e?.kind);
    const sourceRef = asTrimmedString(e?.source_ref);
    if (!from || !to || !kind) {
      discardedEdges++;
      discardReasons.push("edge:missing_required_field");
      continue;
    }
    if (!EDGE_KIND_SET.has(kind)) {
      blockers.push(
        aiBlocker(
          "AI_VISUAL_OUTPUT_UNSUPPORTED_EDGE_TYPE",
          `Kante ${from}→${to} nutzt unbekannten Typ "${kind}".`,
        ),
      );
      discardedEdges++;
      discardReasons.push("edge:unsupported_kind");
      continue;
    }
    if (!nodeIdSet.has(from) || !nodeIdSet.has(to)) {
      discardedEdges++;
      discardReasons.push("edge:dangling_reference");
      continue;
    }
    const label = asTrimmedString(e?.label);
    if (containsForbiddenColorSignal(label)) {
      blockers.push(
        aiBlocker(
          "AI_VISUAL_OUTPUT_CONTAINS_TAILWIND_COLOR",
          `Kante ${from}→${to} enthält verbotenes Farbsignal im Label.`,
        ),
      );
      discardedEdges++;
      discardReasons.push("edge:forbidden_color");
      continue;
    }
    if (!sourceRef || !allowedSourceRefs.has(sourceRef)) {
      blockers.push(
        aiBlocker(
          "AI_VISUAL_MISSING_SOURCE_REFS",
          `Kante ${from}→${to} ohne gültige source_ref aus dem Kontext.`,
        ),
      );
      discardedEdges++;
      discardReasons.push("edge:missing_source_ref");
      continue;
    }
    edges.push({
      from,
      to,
      kind: kind as VisualEdgeKind,
      label,
      source_ref: sourceRef,
    });
  }

  // 6) Misconceptions normalisieren.
  const rawMisc = Array.isArray(raw.misconceptions) ? raw.misconceptions : [];
  const misconceptions: VisualAiNormalizedDraft["misconceptions"] = [];
  for (const m of rawMisc) {
    const kind = asTrimmedString(m?.kind);
    const description = asTrimmedString(m?.description);
    const sourceRef = asTrimmedString(m?.source_ref);
    if (!kind || !description) {
      discardedMisconceptions++;
      discardReasons.push("misconception:missing_required_field");
      continue;
    }
    if (!MISC_KIND_SET.has(kind)) {
      blockers.push(
        aiBlocker(
          "AI_VISUAL_OUTPUT_UNSUPPORTED_MISCONCEPTION_TYPE",
          `Misconception nutzt unbekannten Typ "${kind}".`,
        ),
      );
      discardedMisconceptions++;
      discardReasons.push("misconception:unsupported_kind");
      continue;
    }
    if (containsForbiddenColorSignal(description)) {
      blockers.push(
        aiBlocker(
          "AI_VISUAL_OUTPUT_CONTAINS_HEX_COLOR",
          `Misconception enthält verbotenes Farbsignal.`,
        ),
      );
      discardedMisconceptions++;
      discardReasons.push("misconception:forbidden_color");
      continue;
    }
    if (!sourceRef || !allowedSourceRefs.has(sourceRef)) {
      blockers.push(
        aiBlocker(
          "AI_VISUAL_MISSING_SOURCE_REFS",
          `Misconception ohne gültige source_ref aus dem Kontext.`,
        ),
      );
      discardedMisconceptions++;
      discardReasons.push("misconception:missing_source_ref");
      continue;
    }
    misconceptions.push({
      kind: kind as VisualMisconceptionKind,
      description,
      target_node_id: asTrimmedString(m?.target_node_id),
      blueprint_misconception_id: asTrimmedString(m?.blueprint_misconception_id),
      source_ref: sourceRef,
    });
  }

  // 7) Limits durchsetzen — Reduktion + Warning.
  const rawCounts = {
    nodes: rawNodes.length,
    edges: rawEdges.length,
    misconceptions: rawMisc.length,
  };
  let limitedNodes = nodes;
  let limitedEdges = edges;
  let limitedMisc = misconceptions;
  if (nodes.length > FROZEN_AI_VISUAL_DRAFT_POLICY.max_nodes) {
    limitedNodes = nodes.slice(0, FROZEN_AI_VISUAL_DRAFT_POLICY.max_nodes);
    discardedNodes += nodes.length - limitedNodes.length;
    discardReasons.push("node:exceeds_max_nodes");
    warnings.push(
      aiWarning(
        "AI_VISUAL_TOO_MANY_NODES",
        `Nodes auf Policy-Limit ${FROZEN_AI_VISUAL_DRAFT_POLICY.max_nodes} reduziert.`,
      ),
    );
    const allowedIds = new Set(limitedNodes.map((n) => n.id));
    limitedEdges = limitedEdges.filter((e) => allowedIds.has(e.from) && allowedIds.has(e.to));
  }
  if (limitedEdges.length > FROZEN_AI_VISUAL_DRAFT_POLICY.max_edges) {
    const before = limitedEdges.length;
    limitedEdges = limitedEdges.slice(0, FROZEN_AI_VISUAL_DRAFT_POLICY.max_edges);
    discardedEdges += before - limitedEdges.length;
    discardReasons.push("edge:exceeds_max_edges");
    warnings.push(
      aiWarning(
        "AI_VISUAL_TOO_MANY_EDGES",
        `Edges auf Policy-Limit ${FROZEN_AI_VISUAL_DRAFT_POLICY.max_edges} reduziert.`,
      ),
    );
  }
  if (limitedMisc.length > FROZEN_AI_VISUAL_DRAFT_POLICY.max_misconceptions) {
    const before = limitedMisc.length;
    limitedMisc = limitedMisc.slice(0, FROZEN_AI_VISUAL_DRAFT_POLICY.max_misconceptions);
    discardedMisconceptions += before - limitedMisc.length;
    discardReasons.push("misconception:exceeds_max_misconceptions");
  }

  // 8) Deterministisch sortieren.
  limitedNodes = [...limitedNodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  limitedEdges = [...limitedEdges].sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    if (a.to !== b.to) return a.to < b.to ? -1 : 1;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
  limitedMisc = [...limitedMisc].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));

  // 9) Warnings.
  if (limitedMisc.length === 0) {
    warnings.push(
      aiWarning("AI_VISUAL_NO_MISCONCEPTIONS_PROPOSED", "Keine Misconceptions vorgeschlagen."),
    );
  }
  const elementsWithRef = limitedNodes.length + limitedEdges.length + limitedMisc.length;
  if (elementsWithRef > 0) {
    const coverage = elementsWithRef / elementsWithRef; // alle mit Ref (Blocker greift sonst)
    if (coverage < FROZEN_AI_VISUAL_DRAFT_POLICY.min_source_ref_coverage_ratio) {
      warnings.push(
        aiWarning(
          "AI_VISUAL_LOW_SOURCE_REF_COVERAGE",
          "Source-Ref-Abdeckung unterhalb Schwelle.",
        ),
      );
    }
  }
  if (discardedNodes + discardedEdges + discardedMisconceptions > 0) {
    warnings.push(
      aiWarning(
        "AI_VISUAL_REDUCED_TO_SAFE_SUBSET",
        `Verworfen: ${discardedNodes} Nodes, ${discardedEdges} Edges, ${discardedMisconceptions} Misconceptions.`,
      ),
    );
  }
  warnings.push(
    aiWarning(
      "AI_VISUAL_NEEDS_ADMIN_REVIEW",
      "AI-Draft erfordert ausdrückliche Admin-Review.",
    ),
  );

  const normalized: VisualAiNormalizedDraft = {
    artifact_type_hint: undefined,
    title: asTrimmedString(raw.title),
    focus_question: asTrimmedString(raw.focus_question),
    nodes: limitedNodes,
    edges: limitedEdges,
    misconceptions: limitedMisc,
    raw_counts: rawCounts,
    discarded: {
      nodes: discardedNodes,
      edges: discardedEdges,
      misconceptions: discardedMisconceptions,
      reasons: Object.freeze([...new Set(discardReasons)].sort()),
    },
  };

  return {
    request,
    normalized_draft: normalized,
    artifact_draft: null,
    review_result: null,
    blockers,
    warnings,
    admin_preview_ready: blockers.length === 0,
    learner_visible: false,
    publishable: false,
  };
}

function earlyExit(
  request: VisualAiDraftRequest,
  blockers: AiVisualDraftBlocker[],
  warnings: AiVisualDraftWarning[],
): VisualAiDraftResult {
  return {
    request,
    normalized_draft: null,
    artifact_draft: null,
    review_result: null,
    blockers,
    warnings,
    admin_preview_ready: false,
    learner_visible: false,
    publishable: false,
  };
}
