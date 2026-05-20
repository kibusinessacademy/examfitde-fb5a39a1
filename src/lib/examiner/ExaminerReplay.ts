/**
 * Phase 8.6 — Examiner Forensics & Replay Engine.
 * Deterministische Wiedergabe und Widerspruchs-Erkennung.
 */
import type { ExaminerDecisionRecord } from "./ExaminerDecisionLog";
import type { EvidenceChain } from "./ExaminerEvidence";
import type { DeliberationResult } from "./ExaminerDeliberation";

export interface ReplayResult {
  ok: boolean;
  drifts: string[];
  normalized: ExaminerDecisionRecord;
}

export function replayExaminerDecision(record: ExaminerDecisionRecord): ReplayResult {
  const normalized = freezeRecord(record);
  const drifts: string[] = [];
  if (normalized.confidence !== record.confidence) drifts.push("confidence");
  if (normalized.verdict_headline !== record.verdict_headline) drifts.push("verdict_headline");
  return { ok: drifts.length === 0, drifts, normalized };
}

export function compareDecisionOutputs(
  a: ExaminerDecisionRecord,
  b: ExaminerDecisionRecord,
): { ok: boolean; drifts: string[] } {
  const drifts: string[] = [];
  if (a.verdict_headline !== b.verdict_headline) drifts.push("verdict_headline");
  if (a.readiness_state !== b.readiness_state) drifts.push("readiness_state");
  if (round2(a.confidence) !== round2(b.confidence)) drifts.push("confidence");
  if (a.readiness !== b.readiness) drifts.push("readiness");
  if (a.evidence_ids.length !== b.evidence_ids.length) drifts.push("evidence.length");
  return { ok: drifts.length === 0, drifts };
}

export interface Contradiction {
  kind: "unsupported_verdict" | "orphan_evidence" | "impossible_confidence" | "conflicting_risks";
  details: string;
}

export function detectContradictions(args: {
  decision: ExaminerDecisionRecord;
  deliberation: DeliberationResult;
  evidence: EvidenceChain[];
}): Contradiction[] {
  const out: Contradiction[] = [];
  const { decision, deliberation, evidence } = args;
  if (decision.readiness_state === "ready_for_exam" && deliberation.blocking_risks.length > 0) {
    out.push({ kind: "unsupported_verdict", details: `ready trotz ${deliberation.blocking_risks.length} Blockern` });
  }
  if (decision.confidence < 0 || decision.confidence > 1) {
    out.push({ kind: "impossible_confidence", details: `c=${decision.confidence}` });
  }
  for (const chain of evidence) {
    if (chain.evidence.length === 0) {
      out.push({ kind: "orphan_evidence", details: `chain "${chain.claim}" ohne Belege` });
    }
  }
  const criticals = evidence.flatMap((c) => c.evidence).filter((i) => i.severity === "critical").length;
  if (criticals > 0 && decision.readiness_state === "ready_for_exam") {
    out.push({ kind: "conflicting_risks", details: `${criticals} critical evidence vs ready` });
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function freezeRecord(r: ExaminerDecisionRecord): ExaminerDecisionRecord {
  return {
    ...r,
    confidence: round2(r.confidence),
    evidence_ids: [...r.evidence_ids].sort((a, b) => a.localeCompare(b)),
  };
}
