/**
 * VISUAL.LEARNING.OS — Oral Visual Feedback Engine (Cut 9).
 *
 * Pure-SSOT. Deterministisch. Berechnet strukturelles Feedback zu mündlichen
 * Antworten ausschließlich aus expliziten ID-Mappings und published Visual
 * Artifacts. Keine NLP, kein DB/HTTP/Clock/RNG/IO.
 *
 * HARTE REGELN:
 * - Keine finale mündliche Prüfungsbewertung.
 * - Kein bestanden/nicht bestanden, keine Note, keine Prüfungsreife.
 * - Mapping nur über explizite IDs aus OralVisualArtifactMapping.
 * - Nur approved/published Artifacts dürfen Signale erzeugen.
 */
import type { PublishedVisualArtifact } from "./contracts";
import {
  FROZEN_VLO_ORAL_VISUAL_POLICY,
  type VloOralBlocker,
  type VloOralBlockerCode,
  type VloOralConfidenceBand,
  type VloOralSignalKind,
  type VloOralWarning,
  type VloOralWarningCode,
} from "./oral-visual-policy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OralVisualLearnerContext {
  learner_id?: string;
  session_id?: string;
}

export interface OralVisualQuestionContext {
  curriculum_id: string;
  competence_id: string;
  oral_question_id: string;
  blueprint_id?: string;
  learner: OralVisualLearnerContext;
  /** Erfolgte die Antwort schon? Nur dann ist Feedback erlaubt. */
  answer_submitted: boolean;
}

export interface OralVisualAnswerSignal {
  /** Stable insertion order (1-based) zur Tie-Break-Sortierung. */
  created_order: number;
  /** Optional: explizit erkannter Misconception-Anker (ID-basiert). */
  misconception_id?: string;
  detail?: string;
}

export interface OralVisualArtifactMapping {
  oral_question_id: string;
  blueprint_id?: string;
  competence_id: string;
  visual_artifact_id: string;
  /** Kernknoten, die für eine gute Antwort sichtbar sein sollten. */
  expected_node_ids: ReadonlyArray<string>;
  /** Kernbeziehungen, die in der Antwort vorkommen sollten. */
  expected_edge_ids: ReadonlyArray<string>;
  /** Vom Learner-Kontext explizit als abgedeckt markierte Nodes. */
  covered_node_ids: ReadonlyArray<string>;
  /** Vom Learner-Kontext explizit als abgedeckt markierte Edges. */
  covered_edge_ids: ReadonlyArray<string>;
  /** Vom Learner-Kontext explizit getriggerte Misconception-IDs. */
  misconception_ids: ReadonlyArray<string>;
}

export interface OralVisualFeedbackInput {
  context: OralVisualQuestionContext;
  artifacts: ReadonlyArray<PublishedVisualArtifact>;
  mappings: ReadonlyArray<OralVisualArtifactMapping>;
  answer_signals?: ReadonlyArray<OralVisualAnswerSignal>;
  /** Optional: vorherige strukturelle Signale für Wiederholungserkennung. */
  prior_signals?: ReadonlyArray<{
    competence_id: string;
    signal_kind: VloOralSignalKind;
    misconception_id?: string;
    visual_artifact_id?: string;
  }>;
  source_refs?: ReadonlyArray<string>;
}

export interface OralVisualFeedbackItem {
  curriculum_id: string;
  competence_id: string;
  oral_question_id: string;
  visual_artifact_id?: string;
  misconception_id?: string;
  node_id?: string;
  edge_id?: string;
  signal_kind: VloOralSignalKind;
  severity: number;
  confidence: VloOralConfidenceBand;
  reason: string;
  evidence: Array<{
    source:
      | "mapping_expected_nodes"
      | "mapping_expected_edges"
      | "mapping_misconception"
      | "mapping_coverage"
      | "prior_signal"
      | "answer_signal";
    detail?: string;
    created_order: number;
  }>;
  source_refs: string[];
  created_order: number;
}

