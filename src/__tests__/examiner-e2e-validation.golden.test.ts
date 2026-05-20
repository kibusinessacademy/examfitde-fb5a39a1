/**
 * Phase 8.8 — Examiner E2E Validation (cross-surface determinism).
 *
 * Verifiziert, dass identische Inputs auf jedem Surface dieselbe
 * prüferische Wahrheit liefern (Replay, Drift, Widerspruchsfreiheit).
 */
import { describe, it, expect } from "vitest";
import {
  buildDecisionRecord,
  assertDecisionReplay,
  type ExaminerDecisionRecord,
} from "@/lib/examiner/ExaminerDecisionLog";
import {
  replayExaminerDecision,
  compareDecisionOutputs,
  detectContradictions,
} from "@/lib/examiner/ExaminerReplay";
import type { DeliberationResult } from "@/lib/examiner/ExaminerDeliberation";
import type { EvidenceChain } from "@/lib/examiner/ExaminerEvidence";

const evidenceChain: EvidenceChain = {
  claim: "Prüfungsreife 72/100 — 2 stabile, 1 kritische Achse.",
  evidence: [
    {
      id: "ev_a",
      competency_id: null,
      source_type: "learning_progress",
      source_id: "global_readiness",
      evidence_strength: 0.72,
      detected_pattern: "readiness_score",
      observation: "Globale Prüfungsreife liegt bei 72 von 100.",
      exam_relevance: "kern",
      confidence: 0.7,
      severity: "medium",
      detected_at: 1700000000000,
    },
  ],
  confidence: 0.7,
  severity: "medium",
  tone: "watch",
};

const deliberation: DeliberationResult = {
  readiness_state: "conditionally_ready",
  deliberation_reasoning: ["Stabilität ausreichend, Transfer noch fragil."],
  confidence: 0.62,
  blocking_risks: [],
  supporting_evidence: evidenceChain,
  failSafeTriggered: false,
};

function buildSurface(ts: number): ExaminerDecisionRecord {
  return buildDecisionRecord({
    readiness: 72,
    verdict: { headline: "Bedingt prüfungsreif", tone: "watch" },
    deliberation,
    verdictEvidence: evidenceChain,
    ts,
  });
}

describe("Phase 8.8 — Examiner E2E cross-surface validation", () => {
  it("liefert identische Entscheidung für identischen Input (Tutor vs Exam vs Oral)", () => {
    const tutor = buildSurface(1700000001000);
    const exam = buildSurface(1700000002000);
    const oral = buildSurface(1700000003000);
    expect(tutor.id).toBe(exam.id);
    expect(exam.id).toBe(oral.id);
    expect(assertDecisionReplay(tutor, exam).ok).toBe(true);
    expect(compareDecisionOutputs(exam, oral).ok).toBe(true);
  });

  it("Replay normalisiert deterministisch (Confidence-Rundung, Evidence-Sort)", () => {
    const rec = buildSurface(1700000000000);
    const replay = replayExaminerDecision(rec);
    expect(replay.normalized.evidence_ids).toEqual([...rec.evidence_ids].sort());
    expect(replay.normalized.confidence).toBe(Math.round(rec.confidence * 100) / 100);
  });

  it("erkennt orphan_evidence und impossible_confidence", () => {
    const broken: ExaminerDecisionRecord = { ...buildSurface(1), confidence: 1.5 };
    const contradictions = detectContradictions({
      decision: broken,
      deliberation,
      evidence: [{ ...evidenceChain, evidence: [] }],
    });
    expect(contradictions.some((c) => c.kind === "impossible_confidence")).toBe(true);
    expect(contradictions.some((c) => c.kind === "orphan_evidence")).toBe(true);
  });

  it("blockt 'ready_for_exam' bei aktiven Blockern (unsupported_verdict)", () => {
    const ready: ExaminerDecisionRecord = { ...buildSurface(1), readiness_state: "ready_for_exam" };
    const delibWithBlocker: DeliberationResult = {
      ...deliberation,
      blocking_risks: [
        { key: "transfer_argumentation", label: "Transfer", tone: "critical", since: 0 } as any,
      ],
    };
    const contradictions = detectContradictions({
      decision: ready,
      deliberation: delibWithBlocker,
      evidence: [evidenceChain],
    });
    expect(contradictions.some((c) => c.kind === "unsupported_verdict")).toBe(true);
  });
});
