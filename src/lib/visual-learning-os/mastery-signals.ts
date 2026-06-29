/**
 * VISUAL.LEARNING.OS — Mastery Signals Engine (Cut 8).
 *
 * Pure-SSOT. Berechnet erklärbare Mastery-Signale aus MiniCheck-Visual-Feedback
 * und published Visual Artifacts.
 *
 * HARTE REGELN:
 * - Kein DB/HTTP/Clock/RNG/IO.
 * - Nur published Artifacts dürfen Signale erzeugen.
 * - Niemals finale Mastery allein bestimmen.
 * - Keine Prüfungsreife-Aussage. Kein bestanden/nicht bestanden.
 * - Deterministische Sortierung, deterministische Outputs.
 */
import type { PublishedVisualArtifact } from "./contracts";
import type { MiniCheckVisualFeedbackResult } from "./minicheck-visual-feedback";
import {
  FROZEN_VLO_MASTERY_SIGNAL_POLICY,
  type VloMasteryBlocker,
  type VloMasteryBlockerCode,
  type VloMasteryConfidenceBand,
  type VloMasterySignalKind,
  type VloMasteryWarning,
  type VloMasteryWarningCode,
} from "./mastery-signal-policy";

export interface VisualMasteryLearnerContext {
  learner_id?: string;
  session_id?: string;
}

export interface VisualMasteryEvidence {
  /** Stable source: feedback-item, prior-signal, mapping. */
  source: "minicheck_feedback" | "prior_signal" | "explicit_mapping";
  question_id?: string;
  question_order?: number;
  /** Optional: vorheriger Signal-Kind, falls aus Historie. */
  prior_signal_kind?: VloMasterySignalKind;
  /** Stable insertion order (1-based) zur Tie-Break-Sortierung. */
  created_order: number;
  detail?: string;
}

export interface VisualMasterySignal {
  curriculum_id: string;
  competence_id: string;
  lesson_id?: string;
  mini_check_id?: string;
  visual_artifact_id?: string;
  misconception_id?: string;
  signal_kind: VloMasterySignalKind;
  /** desc: higher = more relevant. */
  severity: number;
  confidence: VloMasteryConfidenceBand;
  reason: string;
  /** Stable explanation tokens for admin debug. */
  evidence: VisualMasteryEvidence[];
  source_refs: string[];
  /** Stable insertion order for deterministic sort. */
  created_order: number;
}

export interface VisualMasterySignalInput {
  curriculum_id: string;
  competence_id: string;
  lesson_id?: string;
  mini_check_id?: string;
  learner: VisualMasteryLearnerContext;
  /** Optional: bereits berechnetes MiniCheck-Visual-Feedback. */
  feedback?: MiniCheckVisualFeedbackResult;
  /** Pool aus published Artifacts (defense-in-depth Filter). */
  artifacts: ReadonlyArray<PublishedVisualArtifact>;
  /** Optional: aufgelöste Misconception-IDs aus späteren MiniChecks. */
  resolved_misconception_ids?: ReadonlyArray<string>;
  /** Optional: vorherige Signale (z. B. aus persistierter Historie). */
  prior_signals?: ReadonlyArray<{
    competence_id: string;
    signal_kind: VloMasterySignalKind;
    misconception_id?: string;
    visual_artifact_id?: string;
  }>;
  /** Optional: validierte Source-Refs. */
  source_refs?: ReadonlyArray<string>;
}

export interface VisualMasterySignalResult {
  curriculum_id: string;
  competence_id: string;
  signals: VisualMasterySignal[];
  blockers: VloMasteryBlocker[];
  warnings: VloMasteryWarning[];
  learner_visible: boolean;
  is_supplemental_only: true;
}

export interface VisualMasteryAggregation {
  curriculum_id: string;
  competence_id: string;
  totals: Record<VloMasterySignalKind, number>;
  signals: VisualMasterySignal[];
  blockers: VloMasteryBlocker[];
  warnings: VloMasteryWarning[];
  is_supplemental_only: true;
}

export interface VisualMasteryLearnerHint {
  message: string;
  kind: VloMasterySignalKind;
}

export interface VisualMasteryLearnerProjection {
  curriculum_id: string;
  competence_id: string;
  hints: VisualMasteryLearnerHint[];
  learner_visible: boolean;
  empty: boolean;
}

export interface VisualMasteryAdminProjection {
  curriculum_id: string;
  competence_id: string;
  totals: Record<VloMasterySignalKind, number>;
  signals: VisualMasterySignal[];
  warnings: VloMasteryWarning[];
  blockers: VloMasteryBlocker[];
  is_supplemental_only: true;
  note: string;
}

