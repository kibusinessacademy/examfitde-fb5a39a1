/**
 * Phase 8.6 — Examiner Forensics & Replay Engine.
 *
 * Deterministische Wiedergabe einer Prüfer-Entscheidung anhand eines
 * eingefrorenen `ExaminerDecisionRecord`. Reine Funktionen, keine
 * Side-Effects, keine UI.
 *
 * Garantiert:
 *   - same input => same output
 *   - stable evidence sorting
 *   - stable confidence rounding
 */
import type { ExaminerDecisionRecord } from "./ExaminerDecisionLog";
import type { EvidenceChain } from "./ExaminerEvidence";
import type { DeliberationResult } from "./ExaminerDeliberation";

export interface ReplayResult {
  ok: boolean;
  drifts: string[];
  normalized: ExaminerDecisionRecord;
}

/** Replay einer Entscheidung — liefert das normalisierte (gefrorene) Record. */
export function replayExaminerDecision(record: ExaminerDecisionRecord): ReplayResult {
  const normalized = freezeRecord(record);
  const drifts: string[] = [];
  if (normalized.confidence !== record.confidence) drifts.push("confidence");
  if (normalized.verdict !== record.verdict) drifts.push("verdict");
  return { ok: drifts.length === 0, drifts, normalized };
}

/** Vergleicht zwei Entscheidungs-Outputs auf Determinismus-Drift. */
export function compareDecisionOutputs(
  a: ExaminerDecisionRecord,
  b: ExaminerDecisionRecord,
): { ok: boolean; drifts: string[] } {
  const drifts: string[] = [];
  if (a.verdict !== b.verdict) drifts.push("verdict");
  if (round2(a.confidence) !== round2(b.confidence)) drifts.push("confidence");
  if (a.readiness !== b.readiness) drifts.push("readiness");
  if (a.evidence.length !== b.evidence.length) drifts.push("evidence.length");
  return { ok: drifts.length === 0, drifts };
}

/** Findet logische Widersprüche in einer Examiner-Entscheidung. */
export interface Contradiction {
  kind:
    | "unsupported_verdict"
    | "orphan_evidence"
    | "impossible_confidence"
    | "conflicting_risks";
  details: string;
}

export function detectContradictions(args: {
  decision: ExaminerDecisionRecord;
  deliberation: DeliberationResult;
  evidence: EvidenceChain[];
}): Contradiction[] {
  const out: Contradiction[] = [];
  const { decision, deliberation, evidence } = args;
  if (decision.verdict === "ready_for_exam" && deliberation.blockers.length > 0) {
    out.push({ kind: "unsupported_verdict", details: `ready trotz ${deliberation.blockers.length} Blockern` });
  }
  if (decision.confidence < 0 || decision.confidence > 1) {
    out.push({ kind: "impossible_confidence", details: `c=${decision.confidence}` });
  }
  for (const chain of evidence) {
    if (chain.items.length === 0) {
      out.push({ kind: "orphan_evidence", details: `chain ${chain.id} ohne items` });
    }
  }
  const criticals = evidence.flatMap((c) => c.items).filter((i) => i.severity === "critical").length;
  if (criticals > 0 && decision.verdict === "ready_for_exam") {
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
    evidence: [...r.evidence].sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}
