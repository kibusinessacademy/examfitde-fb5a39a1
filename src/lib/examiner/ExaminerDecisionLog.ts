/**
 * Phase 8.2 — Examiner Decision Log & Drift Detection.
 *
 * Auditierbarer, deterministischer Log jeder prüferischen Entscheidung.
 * Replay: identical input → identical output. Drift-Guards prüfen
 * Verdict-, Confidence- und Evidence-Konsistenz zwischen Snapshots.
 */
import type { EvidenceChain } from "./ExaminerEvidence";
import type { DeliberationResult, ReadinessState } from "./ExaminerDeliberation";
import type { RiskState } from "@/lib/system/SystemConsciousness";

export interface ExaminerDecisionRecord {
  id: string;
  ts: number;
  readiness: number;
  readiness_state: ReadinessState;
  verdict_headline: string;
  verdict_tone: string;
  confidence: number;
  blocking_risks: string[];
  evidence_ids: string[];
}

export interface DriftReport {
  ok: boolean;
  violations: string[];
}

function recordHash(parts: Array<string | number>): string {
  let h = 2166136261;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `dec_${(h >>> 0).toString(36)}`;
}

export function buildDecisionRecord(args: {
  readiness: number;
  verdict: { headline: string; tone: string };
  deliberation: DeliberationResult;
  verdictEvidence: EvidenceChain;
  ts?: number;
}): ExaminerDecisionRecord {
  const ts = args.ts ?? Date.now();
  const id = recordHash([
    Math.round(args.readiness),
    args.deliberation.readiness_state,
    args.verdict.headline,
    args.verdict.tone,
    args.deliberation.confidence,
    args.verdictEvidence.evidence.map((e) => e.id).join(","),
  ]);
  return {
    id,
    ts,
    readiness: Math.round(args.readiness),
    readiness_state: args.deliberation.readiness_state,
    verdict_headline: args.verdict.headline,
    verdict_tone: args.verdict.tone,
    confidence: args.deliberation.confidence,
    blocking_risks: args.deliberation.blocking_risks.map((r: RiskState) => r.key),
    evidence_ids: args.verdictEvidence.evidence.map((e) => e.id),
  };
}

/** Zwei Snapshots aus derselben Quelle MÜSSEN identische Decision-Ids erzeugen. */
export function assertDecisionReplay(a: ExaminerDecisionRecord, b: ExaminerDecisionRecord): DriftReport {
  const violations: string[] = [];
  if (a.id !== b.id) violations.push("decision_id_drift");
  if (a.readiness_state !== b.readiness_state) violations.push("readiness_state_drift");
  if (a.verdict_headline !== b.verdict_headline) violations.push("verdict_headline_drift");
  if (Math.abs(a.confidence - b.confidence) > 0.001) violations.push("confidence_drift");
  if (a.evidence_ids.join(",") !== b.evidence_ids.join(",")) violations.push("evidence_chain_drift");
  return { ok: violations.length === 0, violations };
}

/** Erkennt freihängende oder widersprüchliche Verweise. */
export function detectContradictions(record: ExaminerDecisionRecord, chain: EvidenceChain): DriftReport {
  const violations: string[] = [];
  if (record.evidence_ids.length === 0) violations.push("decision_without_evidence");
  for (const id of record.evidence_ids) {
    if (!chain.evidence.find((e) => e.id === id)) violations.push(`orphan_evidence:${id}`);
  }
  if (record.readiness_state === "ready_for_exam" && record.blocking_risks.length > 0) {
    violations.push("ready_state_with_blocking_risks");
  }
  if (record.readiness >= 80 && record.verdict_tone === "critical") {
    violations.push("high_readiness_critical_tone_contradiction");
  }
  return { ok: violations.length === 0, violations };
}

/** In-Memory Decision-Timeline für Admin-Audit-UI. */
export class ExaminerDecisionTimeline {
  private records: ExaminerDecisionRecord[] = [];
  private cap: number;

  constructor(cap = 100) {
    this.cap = cap;
  }

  append(record: ExaminerDecisionRecord): void {
    // Idempotent: identische Decision in Folge wird nicht doppelt geloggt.
    const last = this.records[this.records.length - 1];
    if (last?.id === record.id) return;
    this.records.push(record);
    if (this.records.length > this.cap) this.records.shift();
  }

  all(): ExaminerDecisionRecord[] {
    return [...this.records];
  }

  last(): ExaminerDecisionRecord | null {
    return this.records[this.records.length - 1] ?? null;
  }

  clear(): void {
    this.records = [];
  }
}
