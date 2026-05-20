/**
 * Phase 7.9 — Examiner Deliberation Engine
 *
 * Pure deterministic deliberation. Bewertet wie ein erfahrener IHK-Prüfer:
 * Gewichtung statt Mittelwert. Kritische Kompetenzen können Readiness
 * blockieren. Mündliche Instabilität, hohe Score-Werte mit niedriger
 * Confidence, widersprüchliche Evidence → fail-safe.
 */
import type {
  BehavioralSignals,
  RiskKey,
  RiskState,
} from "@/lib/system/SystemConsciousness";
import type { EvidenceChain } from "./ExaminerEvidence";
import type { StabilitySignal, RecurringWeakness, ExamConsistency } from "./ExaminerLongitudinal";

export type ReadinessState =
  | "not_ready"
  | "readiness_risk"
  | "conditionally_ready"
  | "ready_for_exam";

export interface DeliberationInput {
  readiness: number;
  risks: Record<RiskKey, RiskState>;
  signals: BehavioralSignals;
  verdictEvidence: EvidenceChain;
  topRiskEvidence: EvidenceChain[];
  stability: StabilitySignal;
  recurring: RecurringWeakness[];
  consistency: ExamConsistency;
  /** Kompetenzen, die per Definition Bestehensvoraussetzung sind. */
  criticalCompetencyKeys?: RiskKey[];
}

export interface DeliberationResult {
  readiness_state: ReadinessState;
  deliberation_reasoning: string[];
  confidence: number; // 0..1
  blocking_risks: RiskState[];
  supporting_evidence: EvidenceChain;
  /** Wenn true, darf KEINE positive Readiness ausgegeben werden. */
  failSafeTriggered: boolean;
}

const DEFAULT_CRITICAL: RiskKey[] = [
  "transfer_argumentation",
  "muendliche_stabilitaet",
  "schriftliche_stabilitaet",
];

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function deriveDeliberation(input: DeliberationInput): DeliberationResult {
  const crit = input.criticalCompetencyKeys ?? DEFAULT_CRITICAL;
  const reasoning: string[] = [];
  const blocking: RiskState[] = [];

  const criticalRisks = Object.values(input.risks).filter((r) => r.tone === "critical");
  const criticalCore = criticalRisks.filter((r) => crit.includes(r.key));
  if (criticalCore.length > 0) {
    blocking.push(...criticalCore);
    reasoning.push(
      `${criticalCore.length} kritische Kernkompetenz${criticalCore.length === 1 ? "" : "en"} blockiert Prüfungsreife.`,
    );
  }

  if (input.stability.reading === "instabil") {
    reasoning.push("Antwortverhalten ist über Sessions hinweg instabil.");
  }
  if (input.consistency.reading === "schwankend" && input.consistency.observedSessions >= 3) {
    reasoning.push("Konsistenz über Prüfungssimulationen schwankend.");
  }
  for (const r of input.recurring.slice(0, 2)) {
    reasoning.push(r.reading);
  }

  // Confidence — sinkt bei widersprüchlicher Evidence / niedriger Stabilität.
  const evidenceConfidence = input.verdictEvidence.confidence;
  const stabilityConfidence = clamp01(input.stability.index / 100);
  const contradiction =
    input.readiness >= 75 && criticalRisks.length >= 1 ? 0.25 : 0;
  const confidence = clamp01(
    Math.min(evidenceConfidence, stabilityConfidence) - contradiction,
  );

  if (contradiction > 0) {
    reasoning.push("Score hoch, kritische Risiken aktiv — widersprüchliche Evidence.");
  }

  // Fail-safe
  const failSafe =
    criticalCore.length > 0 ||
    confidence < 0.35 ||
    (input.readiness >= 80 && criticalRisks.length >= 2);

  let state: ReadinessState;
  if (failSafe) {
    state = criticalCore.length > 0 ? "not_ready" : "readiness_risk";
  } else if (input.readiness >= 80 && confidence >= 0.7 && input.stability.reading === "stabil") {
    state = "ready_for_exam";
  } else if (input.readiness >= 65 && confidence >= 0.55) {
    state = "conditionally_ready";
  } else if (input.readiness >= 50) {
    state = "readiness_risk";
  } else {
    state = "not_ready";
  }

  if (reasoning.length === 0) {
    reasoning.push("Prüferische Einschätzung folgt der aktuellen Evidence ohne Sondergewichtung.");
  }

  return {
    readiness_state: state,
    deliberation_reasoning: reasoning.slice(0, 3),
    confidence: Number(confidence.toFixed(2)),
    blocking_risks: blocking,
    supporting_evidence: input.verdictEvidence,
    failSafeTriggered: failSafe,
  };
}

export const READINESS_STATE_LABEL: Record<ReadinessState, string> = {
  not_ready: "Noch nicht prüfungsreif",
  readiness_risk: "Prüfungsreife gefährdet",
  conditionally_ready: "Bedingt prüfungsreif",
  ready_for_exam: "Prüfungsreif",
};
