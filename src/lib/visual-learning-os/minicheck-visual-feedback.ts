/**
 * VISUAL.LEARNING.OS — MiniCheck Visual Feedback Engine (Cut 5).
 *
 * Pure-SSOT Engine: verknüpft MiniCheck-Antwortsignale mit vorhandenen
 * Visual Misconceptions auf bereits learner-safe projizierten Artifacts.
 *
 * HARTE REGELN:
 * - Kein DB/HTTP/Clock/RNG/IO.
 * - Keine semantische Heuristik. Mapping nur über explizite IDs.
 * - Nur approved/published Artifacts.
 * - curriculum_id/competence_id müssen passen, lesson_id falls gesetzt.
 * - Richtige Antworten erzeugen keine Fehlerdiagnose.
 * - Deterministisch sortiert. Max 3 primäre Items.
 */
import type {
  PublishedVisualArtifact,
  VisualEdge,
  VisualMisconception,
  VisualNode,
} from "./contracts";
import {
  FROZEN_MINICHECK_VISUAL_POLICY,
  type MiniCheckVisualBlocker,
  type MiniCheckVisualBlockerCode,
  type MiniCheckVisualWarning,
  type MiniCheckVisualWarningCode,
} from "./minicheck-visual-policy";

export type MiniCheckAnswerCorrectness = "correct" | "incorrect" | "unsure";
export type MiniCheckFeedbackSeverity = "reinforce" | "hint" | "correction";

/** Antwortsignal pro Frage. Kommt von MiniCheck-Result/Review-State. */
export interface MiniCheckVisualAnswerSignal {
  question_id: string;
  /** Stabile Reihenfolge im Check (1-basiert oder index). */
  question_order: number;
  correctness: MiniCheckAnswerCorrectness;
  /** Optional: gewählte Antwort. */
  selected_answer_id?: string;
  answer_key?: string;
}

/** Explizites Mapping einer Frage/Antwort auf Misconception + Artefakt. */
export interface MiniCheckVisualMapping {
  question_id: string;
  /** Optional: nur für eine spezifische Antwort. */
  answer_key?: string;
  selected_answer_id?: string;
  misconception_id?: string;
  visual_artifact_id?: string;
  /** Optional erzwungene Wiederholungs-Copy. */
  repetition_hint?: string;
}

export interface MiniCheckVisualContext {
  curriculum_id: string;
  competence_id: string;
  /** Optional: muss matchen, falls gesetzt. */
  lesson_id?: string;
  mini_check_id: string;
}

export interface MiniCheckVisualFeedbackInput {
  context: MiniCheckVisualContext;
  signals: ReadonlyArray<MiniCheckVisualAnswerSignal>;
  mappings: ReadonlyArray<MiniCheckVisualMapping>;
  /** Bereits projizierte, learner-safe Artifacts. */
  artifacts: ReadonlyArray<PublishedVisualArtifact>;
  /** Optional: validierte Source-Refs aus dem MiniCheck-Kontext. */
  source_refs?: ReadonlyArray<string>;
}

export interface MiniCheckVisualFeedbackItem {
  question_id: string;
  question_order: number;
  severity: MiniCheckFeedbackSeverity;
  /** Misconception-Kontext, wenn vorhanden. */
  misconception_id?: string;
  misconception_label?: string;
  misconception_description?: string;
  /** Artefakt-Kontext. */
  visual_artifact_id?: string;
  artifact_title?: string;
  /** Auswahl relevanter Nodes/Edges für UI. */
  relevant_nodes: VisualNode[];
  relevant_edges: VisualEdge[];
  repetition_hint: string;
  source_refs: string[];
}

export interface MiniCheckVisualFeedbackResult {
  context: MiniCheckVisualContext;
  items: MiniCheckVisualFeedbackItem[];
  positive_signals: Array<{ question_id: string; question_order: number }>;
  blockers: MiniCheckVisualBlocker[];
  warnings: MiniCheckVisualWarning[];
  /** Sichtbarkeit für Lernende; false bei Blockern. */
  learner_visible: boolean;
}

function severityRank(s: MiniCheckFeedbackSeverity): number {
  // desc sort: correction > hint > reinforce
  switch (s) {
    case "correction":
      return 3;
    case "hint":
      return 2;
    case "reinforce":
      return 1;
  }
}

function findMisconception(
  artifact: PublishedVisualArtifact,
  misconception_id: string | undefined,
): VisualMisconception | undefined {
  if (!misconception_id || !artifact.misconceptions) return undefined;
  return artifact.misconceptions.find(
    (m) => m.blueprint_misconception_id === misconception_id,
  );
}

