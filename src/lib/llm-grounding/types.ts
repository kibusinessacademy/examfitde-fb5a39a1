/**
 * Phase P2 — LLM-Grounding Layer (types).
 *
 * Retrieval-first, hallucination-resistant chunk + citation primitives.
 *
 * Design contract:
 *  - Every chunk is content-addressed (`chunk_id` = stable hash).
 *  - Every claim carries ≥1 citation pointing to a graph entity or an
 *    Examiner Handover fact (frozen contract v1.0.0).
 *  - No generative copy. No motivational phrasing. No marketing fluff.
 *  - The semantic layer NEVER recomputes readiness, confidence or
 *    verdicts — those values come verbatim from `@/lib/examiner`.
 *
 * Cross-cut with `scripts/guards/semantic-no-examiner-bypass.mjs`.
 */

import type { EntityKind } from "@/lib/semantic/types";

/** Provenance kind for a citation. */
export type CitationSourceKind =
  | "graph_entity"
  | "graph_edge"
  | "examiner_handover"
  | "examiner_evidence"
  | "curriculum_doc";

export interface Citation {
  /** Stable id of the cited source. */
  source_id: string;
  source_kind: CitationSourceKind;
  /** Optional secondary anchor inside the source (e.g. evidence id). */
  anchor?: string;
  /** Frozen contract version the citation was emitted against. */
  contract_version: "1.0.0";
}

/** Allowed semantic role of a chunk inside a retrieval pipeline. */
export type ChunkRole =
  | "definition"          // canonical "Was ist X?" answer
  | "scope"               // boundaries / lernfelder / kompetenzen
  | "exam_form"           // exam form + structure
  | "risk_profile"        // typische Fehler / Risiken
  | "readiness_snapshot"  // examiner-derived readiness (verbatim)
  | "faq_pair"            // one question/answer pair
  | "related_links";      // outbound semantic links

export interface GroundedChunk {
  /** Deterministic hash over (role, anchor_entity_id, normalized_body). */
  chunk_id: string;
  role: ChunkRole;
  /** Primary anchor entity in the knowledge graph. */
  anchor_entity_id: string;
  anchor_entity_kind: EntityKind | "examiner_handover";
  /** Short headline (≤ 120 chars). Plain, sober, present tense. */
  headline: string;
  /** Plain-text body. Hard cap 1200 chars to stay retrieval-friendly. */
  body: string;
  /** ≥ 1 citation required. Empty array is a contract violation. */
  citations: ReadonlyArray<Citation>;
  /** ISO-8601 snapshot the chunk was built from. */
  snapshot_at: string;
}

export interface GroundedFaqItem {
  /** Deterministic hash over question. */
  faq_id: string;
  question: string;
  answer: GroundedChunk;
}

export interface GroundedDocument {
  /** Deterministic hash over chunk_ids in order. */
  document_id: string;
  /** Anchor entity (Beruf, Pruefung, Kompetenz, …). */
  anchor_entity_id: string;
  chunks: ReadonlyArray<GroundedChunk>;
  snapshot_at: string;
}

/** Hard limits used across the grounding layer. */
export const GROUNDING_LIMITS = Object.freeze({
  HEADLINE_MAX: 120,
  BODY_MAX: 1200,
  FAQ_QUESTION_MAX: 160,
  CITATIONS_MIN: 1,
  CITATIONS_MAX: 6,
});

export interface GroundingContractReport {
  ok: boolean;
  violations: ReadonlyArray<string>;
}