// ---------------------------------------------------------------------------

const SIGNAL_SEVERITY: Record<VloMasterySignalKind, number> = {
  misconception_detected: 4,
  weakens_mastery: 3,
  needs_repetition: 3,
  misconception_resolved: 2,
  strengthens_mastery: 1,
};

function signalKindRank(k: VloMasterySignalKind): number {
  // alphabetic asc per spec
  return [
    "misconception_detected",
    "misconception_resolved",
    "needs_repetition",
    "strengthens_mastery",
    "weakens_mastery",
  ].indexOf(k);
}

function reasonFor(kind: VloMasterySignalKind): string {
  switch (kind) {
    case "misconception_detected":
      return "Typische Verwechslung im visuellen Modell erkannt.";
    case "weakens_mastery":
      return "Unsicheres Erkennen visueller Zusammenhänge.";
    case "needs_repetition":
      return "Gleiche Verwechslung wiederholt aufgetreten.";
    case "misconception_resolved":
      return "Frühere Verwechslung wurde aufgelöst.";
    case "strengthens_mastery":
      return "Visuelle Struktur sicher erkannt.";
  }
}

function learnerCopyFor(kind: VloMasterySignalKind): string {
  switch (kind) {
    case "needs_repetition":
      return "Diesen Zusammenhang solltest du wiederholen.";
    case "misconception_detected":
      return "Achte besonders auf diese typische Verwechslung.";
    case "weakens_mastery":
      return "Schau dir diese Struktur noch einmal in Ruhe an.";
    case "misconception_resolved":
      return "Diese Verwechslung hast du bereits aufgelöst.";
    case "strengthens_mastery":
      return "Diese Struktur hast du bereits sicher erkannt.";
  }
}

function emptyTotals(): Record<VloMasterySignalKind, number> {
  return {
    strengthens_mastery: 0,
    weakens_mastery: 0,
    misconception_detected: 0,
    misconception_resolved: 0,
    needs_repetition: 0,
  };
}