function relevantNodesEdgesForMisconception(
  artifact: PublishedVisualArtifact,
  m: VisualMisconception | undefined,
): { nodes: VisualNode[]; edges: VisualEdge[] } {
  if (!m) {
    return { nodes: [...artifact.nodes].slice(0, 3), edges: [...artifact.edges].slice(0, 2) };
  }
  const nodes: VisualNode[] = [];
  const edges: VisualEdge[] = [];
  if (m.target_node_id) {
    const n = artifact.nodes.find((x) => x.id === m.target_node_id);
    if (n) nodes.push(n);
  }
  if (m.target_edge) {
    const e = artifact.edges.find(
      (x) => x.from === m.target_edge!.from && x.to === m.target_edge!.to,
    );
    if (e) {
      edges.push(e);
      for (const id of [e.from, e.to]) {
        const n = artifact.nodes.find((x) => x.id === id);
        if (n && !nodes.find((y) => y.id === n.id)) nodes.push(n);
      }
    }
  }
  if (nodes.length === 0 && edges.length === 0) {
    return { nodes: [...artifact.nodes].slice(0, 3), edges: [...artifact.edges].slice(0, 2) };
  }
  return { nodes, edges };
}

function defaultRepetitionHint(m: VisualMisconception | undefined): string {
  if (!m) return "Wiederhole die Kernstruktur und prüfe die Zusammenhänge.";
  switch (m.kind) {
    case "wrong_link":
      return "Prüfe die Verknüpfung zwischen den genannten Elementen erneut.";
    case "missing_node":
      return "Ergänze den fehlenden Baustein und prüfe den Gesamtablauf.";
    case "false_order":
      return "Bringe die Schritte in die richtige Reihenfolge.";
    case "overgeneralization":
      return "Beachte die Ausnahmen und Grenzen der Regel.";
    case "exception_ignored":
      return "Berücksichtige die Ausnahme und ihre Bedingung.";
    case "diagram_misread":
      return "Lies die Darstellung Schritt für Schritt erneut.";
  }
}

