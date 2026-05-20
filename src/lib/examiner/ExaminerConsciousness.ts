/**
 * Phase 8.1 — Unified Examiner Consciousness Facade.
 *
 * EINZIGE prüferische Wahrheit für alle Surfaces (Tutor, Oral, MiniCheck,
 * Exam, Dashboard, Landing, Analytics). Erweitert die bestehende
 * `useExaminationConsciousness`-Facade um Evidence, Longitudinal,
 * Deliberation, Readiness-Authority, Decision-Log.
 *
 * Surfaces dürfen ausschließlich aus DIESEM Hook lesen — keine lokale
 * Readiness, keine lokale Risiko-Ableitung, kein lokales Verdict.
 */
import { useMemo } from "react";
import {
  useExaminationConsciousness,
  type ExaminationConsciousness,
} from "@/lib/system/ExaminationConsciousness";
import {
  deriveVerdictEvidence,
  deriveTopRiskEvidence,
  deriveReadinessEvidence,
  type EvidenceChain,
} from "./ExaminerEvidence";
import {
  deriveReadinessTrend,
  deriveStabilitySignal,
  deriveRecurringWeaknesses,
  deriveExamConsistency,
  type ReadinessTrend,
  type StabilitySignal,
  type RecurringWeakness,
  type ExamConsistency,
} from "./ExaminerLongitudinal";
import { deriveDeliberation, type DeliberationResult } from "./ExaminerDeliberation";
import { deriveReadinessAuthority, type ReadinessAuthorityVerdict } from "./ReadinessAuthority";
import { buildDecisionRecord, type ExaminerDecisionRecord } from "./ExaminerDecisionLog";
import { useSystemConsciousness } from "@/lib/system/SystemConsciousness";

export interface ExaminerConsciousness extends ExaminationConsciousness {
  // Evidence Layer (7.7)
  verdictEvidence: EvidenceChain;
  topRiskEvidence: EvidenceChain[];
  readinessEvidence: EvidenceChain;
  // Longitudinal Layer (7.8)
  trend: ReadinessTrend;
  stability: StabilitySignal;
  recurring: RecurringWeakness[];
  consistency: ExamConsistency;
  // Deliberation Layer (7.9)
  deliberation: DeliberationResult;
  // Readiness Authority (8.3)
  authority: ReadinessAuthorityVerdict;
  // Auditability (8.2)
  decision: ExaminerDecisionRecord;
}

export function useExaminerConsciousness(elapsedRatio = 0): ExaminerConsciousness {
  const base = useExaminationConsciousness(elapsedRatio);
  const { risks, signals, memory, readiness } = useSystemConsciousness();

  return useMemo<ExaminerConsciousness>(() => {
    const verdictEvidence = deriveVerdictEvidence({
      verdictHeadline: base.verdict.headline,
      verdictDetail: base.verdict.detail,
      risks,
      memory,
      readiness,
      signals,
    });
    const topRiskEvidence = deriveTopRiskEvidence(risks, memory, 3);
    const readinessEvidence = deriveReadinessEvidence({ readiness, risks, signals, memory });

    const trend = deriveReadinessTrend(memory, readiness);
    const stability = deriveStabilitySignal(memory);
    const recurring = deriveRecurringWeaknesses(risks, memory);
    const consistency = deriveExamConsistency(memory);

    const deliberation = deriveDeliberation({
      readiness,
      risks,
      signals,
      verdictEvidence,
      topRiskEvidence,
      stability,
      recurring,
      consistency,
    });

    const authority = deriveReadinessAuthority(deliberation);

    const decision = buildDecisionRecord({
      readiness,
      verdict: { headline: base.verdict.headline, tone: base.verdict.tone },
      deliberation,
      verdictEvidence,
    });

    return {
      ...base,
      verdictEvidence,
      topRiskEvidence,
      readinessEvidence,
      trend,
      stability,
      recurring,
      consistency,
      deliberation,
      authority,
      decision,
    };
  }, [base, risks, signals, memory, readiness]);
}
