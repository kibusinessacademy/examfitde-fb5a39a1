/**
 * Phase 7.0 — Full Examination Consciousness
 *
 * Vereinigende Facade über alle Phase-6-Module. Liefert EINE
 * konsistente Sicht auf:
 *   - Wahrnehmung (Risks, Signals, Memory)
 *   - Interpretation (Patterns, Examiner-Lens, Examiner-Memory)
 *   - Adaptive Steuerung (Personality, TransferComplexity, Dramaturgy)
 *   - Belastungsdynamik (Fatigue, Recovery)
 *   - Strategie (Priority, SimulationPlan, PredictiveReadiness)
 *   - Selbstwirksamkeit (SelfEfficacy)
 *
 * Alle Surfaces dürfen ausschließlich aus dieser Facade lesen — niemand
 * hält eigene prüferische Wahrheit. Konsistent. Kohärent. Ein Prüfer.
 */
import { useMemo } from "react";
import { useSystemConsciousness, type RiskState, type RiskTone } from "./SystemConsciousness";
import { useExamPsychology, type ExamPsychologyView } from "./ExamPsychology";
import { useExamDramaturgy, type ExamDramaturgyView } from "./ExamDramaturgy";
import { useExaminerPersonality, type ExaminerProfile } from "./ExaminerPersonality";
import { useTransferComplexity, type TransferComplexity } from "./TransferComplexity";
import { useCognitiveFatigue, type FatigueState } from "./CognitiveFatigue";
import { useRecoveryLogic, type RecoveryState } from "./RecoveryLogic";
import { useSimulationPlan, type SimulationPlan } from "./SimulationEngine";
import { useExaminerMemory, type ExaminerMemoryView } from "./ExaminerMemory";
import { useSelfEfficacy, type SelfEfficacyView } from "./SelfEfficacy";
import { usePredictiveReadiness, type PredictiveReadinessView } from "./PredictiveReadiness";

export interface ExaminationConsciousness {
  // Perception
  readiness: number;
  topRisks: RiskState[];
  // Interpretation
  psychology: ExamPsychologyView;
  examinerMemory: ExaminerMemoryView;
  // Adaptive Control
  personality: ExaminerProfile;
  transfer: TransferComplexity;
  dramaturgy: ExamDramaturgyView;
  // Load Dynamics
  fatigue: FatigueState;
  recovery: RecoveryState;
  // Strategy
  simulation: SimulationPlan;
  forecast: PredictiveReadinessView;
  // Self-Efficacy
  efficacy: SelfEfficacyView;
  // Single coherent verdict — what a single examiner would say right now.
  verdict: {
    headline: string;
    detail: string;
    tone: RiskTone;
  };
}

function buildVerdict(args: {
  fatigue: FatigueState;
  recovery: RecoveryState;
  psychology: ExamPsychologyView;
  forecast: PredictiveReadinessView;
}): ExaminationConsciousness["verdict"] {
  const { fatigue, recovery, psychology, forecast } = args;
  if (fatigue.level === "kritisch") {
    return {
      headline: "Belastung kritisch — Pause empfohlen",
      detail: "Antwortstabilität sinkt — Bewertung sollte deliberativ erfolgen.",
      tone: "critical",
    };
  }
  if (psychology.patterns[0]?.key === "transfer_collapses_under_pressure") {
    return {
      headline: "Transfer kollabiert unter Druck",
      detail: "Argumentation bleibt fachlich korrekt, verliert unter Zeitdruck Struktur.",
      tone: "critical",
    };
  }
  if (recovery.index >= 60 && forecast.dailyDelta > 0.5) {
    return {
      headline: "Stabilisierung konsolidiert",
      detail: "Recovery-Muster konsistent, Prognose positiv im 14-Tage-Horizont.",
      tone: "stable",
    };
  }
  return {
    headline: psychology.priority.focus,
    detail: psychology.priority.reason,
    tone: psychology.priority.tone,
  };
}

export function useExaminationConsciousness(elapsedRatio = 0): ExaminationConsciousness {
  const sys = useSystemConsciousness();
  const psychology = useExamPsychology();
  const dramaturgy = useExamDramaturgy(elapsedRatio);
  const personality = useExaminerPersonality();
  const transfer = useTransferComplexity();
  const fatigue = useCognitiveFatigue();
  const recovery = useRecoveryLogic();
  const simulation = useSimulationPlan();
  const examinerMemory = useExaminerMemory();
  const efficacy = useSelfEfficacy();
  const forecast = usePredictiveReadiness();

  return useMemo<ExaminationConsciousness>(() => {
    const verdict = buildVerdict({ fatigue, recovery, psychology, forecast });
    return {
      readiness: sys.readiness,
      topRisks: sys.topRisks(3),
      psychology,
      examinerMemory,
      personality,
      transfer,
      dramaturgy,
      fatigue,
      recovery,
      simulation,
      forecast,
      efficacy,
      verdict,
    };
  }, [sys, psychology, examinerMemory, personality, transfer, dramaturgy, fatigue, recovery, simulation, efficacy, forecast]);
}