export function buildMiniCheckVisualFeedback(
  input: MiniCheckVisualFeedbackInput,
): MiniCheckVisualFeedbackResult {
  const blockers: MiniCheckVisualBlocker[] = [];
  const warnings: MiniCheckVisualWarning[] = [];
  const items: MiniCheckVisualFeedbackItem[] = [];
  const positive: MiniCheckVisualFeedbackResult["positive_signals"] = [];

  const addBlocker = (code: MiniCheckVisualBlockerCode, detail: string) =>
    blockers.push({ code, detail });
  const addWarning = (code: MiniCheckVisualWarningCode, detail: string) =>
    warnings.push({ code, detail });

  const ctx = input.context;
  if (!ctx?.curriculum_id) {
    addBlocker("MINICHECK_VISUAL_MISSING_CURRICULUM_ID", "context.curriculum_id fehlt");
  }
  if (!ctx?.competence_id) {
    addBlocker("MINICHECK_VISUAL_MISSING_COMPETENCE_ID", "context.competence_id fehlt");
  }
  if (!ctx?.mini_check_id) {
    addBlocker("MINICHECK_VISUAL_MISSING_MINICHECK_ID", "context.mini_check_id fehlt");
  }

  // Eligible Artifacts (defense-in-depth).
  const eligibleArtifacts: PublishedVisualArtifact[] = [];
  for (const a of input.artifacts ?? []) {
    if (a.status !== "approved" && a.status !== "published") {
      addBlocker(
        "MINICHECK_VISUAL_UNAPPROVED_ARTIFACT",
        `artifact ${a.id} status=${a.status}`,
      );
      continue;
    }
    if (!a.accessibility?.color_independent_labels) {
      addBlocker(
        "MINICHECK_VISUAL_COLOR_ONLY_MEANING",
        `artifact ${a.id} verletzt color-independent labels`,
      );
      continue;
    }
    if (ctx?.curriculum_id && a.curriculum_id !== ctx.curriculum_id) {
      // exclude but no hard blocker (mismatch is normal across packs)
      continue;
    }
    if (ctx?.competence_id && a.competence_id !== ctx.competence_id) {
      continue;
    }
    if (ctx?.lesson_id && a.lesson_id && a.lesson_id !== ctx.lesson_id) {
      continue;
    }
    eligibleArtifacts.push(a);
  }

  const sourceRefs = input.source_refs ? [...input.source_refs] : [];
  if (sourceRefs.length < FROZEN_MINICHECK_VISUAL_POLICY.min_source_refs) {
    addWarning(
      "MINICHECK_VISUAL_SPARSE_SOURCE_REFS",
      `nur ${sourceRefs.length} source_refs vorhanden`,
    );
  }

  // Build feedback per signal — only for incorrect/unsure.
  for (const signal of input.signals ?? []) {
    if (!signal?.question_id) {
      addBlocker("MINICHECK_VISUAL_MISSING_QUESTION_ID", "signal.question_id fehlt");
      continue;
    }

    if (signal.correctness === "correct") {
      positive.push({
        question_id: signal.question_id,
        question_order: signal.question_order,
      });
      continue;
    }

    // Find matching mapping by question_id + (answer_key|selected_answer_id) precedence.
    const candidates = (input.mappings ?? []).filter(
      (m) => m.question_id === signal.question_id,
    );
    let mapping: MiniCheckVisualMapping | undefined;
    if (candidates.length > 0) {
      mapping =
        candidates.find(
          (m) =>
            (m.answer_key &&
              signal.answer_key &&
              m.answer_key === signal.answer_key) ||
            (m.selected_answer_id &&
              signal.selected_answer_id &&
              m.selected_answer_id === signal.selected_answer_id),
        ) ?? candidates.find((m) => !m.answer_key && !m.selected_answer_id);
    }

    if (!mapping) {
      addWarning(
        "MINICHECK_VISUAL_NO_MAPPING_AVAILABLE",
        `kein Mapping für question ${signal.question_id}`,
      );
      continue;
    }

    const artifact = mapping.visual_artifact_id
      ? eligibleArtifacts.find((a) => a.id === mapping!.visual_artifact_id)
      : undefined;

    if (mapping.visual_artifact_id && !artifact) {
      // Mapped artifact exists in mapping but is not eligible — text-only fallback.
      addWarning(
        "MINICHECK_VISUAL_FEEDBACK_TEXT_ONLY_FALLBACK",
        `Artifact ${mapping.visual_artifact_id} nicht eligible`,
      );
    }

    const misconception = artifact
      ? findMisconception(artifact, mapping.misconception_id)
      : undefined;

    if (mapping.misconception_id && !misconception) {
      addWarning(
        "MINICHECK_VISUAL_NO_MISCONCEPTION_MATCH",
        `misconception ${mapping.misconception_id} nicht in Artifact`,
      );
    }
    if (artifact && (!artifact.misconceptions || artifact.misconceptions.length === 0)) {
      addWarning(
        "MINICHECK_VISUAL_ARTIFACT_WITHOUT_MISCONCEPTIONS",
        `artifact ${artifact.id} hat keine Misconceptions`,
      );
    }

    const { nodes, edges } = artifact
      ? relevantNodesEdgesForMisconception(artifact, misconception)
      : { nodes: [], edges: [] };

    const severity: MiniCheckFeedbackSeverity =
      signal.correctness === "incorrect" ? "correction" : "hint";

    items.push({
      question_id: signal.question_id,
      question_order: signal.question_order,
      severity,
      misconception_id: mapping.misconception_id,
      misconception_label: misconception?.kind,
      misconception_description: misconception?.description,
      visual_artifact_id: artifact?.id ?? mapping.visual_artifact_id,
      artifact_title: artifact?.title,
      relevant_nodes: nodes,
      relevant_edges: edges,
      repetition_hint: mapping.repetition_hint ?? defaultRepetitionHint(misconception),
      source_refs: sourceRefs,
    });
  }

  // Deterministic sort: severity desc, question_order asc, misconception_id asc, artifact_id asc.
  items.sort((a, b) => {
    const s = severityRank(b.severity) - severityRank(a.severity);
    if (s !== 0) return s;
    if (a.question_order !== b.question_order) return a.question_order - b.question_order;
    const am = a.misconception_id ?? "";
    const bm = b.misconception_id ?? "";
    if (am < bm) return -1;
    if (am > bm) return 1;
    const av = a.visual_artifact_id ?? "";
    const bv = b.visual_artifact_id ?? "";
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });

  positive.sort((a, b) => a.question_order - b.question_order);

  const limited = items.slice(0, FROZEN_MINICHECK_VISUAL_POLICY.max_primary_feedback_items);

  return {
    context: ctx,
    items: limited,
    positive_signals: positive,
    blockers,
    warnings,
    learner_visible: blockers.length === 0,
  };
}

export function isMiniCheckVisualFeedbackEmpty(
  result: MiniCheckVisualFeedbackResult,
): boolean {
  return result.items.length === 0 && result.positive_signals.length === 0;
}
