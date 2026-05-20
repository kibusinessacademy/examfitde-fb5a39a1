/**
 * Phase 7.9 / 8.3 — Golden tests for deliberation engine & readiness authority.
 */
import { describe, it, expect } from "vitest";
import { deriveDeliberation } from "@/lib/examiner/ExaminerDeliberation";
import { deriveReadinessAuthority } from "@/lib/examiner/ReadinessAuthority";
import {
  deriveReadinessEvidence,
  deriveTopRiskEvidence,
  deriveVerdictEvidence,
} from "@/lib/examiner/ExaminerEvidence";
import type { RiskKey, RiskState, MemoryEntry, BehavioralSignals } from "@/lib/system/SystemConsciousness";

const NOW = 1_700_000_000_000;

function stableRisks(): Record<RiskKey, RiskState> {
  return {
    transfer_argumentation: { key: "transfer_argumentation", label: "Transfer-Argumentation", tone: "stable", since: NOW - 10 * 86400000 },
    schriftliche_stabilitaet: { key: "schriftliche_stabilitaet", label: "Schriftliche Stabilität", tone: "stable", since: NOW - 10 * 86400000 },
    rueckfragen_wahrscheinlich: { key: "rueckfragen_wahrscheinlich", label: "Rückfragen wahrscheinlich", tone: "stable", since: NOW - 10 * 86400000 },
    zeitdruck_relevant: { key: "zeitdruck_relevant", label: "Zeitdruck relevant", tone: "stable", since: NOW - 10 * 86400000 },
    praxisbezug: { key: "praxisbezug", label: "Praxisbezug", tone: "stable", since: NOW - 10 * 86400000 },
    muendliche_stabilitaet: { key: "muendliche_stabilitaet", label: "Mündliche Stabilität", tone: "stable", since: NOW - 10 * 86400000 },
    lf5_bewertung: { key: "lf5_bewertung", label: "LF5 Bewertung", tone: "stable", since: NOW - 10 * 86400000 },
    antwortstruktur: { key: "antwortstruktur", label: "Antwortstruktur", tone: "stable", since: NOW - 10 * 86400000 },
  };
}

const signals: BehavioralSignals = {
  timePressure: 0.35,
  hesitation: 0.2,
  structureStability: 0.55,
  confidence: 0.75,
  updatedAt: NOW,
};

const memory: MemoryEntry[] = [
  { id: "m1", ts: NOW - 86400000, text: "stabil", source: "Exam-Trainer", tone: "stable" },
  { id: "m2", ts: NOW - 2 * 86400000, text: "stabil", source: "Exam-Trainer", tone: "stable" },
  { id: "m3", ts: NOW - 3 * 86400000, text: "stabil", source: "Exam-Trainer", tone: "stable" },
];

function buildInput(readinessScore: number, risks = stableRisks()) {
  const verdictEvidence = deriveVerdictEvidence({
    verdictHeadline: "Stabilisierung konsolidiert",
    verdictDetail: "Recovery konsistent.",
    risks,
    memory,
    readiness: readinessScore,
    signals,
  });
  return {
    readiness: readinessScore,
    risks,
    signals,
    verdictEvidence,
    topRiskEvidence: deriveTopRiskEvidence(risks, memory, 3),
    stability: { index: 85, volatility: 0.1, reading: "stabil" as const },
    recurring: [],
    consistency: { index: 0.85, reading: "konsistent" as const, observedSessions: 4 },
  };
}

describe("Deliberation Engine", () => {
  it("ready_for_exam requires high readiness AND confidence AND stability", () => {
    const d = deriveDeliberation(buildInput(85));
    expect(d.readiness_state).toBe("ready_for_exam");
    expect(d.failSafeTriggered).toBe(false);
  });

  it("critical core competency blocks readiness even at high score", () => {
    const risks = stableRisks();
    risks.transfer_argumentation = { ...risks.transfer_argumentation, tone: "critical" };
    const d = deriveDeliberation(buildInput(85, risks));
    expect(d.readiness_state).toBe("not_ready");
    expect(d.failSafeTriggered).toBe(true);
    expect(d.blocking_risks.length).toBeGreaterThan(0);
  });

  it("readiness authority refuses recommendation when not ready_for_exam", () => {
    const risks = stableRisks();
    risks.muendliche_stabilitaet = { ...risks.muendliche_stabilitaet, tone: "critical" };
    const d = deriveDeliberation(buildInput(85, risks));
    const a = deriveReadinessAuthority(d);
    expect(a.examRecommended).toBe(false);
    expect(a.reasons.length).toBeGreaterThan(0);
  });

  it("same input → same deliberation (determinism)", () => {
    const a = deriveDeliberation(buildInput(85));
    const b = deriveDeliberation(buildInput(85));
    expect(a.readiness_state).toBe(b.readiness_state);
    expect(a.confidence).toBe(b.confidence);
  });
});