export interface OralVisualFeedbackResult {
  curriculum_id: string;
  competence_id: string;
  oral_question_id: string;
  items: OralVisualFeedbackItem[];
  blockers: VloOralBlocker[];
  warnings: VloOralWarning[];
  learner_visible: boolean;
  is_supplemental_only: true;
  is_final_oral_grade: false;
}

export interface OralVisualLearnerHint {
  kind: VloOralSignalKind;
  message: string;
  text_alt: string;
}

export interface OralVisualLearnerProjection {
  curriculum_id: string;
  competence_id: string;
  oral_question_id: string;
  hints: OralVisualLearnerHint[];
  learner_visible: boolean;
  empty: boolean;
  /** Klarstellung für Learner-UI. Niemals als Note interpretieren. */
  note: string;
}

export interface OralVisualAdminProjection {
  curriculum_id: string;
  competence_id: string;
  oral_question_id: string;
  visual_artifact_id?: string;
  expected_node_ids: string[];
  expected_edge_ids: string[];
  covered_node_ids: string[];
  covered_edge_ids: string[];
  missing_node_ids: string[];
  missing_edge_ids: string[];
  misconception_ids: string[];
  signals: OralVisualFeedbackItem[];
  blockers: VloOralBlocker[];
  warnings: VloOralWarning[];
  is_supplemental_only: true;
  is_final_oral_grade: false;
  note: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SIGNAL_SEVERITY: Record<VloOralSignalKind, number> = {
  misconception_risk: 5,
  key_node_missing: 4,
  relation_missing: 4,
  answer_too_unstructured: 4,
  needs_followup_question: 3,
  structure_aligned: 2,
  good_practice_reference: 1,
};

function signalKindRank(k: VloOralSignalKind): number {
  return [
    "answer_too_unstructured",
    "good_practice_reference",
    "key_node_missing",
    "misconception_risk",
    "needs_followup_question",
    "relation_missing",
    "structure_aligned",
  ].indexOf(k);
}

function reasonFor(kind: VloOralSignalKind): string {
  switch (kind) {
    case "key_node_missing":
      return "Ein erwarteter Kernpunkt fehlt in der Antwortstruktur.";
    case "relation_missing":
      return "Eine erwartete Beziehung zwischen Kernpunkten fehlt.";
    case "misconception_risk":
      return "In der Antwort wurde eine bekannte typische Verwechslung markiert.";
    case "structure_aligned":
      return "Antwortstruktur deckt sich gut mit dem visuellen Modell.";
    case "answer_too_unstructured":
      return "Sehr geringe Strukturabdeckung — Antwort wirkt unstrukturiert.";
    case "needs_followup_question":
      return "Strukturelle Lücke legt eine Nachfrage nahe.";
    case "good_practice_reference":
      return "Antwortstruktur folgt einem bekannten guten Muster.";
  }
}

function learnerCopyFor(kind: VloOralSignalKind): string {
  switch (kind) {
    case "key_node_missing":
      return "Ein Kernpunkt fehlt noch in deiner Antwortstruktur.";
    case "relation_missing":
      return "Eine wichtige Beziehung zwischen Kernpunkten fehlt noch.";
    case "misconception_risk":
      return "Achte besonders auf diese typische Verwechslung.";
    case "structure_aligned":
      return "Deine Antwort folgt einer gut erkennbaren Struktur.";
    case "answer_too_unstructured":
      return "Versuche deine Antwort etwas klarer zu strukturieren.";
    case "needs_followup_question":
      return "An dieser Stelle ist eine Rückfrage zum Zusammenhang sinnvoll.";
    case "good_practice_reference":
      return "Diese Struktur ist ein gutes Antwortmuster.";
  }
}

function textAltFor(kind: VloOralSignalKind): string {
  switch (kind) {
    case "key_node_missing":
      return "Strukturhinweis: fehlender Kernpunkt.";
    case "relation_missing":
      return "Strukturhinweis: fehlende Beziehung zwischen Kernpunkten.";
    case "misconception_risk":
      return "Strukturhinweis: typische Verwechslung markiert.";
    case "structure_aligned":
      return "Strukturhinweis: gute Strukturabdeckung.";
    case "answer_too_unstructured":
      return "Strukturhinweis: sehr geringe Strukturabdeckung.";
    case "needs_followup_question":
      return "Strukturhinweis: Rückfrage zum Zusammenhang sinnvoll.";
    case "good_practice_reference":
      return "Strukturhinweis: bekanntes gutes Antwortmuster.";
  }
}

const FORBIDDEN_LEARNER_TOKENS = [
  "note ", "note.", "bestanden", "nicht bestanden", "prüfungsreife", "pruefungsreife",
  "grade", "score-gewicht",
];

function isLearnerSafeText(s: string): boolean {
  const low = s.toLowerCase();
  return !FORBIDDEN_LEARNER_TOKENS.some((t) => low.includes(t));
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function buildOralVisualFeedback(
  input: OralVisualFeedbackInput,
): OralVisualFeedbackResult {
  const blockers: VloOralBlocker[] = [];
  const warnings: VloOralWarning[] = [];
  const items: OralVisualFeedbackItem[] = [];

  const addBlocker = (code: VloOralBlockerCode, detail: string) =>
    blockers.push({ code, detail });
  const addWarning = (code: VloOralWarningCode, detail: string) =>
    warnings.push({ code, detail });

  const ctx = input?.context;
  if (!ctx?.curriculum_id) {
    addBlocker("VLO_ORAL_MISSING_CURRICULUM_ID", "curriculum_id fehlt");
  }
  if (!ctx?.competence_id) {
    addBlocker("VLO_ORAL_MISSING_COMPETENCE_ID", "competence_id fehlt");
  }
  if (!ctx?.oral_question_id) {
    addBlocker("VLO_ORAL_MISSING_ORAL_QUESTION_ID", "oral_question_id fehlt");
  }
  if (!ctx?.learner || (!ctx.learner.learner_id && !ctx.learner.session_id)) {
    addBlocker(
      "VLO_ORAL_MISSING_LEARNER_CONTEXT",
      "learner_id oder session_id muss gesetzt sein",
    );
  }

  const sourceRefs = input?.source_refs ? [...input.source_refs] : [];
  if (sourceRefs.length < FROZEN_VLO_ORAL_VISUAL_POLICY.min_source_refs_high_confidence) {
    addWarning("VLO_ORAL_SPARSE_STRUCTURE_EVIDENCE", "wenige source_refs");
  }

  // Eligible artifacts (defense in depth).
  const eligibleArtifacts = new Map<string, PublishedVisualArtifact>();
  for (const a of input?.artifacts ?? []) {
    if (a.status !== "approved" && a.status !== "published") {
      addBlocker(
        "VLO_ORAL_UNPUBLISHED_ARTIFACT",
        `artifact ${a.id} status=${a.status}`,
      );
      continue;
    }
    if (ctx?.curriculum_id && a.curriculum_id !== ctx.curriculum_id) {
      addBlocker(
        "VLO_ORAL_CURRICULUM_MISMATCH",
        `artifact ${a.id} curriculum mismatch (ausgeschlossen)`,
      );
      continue;
    }
    if (ctx?.competence_id && a.competence_id !== ctx.competence_id) {
      addBlocker(
        "VLO_ORAL_COMPETENCE_MISMATCH",
        `artifact ${a.id} competence mismatch (ausgeschlossen)`,
      );
      continue;
    }
    eligibleArtifacts.set(a.id, a);
  }

  if (blockers.length > 0) {
    return emptyResult(ctx, blockers, warnings);
  }

  // Eligible mappings (per question_id + blueprint_id-Check, falls gesetzt).
  const eligibleMappings = (input?.mappings ?? []).filter((m) => {
    if (m.oral_question_id !== ctx!.oral_question_id) return false;
    if (m.competence_id !== ctx!.competence_id) return false;
    if (!eligibleArtifacts.has(m.visual_artifact_id)) return false;
    if (ctx!.blueprint_id && m.blueprint_id && m.blueprint_id !== ctx!.blueprint_id) {
      addBlocker(
        "VLO_ORAL_BLUEPRINT_MISMATCH",
        `mapping ${m.visual_artifact_id} blueprint mismatch`,
      );
      return false;
    }
    return true;
  });

  if (blockers.length > 0) {
    return emptyResult(ctx, blockers, warnings);
  }

  if (eligibleMappings.length === 0) {
    addWarning(
      "VLO_ORAL_NO_VISUAL_ARTIFACT_AVAILABLE",
      "kein passendes mapping für oral_question_id",
    );
  }

  let order = 0;
  const nextOrder = () => ++order;

  // Sortiert + deterministisch: nach visual_artifact_id asc.
  const sortedMappings = [...eligibleMappings].sort((a, b) =>
    a.visual_artifact_id.localeCompare(b.visual_artifact_id),
  );

  for (const m of sortedMappings) {
    const expectedNodes = new Set(m.expected_node_ids);
    const expectedEdges = new Set(m.expected_edge_ids);
    const coveredNodes = new Set(m.covered_node_ids);
    const coveredEdges = new Set(m.covered_edge_ids);

    // Missing key nodes → key_node_missing per Node (deterministic order).
    const missingNodes = [...expectedNodes]
      .filter((n) => !coveredNodes.has(n))
      .sort();
    for (const n of missingNodes) {
      const co = nextOrder();
      items.push({
        curriculum_id: ctx!.curriculum_id,
        competence_id: ctx!.competence_id,
        oral_question_id: ctx!.oral_question_id,
        visual_artifact_id: m.visual_artifact_id,
        node_id: n,
        signal_kind: "key_node_missing",
        severity: SIGNAL_SEVERITY.key_node_missing,
        confidence: sourceRefs.length >= 1 ? "medium" : "low",
        reason: reasonFor("key_node_missing"),
        evidence: [
          {
            source: "mapping_expected_nodes",
            detail: `node ${n} fehlt`,
            created_order: co,
          },
        ],
        source_refs: sourceRefs,
        created_order: co,
      });
    }
    if (missingNodes.length > 0) {
      addWarning(
        "VLO_ORAL_MISSING_KEY_NODE_COVERAGE",
        `artifact ${m.visual_artifact_id}: ${missingNodes.length} Kernknoten fehlen`,
      );
    }

    // Missing edges → relation_missing per Edge.
    const missingEdges = [...expectedEdges]
      .filter((e) => !coveredEdges.has(e))
      .sort();
    for (const e of missingEdges) {
      const co = nextOrder();
      items.push({
        curriculum_id: ctx!.curriculum_id,
        competence_id: ctx!.competence_id,
        oral_question_id: ctx!.oral_question_id,
        visual_artifact_id: m.visual_artifact_id,
        edge_id: e,
        signal_kind: "relation_missing",
        severity: SIGNAL_SEVERITY.relation_missing,
        confidence: sourceRefs.length >= 1 ? "medium" : "low",
        reason: reasonFor("relation_missing"),
        evidence: [
          {
            source: "mapping_expected_edges",
            detail: `edge ${e} fehlt`,
            created_order: co,
          },
        ],
        source_refs: sourceRefs,
        created_order: co,
      });
    }
    if (missingEdges.length > 0) {
      addWarning(
        "VLO_ORAL_MISSING_EDGE_COVERAGE",
        `artifact ${m.visual_artifact_id}: ${missingEdges.length} Beziehungen fehlen`,
      );
    }

    // Misconception risks (deterministic, by id).
    const artifact = eligibleArtifacts.get(m.visual_artifact_id)!;
    const knownMcIds = new Set(
      (artifact.misconceptions ?? [])
        .map((mc) => mc.blueprint_misconception_id)
        .filter((x): x is string => !!x),
    );
    const triggered = [...m.misconception_ids].sort();
    for (const mid of triggered) {
      if (!knownMcIds.has(mid)) continue;
      const co = nextOrder();
      items.push({
        curriculum_id: ctx!.curriculum_id,
        competence_id: ctx!.competence_id,
        oral_question_id: ctx!.oral_question_id,
        visual_artifact_id: m.visual_artifact_id,
        misconception_id: mid,
        signal_kind: "misconception_risk",
        severity: SIGNAL_SEVERITY.misconception_risk,
        confidence: sourceRefs.length >= 1 ? "high" : "medium",
        reason: reasonFor("misconception_risk"),
        evidence: [
          {
            source: "mapping_misconception",
            detail: `misconception ${mid}`,
            created_order: co,
          },
        ],
        source_refs: sourceRefs,
        created_order: co,
      });
    }

    // Coverage ratios.
    const totalExpected = expectedNodes.size + expectedEdges.size;
    if (totalExpected > 0) {
      const coveredCount =
        [...expectedNodes].filter((n) => coveredNodes.has(n)).length +
        [...expectedEdges].filter((e) => coveredEdges.has(e)).length;
      const ratio = coveredCount / totalExpected;
      if (ratio < FROZEN_VLO_ORAL_VISUAL_POLICY.unstructured_coverage_threshold) {
        const co = nextOrder();
        items.push({
          curriculum_id: ctx!.curriculum_id,
          competence_id: ctx!.competence_id,
          oral_question_id: ctx!.oral_question_id,
          visual_artifact_id: m.visual_artifact_id,
          signal_kind: "answer_too_unstructured",
          severity: SIGNAL_SEVERITY.answer_too_unstructured,
          confidence: "medium",
          reason: reasonFor("answer_too_unstructured"),
          evidence: [
            {
              source: "mapping_coverage",
              detail: `coverage=${ratio.toFixed(2)}`,
              created_order: co,
            },
          ],
          source_refs: sourceRefs,
          created_order: co,
        });
      } else if (ratio >= FROZEN_VLO_ORAL_VISUAL_POLICY.aligned_coverage_threshold) {
        const co = nextOrder();
        items.push({
          curriculum_id: ctx!.curriculum_id,
          competence_id: ctx!.competence_id,
          oral_question_id: ctx!.oral_question_id,
          visual_artifact_id: m.visual_artifact_id,
          signal_kind: "structure_aligned",
          severity: SIGNAL_SEVERITY.structure_aligned,
          confidence: sourceRefs.length >= 1 ? "medium" : "low",
          reason: reasonFor("structure_aligned"),
          evidence: [
            {
              source: "mapping_coverage",
              detail: `coverage=${ratio.toFixed(2)}`,
              created_order: co,
            },
          ],
          source_refs: sourceRefs,
          created_order: co,
        });
      }
    }
  }

  // Repetition detection over prior signals.
  const priorMcCounts = new Map<string, number>();
  for (const p of input?.prior_signals ?? []) {
    if (
      p.competence_id === ctx!.competence_id &&
      p.misconception_id &&
      p.signal_kind === "misconception_risk"
    ) {
      priorMcCounts.set(
        p.misconception_id,
        (priorMcCounts.get(p.misconception_id) ?? 0) + 1,
      );
    }
  }
  for (const it of items) {
    if (it.signal_kind === "misconception_risk" && it.misconception_id) {
      priorMcCounts.set(
        it.misconception_id,
        (priorMcCounts.get(it.misconception_id) ?? 0) + 1,
      );
    }
  }
  for (const [mid, n] of [...priorMcCounts.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (n >= 2) {
      addWarning(
        "VLO_ORAL_REPEATED_MISCONCEPTION",
        `misconception ${mid} wiederholt (x${n})`,
      );
    }
  }

  // Sort deterministically.
  items.sort(sortItems);

  return {
    curriculum_id: ctx!.curriculum_id,
    competence_id: ctx!.competence_id,
    oral_question_id: ctx!.oral_question_id,
    items,
    blockers,
    warnings,
    learner_visible: ctx!.answer_submitted === true,
    is_supplemental_only: true,
    is_final_oral_grade: false,
  };
}

function sortItems(a: OralVisualFeedbackItem, b: OralVisualFeedbackItem): number {
  const sk = signalKindRank(a.signal_kind) - signalKindRank(b.signal_kind);
  if (sk !== 0) return sk;
  if (a.severity !== b.severity) return b.severity - a.severity;
  const aArt = a.visual_artifact_id ?? "";
  const bArt = b.visual_artifact_id ?? "";
  if (aArt !== bArt) return aArt < bArt ? -1 : 1;
  const aRef = a.node_id ?? a.edge_id ?? a.misconception_id ?? "";
  const bRef = b.node_id ?? b.edge_id ?? b.misconception_id ?? "";
  if (aRef !== bRef) return aRef < bRef ? -1 : 1;
  return a.created_order - b.created_order;
}

function emptyResult(
  ctx: OralVisualQuestionContext | undefined,
  blockers: VloOralBlocker[],
  warnings: VloOralWarning[],
): OralVisualFeedbackResult {
  return {
    curriculum_id: ctx?.curriculum_id ?? "",
    competence_id: ctx?.competence_id ?? "",
    oral_question_id: ctx?.oral_question_id ?? "",
    items: [],
    blockers,
    warnings,
    learner_visible: false,
    is_supplemental_only: true,
    is_final_oral_grade: false,
  };
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export function projectOralVisualFeedbackForLearner(
  result: OralVisualFeedbackResult,
): OralVisualLearnerProjection {
  const note =
    "Strukturhinweise zu deiner Antwort — keine mündliche Bewertung.";
  if (!result.learner_visible || result.blockers.length > 0) {
    return {
      curriculum_id: result.curriculum_id,
      competence_id: result.competence_id,
      oral_question_id: result.oral_question_id,
      hints: [],
      learner_visible: false,
      empty: true,
      note,
    };
  }
  const seen = new Set<VloOralSignalKind>();
  const hints: OralVisualLearnerHint[] = [];
  for (const it of result.items) {
    if (seen.has(it.signal_kind)) continue;
    seen.add(it.signal_kind);
    const msg = learnerCopyFor(it.signal_kind);
    if (!isLearnerSafeText(msg)) continue;
    hints.push({
      kind: it.signal_kind,
      message: msg,
      text_alt: textAltFor(it.signal_kind),
    });
    if (hints.length >= FROZEN_VLO_ORAL_VISUAL_POLICY.max_learner_hints) break;
  }
  return {
    curriculum_id: result.curriculum_id,
    competence_id: result.competence_id,
    oral_question_id: result.oral_question_id,
    hints,
    learner_visible: true,
    empty: hints.length === 0,
    note,
  };
}

export function projectOralVisualFeedbackForAdmin(
  result: OralVisualFeedbackResult,
  input: OralVisualFeedbackInput,
): OralVisualAdminProjection {
  const note =
    "Dieses Panel zeigt Strukturfeedback, keine finale mündliche Prüfungsbewertung.";
  const mapping = (input.mappings ?? []).find(
    (m) =>
      m.oral_question_id === result.oral_question_id &&
      m.competence_id === result.competence_id,
  );
  const expectedNodes = mapping ? [...mapping.expected_node_ids].sort() : [];
  const expectedEdges = mapping ? [...mapping.expected_edge_ids].sort() : [];
  const coveredNodes = mapping ? [...mapping.covered_node_ids].sort() : [];
  const coveredEdges = mapping ? [...mapping.covered_edge_ids].sort() : [];
  const missingNodes = expectedNodes.filter((n) => !coveredNodes.includes(n));
  const missingEdges = expectedEdges.filter((e) => !coveredEdges.includes(e));
  return {
    curriculum_id: result.curriculum_id,
    competence_id: result.competence_id,
    oral_question_id: result.oral_question_id,
    visual_artifact_id: mapping?.visual_artifact_id,
    expected_node_ids: expectedNodes,
    expected_edge_ids: expectedEdges,
    covered_node_ids: coveredNodes,
    covered_edge_ids: coveredEdges,
    missing_node_ids: missingNodes,
    missing_edge_ids: missingEdges,
    misconception_ids: mapping ? [...mapping.misconception_ids].sort() : [],
    signals: [...result.items],
    blockers: [...result.blockers],
    warnings: [...result.warnings],
    is_supplemental_only: true,
    is_final_oral_grade: false,
    note,
  };
}
