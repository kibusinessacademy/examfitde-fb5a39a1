/**
 * Phase 7.7 — Golden tests for examiner evidence determinism & contract.
 */
import { describe, it, expect } from "vitest";
import {
  deriveReadinessEvidence,
  deriveTopRiskEvidence,
  deriveVerdictEvidence,
  assertVerdictEvidenceContract,
} from "@/lib/examiner/ExaminerEvidence";
import type {
  RiskKey,
  RiskState,
  MemoryEntry,
  BehavioralSignals,
} from "@/lib/system/SystemConsciousness";

const NOW = 1_700_000_000_000;

function fixtureRisks(): Record<RiskKey, RiskState> {
  return {
    transfer_argumentation: { key: "transfer_argumentation", label: "Transfer-Argumentation", tone: "critical", since: NOW - 7 * 86400000 },
    schriftliche_stabilitaet: { key: "schriftliche_stabilitaet", label: "Schriftliche Stabilität", tone: "watch", since: NOW - 3 * 86400000 },
    rueckfragen_wahrscheinlich: { key: "rueckfragen_wahrscheinlich", label: "Rückfragen wahrscheinlich", tone: "watch", since: NOW - 2 * 86400000 },
    zeitdruck_relevant: { key: "zeitdruck_relevant", label: "Zeitdruck relevant", tone: "stable", since: NOW - 5 * 86400000 },
    praxisbezug: { key: "praxisbezug", label: "Praxisbezug", tone: "stable", since: NOW - 4 * 86400000 },
    muendliche_stabilitaet: { key: "muendliche_stabilitaet", label: "Mündliche Stabilität", tone: "stable", since: NOW - 4 * 86400000 },
    lf5_bewertung: { key: "lf5_bewertung", label: "LF5 Bewertung", tone: "stable", since: NOW - 4 * 86400000 },
    antwortstruktur: { key: "antwortstruktur", label: "Antwortstruktur", tone: "watch", since: NOW - 1 * 86400000 },
  };
}

const fixtureSignals: BehavioralSignals = {
  timePressure: 0.7,
  hesitation: 0.5,
  structureStability: 0.3,
  confidence: 0.4,
  updatedAt: NOW,
};

const fixtureMemory: MemoryEntry[] = [
  { id: "m1", ts: NOW - 86400000, text: "Transfer bricht unter Zeitdruck ein", source: "Exam-Trainer", tone: "critical" },
  { id: "m2", ts: NOW - 2 * 86400000, text: "Schriftliche Antwort gut strukturiert", source: "MiniCheck", tone: "stable" },
];

describe("Examiner Evidence — determinism", () => {
  it("same input → identical evidence ids", () => {
    const a = deriveReadinessEvidence({ readiness: 62, risks: fixtureRisks(), signals: fixtureSignals, memory: fixtureMemory });
    const b = deriveReadinessEvidence({ readiness: 62, risks: fixtureRisks(), signals: fixtureSignals, memory: fixtureMemory });
    expect(a.evidence.map((e) => e.id)).toEqual(b.evidence.map((e) => e.id));
  });

  it("top risks contain critical first", () => {
    const top = deriveTopRiskEvidence(fixtureRisks(), fixtureMemory, 3);
    expect(top[0].tone).toBe("critical");
    expect(top.length).toBe(3);
  });

  it("verdict evidence contract holds", () => {
    const chain = deriveVerdictEvidence({
      verdictHeadline: "Transfer kollabiert unter Druck",
      verdictDetail: "Argumentation verliert Struktur unter Zeitdruck.",
      risks: fixtureRisks(),
      memory: fixtureMemory,
      readiness: 62,
      signals: fixtureSignals,
    });
    const report = assertVerdictEvidenceContract(chain);
    expect(report.ok).toBe(true);
    expect(chain.evidence.length).toBeGreaterThan(0);
    expect(chain.evidence.length).toBeLessThanOrEqual(3);
  });

  it("rejects fake precision (>0.99 confidence)", () => {
    const chain = deriveVerdictEvidence({
      verdictHeadline: "x",
      verdictDetail: "y",
      risks: fixtureRisks(),
      memory: fixtureMemory,
      readiness: 62,
      signals: fixtureSignals,
    });
    chain.evidence[0].confidence = 1.0;
    const report = assertVerdictEvidenceContract(chain);
    expect(report.ok).toBe(false);
    expect(report.violations).toContain("evidence_fake_precision");
  });
});
