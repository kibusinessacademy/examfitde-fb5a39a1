/**
 * Phase 8.7 + 8.9 — Frozen Examiner Contracts.
 *
 * Eingefrorene Schemas für Verdict, Confidence, Evidence, Timeline.
 * Diese Werte sind die Produktionsfreigabe-Wahrheit und dürfen nur über
 * eine Major-Version geändert werden.
 */
export const EXAMINER_CONTRACT_VERSION = "1.0.0" as const;

export const VERDICT_SCHEMA = ["ready_for_exam", "approaching_readiness", "needs_work", "not_ready"] as const;
export type VerdictValue = (typeof VERDICT_SCHEMA)[number];

export const CONFIDENCE_SCHEMA = {
  min: 0,
  max: 1,
  precision: 2,
} as const;

export const EVIDENCE_SEVERITY = ["info", "warning", "critical"] as const;
export type EvidenceSeverity = (typeof EVIDENCE_SEVERITY)[number];

export const TIMELINE_EVENT_KINDS = [
  "input",
  "evidence",
  "deliberation",
  "verdict",
  "confidence",
  "risk",
  "threshold",
] as const;
export type TimelineEventKind = (typeof TIMELINE_EVENT_KINDS)[number];

export const FROZEN_CONTRACTS = Object.freeze({
  version: EXAMINER_CONTRACT_VERSION,
  verdict: VERDICT_SCHEMA,
  confidence: CONFIDENCE_SCHEMA,
  evidenceSeverity: EVIDENCE_SEVERITY,
  timeline: TIMELINE_EVENT_KINDS,
});
