/**
 * Phase P2 — Examiner Handover → AI-readable, citable chunks.
 *
 * STRICT CONTRACT:
 *  - All values are READ verbatim from the frozen Examiner Handover.
 *  - This module never derives, recomputes, or interprets readiness,
 *    confidence, severity or verdicts.
 *  - All claims carry citations of kind `examiner_handover` /
 *    `examiner_evidence` against contract version "1.0.0".
 */

import { EXAMINER_CONTRACT_VERSION } from "@/lib/examiner/ExaminerContracts";

import { chunkHash } from "./hash";
import type { Citation, GroundedChunk } from "./types";

/** Minimal shape mirroring the frozen Handover Contract for serialization. */
export interface ExaminerHandoverLike {
  /** Anchor id this readiness snapshot belongs to (beruf / pruefung / kompetenz). */
  anchor_entity_id: string;
  anchor_entity_kind: "beruf" | "pruefung" | "kompetenz";
  readiness_state: string;
  readiness_confidence: number;
  trend_signal: "improving" | "stable" | "regressing";
  exam_consistency: number;
  critical_competencies: ReadonlyArray<string>;
  top_risks: ReadonlyArray<{ id: string; label: string; severity: string }>;
}

const cite = (
  source_id: string,
  source_kind: Citation["source_kind"],
  anchor?: string,
): Citation => ({
  source_id,
  source_kind,
  anchor,
  contract_version: EXAMINER_CONTRACT_VERSION,
});

const trimBody = (s: string): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= 1200 ? t : t.slice(0, 1199).trimEnd() + "…";
};

/** One readiness-snapshot chunk + one risk-profile chunk (if present). */
export function serialiseExaminerHandover(
  handover: ExaminerHandoverLike,
  snapshot_at: string,
): ReadonlyArray<GroundedChunk> {
  const out: GroundedChunk[] = [];

  // Sober, examiner-grade language. No motivation, no promise.
  const consistencyPct = Math.round(handover.exam_consistency * 100);
  const confidencePct = Math.round(handover.readiness_confidence * 100);

  const bodySnapshot = trimBody(
    `Prüfungsreife: ${handover.readiness_state}. ` +
      `Examiner-Konfidenz: ${confidencePct}%. ` +
      `Verlauf: ${handover.trend_signal}. ` +
      `Konsistenz über Sitzungen: ${consistencyPct}%. ` +
      (handover.critical_competencies.length > 0
        ? `Kritische Kompetenzen: ${handover.critical_competencies.join("; ")}.`
        : "Keine kritischen Kompetenzen registriert."),
  );

  out.push({
    chunk_id: chunkHash([
      "readiness_snapshot",
      handover.anchor_entity_id,
      bodySnapshot.toLowerCase(),
    ]),
    role: "readiness_snapshot",
    anchor_entity_id: handover.anchor_entity_id,
    anchor_entity_kind: handover.anchor_entity_kind,
    headline: `Examiner-Befund: ${handover.readiness_state}`.slice(0, 120),
    body: bodySnapshot,
    citations: [cite(handover.anchor_entity_id, "examiner_handover", "readiness_state")],
    snapshot_at,
  });

  if (handover.top_risks.length > 0) {
    const bodyRisks = trimBody(
      `Examiner-Risiken (verbatim): ` +
        handover.top_risks
          .map((r) => `${r.label} [${r.severity}]`)
          .join("; ") +
        ".",
    );
    out.push({
      chunk_id: chunkHash(["risk_profile", handover.anchor_entity_id, bodyRisks.toLowerCase()]),
      role: "risk_profile",
      anchor_entity_id: handover.anchor_entity_id,
      anchor_entity_kind: handover.anchor_entity_kind,
      headline: `Examiner-Risiken (${handover.top_risks.length})`.slice(0, 120),
      body: bodyRisks,
      citations: [
        cite(handover.anchor_entity_id, "examiner_handover", "top_risks"),
        ...handover.top_risks
          .slice(0, 5)
          .map((r) => cite(r.id, "examiner_evidence", r.severity)),
      ],
      snapshot_at,
    });
  }

  return out;
}