export function buildVisualMasterySignals(
  input: VisualMasterySignalInput,
): VisualMasterySignalResult {
  const blockers: VloMasteryBlocker[] = [];
  const warnings: VloMasteryWarning[] = [];
  const signals: VisualMasterySignal[] = [];

  const addBlocker = (code: VloMasteryBlockerCode, detail: string) =>
    blockers.push({ code, detail });
  const addWarning = (code: VloMasteryWarningCode, detail: string) =>
    warnings.push({ code, detail });

  if (!input?.curriculum_id) {
    addBlocker("VLO_MASTERY_MISSING_CURRICULUM_ID", "curriculum_id fehlt");
  }
  if (!input?.competence_id) {
    addBlocker("VLO_MASTERY_MISSING_COMPETENCE_ID", "competence_id fehlt");
  }
  if (!input?.learner || (!input.learner.learner_id && !input.learner.session_id)) {
    addBlocker(
      "VLO_MASTERY_MISSING_LEARNER_CONTEXT",
      "learner_id oder session_id muss gesetzt sein",
    );
  }

  const sourceRefs = input?.source_refs ? [...input.source_refs] : [];
  if (sourceRefs.length < FROZEN_VLO_MASTERY_SIGNAL_POLICY.min_source_refs_high_confidence) {
    addWarning("VLO_MASTERY_SPARSE_VISUAL_EVIDENCE", "wenige source_refs");
  }

  // Eligible artifacts (defense in depth).
  const eligibleArtifacts = new Map<string, PublishedVisualArtifact>();
  for (const a of input?.artifacts ?? []) {
    if (a.status !== "approved" && a.status !== "published") {
      addBlocker(
        "VLO_MASTERY_UNPUBLISHED_ARTIFACT",
        `artifact ${a.id} status=${a.status}`,
      );
      continue;
    }
    if (input?.curriculum_id && a.curriculum_id !== input.curriculum_id) {
      addWarning(
        "VLO_MASTERY_SPARSE_VISUAL_EVIDENCE",
        `artifact ${a.id} curriculum mismatch (ausgeschlossen)`,
      );
      continue;
    }
    if (input?.competence_id && a.competence_id !== input.competence_id) {
      addWarning(
        "VLO_MASTERY_SPARSE_VISUAL_EVIDENCE",
        `artifact ${a.id} competence mismatch (ausgeschlossen)`,
      );
      continue;
    }
    eligibleArtifacts.set(a.id, a);
  }

  if (blockers.length > 0) {
    return {
      curriculum_id: input?.curriculum_id ?? "",
      competence_id: input?.competence_id ?? "",
      signals: [],
      blockers,
      warnings,
      learner_visible: false,
      is_supplemental_only: true,
    };
  }

  let order = 0;
  const nextOrder = () => ++order;

  // Resolved misconceptions → misconception_resolved.
  const resolved = new Set(input.resolved_misconception_ids ?? []);
  for (const mid of [...resolved].sort()) {
    // Find a referencing artifact for context (deterministic — first by id asc).
    const artifact = [...eligibleArtifacts.values()]
      .filter((a) => (a.misconceptions ?? []).some((m) => m.blueprint_misconception_id === mid))
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    const co = nextOrder();
    signals.push({
      curriculum_id: input.curriculum_id,
      competence_id: input.competence_id,
      lesson_id: input.lesson_id,
      mini_check_id: input.mini_check_id,
      visual_artifact_id: artifact?.id,
      misconception_id: mid,
      signal_kind: "misconception_resolved",
      severity: SIGNAL_SEVERITY.misconception_resolved,
      confidence: "medium",
      reason: reasonFor("misconception_resolved"),
      evidence: [
        {
          source: "explicit_mapping",
          created_order: co,
          detail: `resolved misconception ${mid}`,
        },
      ],
      source_refs: sourceRefs,
      created_order: co,
    });
  }

  // Feedback items → misconception_detected / weakens_mastery / strengthens.
  const fb = input.feedback;
  if (fb) {
    // positive signals → strengthens_mastery (one aggregated per competence).
    if (fb.positive_signals.length > 0) {
      const co = nextOrder();
      signals.push({
        curriculum_id: input.curriculum_id,
        competence_id: input.competence_id,
        lesson_id: input.lesson_id,
        mini_check_id: input.mini_check_id,
        signal_kind: "strengthens_mastery",
        severity: SIGNAL_SEVERITY.strengthens_mastery,
        confidence:
          fb.positive_signals.length >= 2 ? "medium" : "low",
        reason: reasonFor("strengthens_mastery"),
        evidence: fb.positive_signals.map((p, i) => ({
          source: "minicheck_feedback" as const,
          question_id: p.question_id,
          question_order: p.question_order,
          created_order: co + i * 0, // stable shared order
          detail: "correct answer",
        })),
        source_refs: sourceRefs,
        created_order: co,
      });
    }

    for (const item of fb.items) {
      const isInArtifact =
        item.visual_artifact_id && eligibleArtifacts.has(item.visual_artifact_id);
      if (item.visual_artifact_id && !isInArtifact) {
        addWarning(
          "VLO_MASTERY_TEXT_ONLY_FALLBACK",
          `artifact ${item.visual_artifact_id} nicht eligible`,
        );
      }
      const kind: VloMasterySignalKind =
        item.severity === "correction"
          ? "misconception_detected"
          : "weakens_mastery";

      const co = nextOrder();
      const confidence: VloMasteryConfidenceBand =
        sourceRefs.length >= 1 && isInArtifact ? "medium" : "low";
      if (confidence === "low") {
        addWarning(
          "VLO_MASTERY_LOW_SIGNAL_CONFIDENCE",
          `signal ${kind} q=${item.question_id} confidence=low`,
        );
      }
      signals.push({
        curriculum_id: input.curriculum_id,
        competence_id: input.competence_id,
        lesson_id: input.lesson_id,
        mini_check_id: input.mini_check_id,
        visual_artifact_id: item.visual_artifact_id,
        misconception_id: item.misconception_id,
        signal_kind: kind,
        severity: SIGNAL_SEVERITY[kind],
        confidence,
        reason: reasonFor(kind),
        evidence: [
          {
            source: "minicheck_feedback",
            question_id: item.question_id,
            question_order: item.question_order,
            created_order: co,
            detail: item.repetition_hint,
          },
        ],
        source_refs: sourceRefs,
        created_order: co,
      });
    }
  }

  // Repetition detection: same misconception in prior + current.
  const counts = new Map<string, number>();
  for (const p of input.prior_signals ?? []) {
    if (
      p.competence_id === input.competence_id &&
      p.misconception_id &&
      (p.signal_kind === "misconception_detected" ||
        p.signal_kind === "weakens_mastery")
    ) {
      counts.set(p.misconception_id, (counts.get(p.misconception_id) ?? 0) + 1);
    }
  }
  for (const s of signals) {
    if (
      s.misconception_id &&
      (s.signal_kind === "misconception_detected" ||
        s.signal_kind === "weakens_mastery")
    ) {
      counts.set(s.misconception_id, (counts.get(s.misconception_id) ?? 0) + 1);
    }
  }
  for (const [mid, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (resolved.has(mid)) continue;
    if (n >= FROZEN_VLO_MASTERY_SIGNAL_POLICY.repetition_threshold) {
      const co = nextOrder();
      const artifact = [...eligibleArtifacts.values()]
        .filter((a) =>
          (a.misconceptions ?? []).some((m) => m.blueprint_misconception_id === mid),
        )
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      signals.push({
        curriculum_id: input.curriculum_id,
        competence_id: input.competence_id,
        lesson_id: input.lesson_id,
        mini_check_id: input.mini_check_id,
        visual_artifact_id: artifact?.id,
        misconception_id: mid,
        signal_kind: "needs_repetition",
        severity: SIGNAL_SEVERITY.needs_repetition,
        confidence: "medium",
        reason: reasonFor("needs_repetition"),
        evidence: [
          {
            source: "prior_signal",
            created_order: co,
            detail: `repeated x${n}`,
          },
        ],
        source_refs: sourceRefs,
        created_order: co,
      });
      addWarning(
        "VLO_MASTERY_REPEATED_MISCONCEPTION",
        `misconception ${mid} wiederholt (x${n})`,
      );
    }
  }

  if ((input.prior_signals ?? []).length === 0 && signals.length === 0) {
    addWarning("VLO_MASTERY_NO_PRIOR_SIGNAL", "keine vorherigen Signale vorhanden");
  }

  // Deterministic sort.
  signals.sort(sortSignals);

  return {
    curriculum_id: input.curriculum_id,
    competence_id: input.competence_id,
    signals,
    blockers,
    warnings,
    learner_visible: true,
    is_supplemental_only: true,
  };
}

function sortSignals(a: VisualMasterySignal, b: VisualMasterySignal): number {
  if (a.competence_id !== b.competence_id) {
    return a.competence_id.localeCompare(b.competence_id);
  }
  const sk = signalKindRank(a.signal_kind) - signalKindRank(b.signal_kind);
  if (sk !== 0) return sk;
  if (a.severity !== b.severity) return b.severity - a.severity;
  const am = a.misconception_id ?? "";
  const bm = b.misconception_id ?? "";
  if (am !== bm) return am < bm ? -1 : 1;
  return a.created_order - b.created_order;
}

export function aggregateVisualMasterySignals(
  result: VisualMasterySignalResult,
): VisualMasteryAggregation {
  const totals = emptyTotals();
  for (const s of result.signals) {
    totals[s.signal_kind] += 1;
  }
  const signals = [...result.signals].sort(sortSignals);
  return {
    curriculum_id: result.curriculum_id,
    competence_id: result.competence_id,
    totals,
    signals,
    blockers: result.blockers,
    warnings: result.warnings,
    is_supplemental_only: true,
  };
}

export function projectVisualMasteryForLearner(
  agg: VisualMasteryAggregation,
): VisualMasteryLearnerProjection {
  if (agg.blockers.length > 0) {
    return {
      curriculum_id: agg.curriculum_id,
      competence_id: agg.competence_id,
      hints: [],
      learner_visible: false,
      empty: true,
    };
  }
  const seen = new Set<VloMasterySignalKind>();
  const hints: VisualMasteryLearnerHint[] = [];
  for (const s of agg.signals) {
    if (seen.has(s.signal_kind)) continue;
    seen.add(s.signal_kind);
    hints.push({ kind: s.signal_kind, message: learnerCopyFor(s.signal_kind) });
    if (hints.length >= FROZEN_VLO_MASTERY_SIGNAL_POLICY.max_learner_hints_per_competence) {
      break;
    }
  }
  return {
    curriculum_id: agg.curriculum_id,
    competence_id: agg.competence_id,
    hints,
    learner_visible: hints.length > 0,
    empty: hints.length === 0,
  };
}

export function projectVisualMasteryForAdmin(
  agg: VisualMasteryAggregation,
): VisualMasteryAdminProjection {
  return {
    curriculum_id: agg.curriculum_id,
    competence_id: agg.competence_id,
    totals: agg.totals,
    signals: agg.signals,
    warnings: agg.warnings,
    blockers: agg.blockers,
    is_supplemental_only: true,
    note: "Visual Learning ist ein ergänzendes Signal, keine alleinige Mastery-Entscheidung.",
  };
}
