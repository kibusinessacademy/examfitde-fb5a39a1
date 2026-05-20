/**
 * Phase P2 — Grounding Contract assertions.
 *
 * Pure validators. Used by tests + CI. Never throws — returns a report so
 * surfaces can surface partial documents without crashing SSR.
 */

import {
  GROUNDING_LIMITS,
  type GroundedChunk,
  type GroundedDocument,
  type GroundedFaqItem,
  type GroundingContractReport,
} from "./types";

export function assertChunkContract(chunk: GroundedChunk): GroundingContractReport {
  const v: string[] = [];
  if (!chunk.chunk_id.startsWith("ch_")) v.push("chunk_id_missing_prefix");
  if (chunk.headline.length === 0) v.push("headline_empty");
  if (chunk.headline.length > GROUNDING_LIMITS.HEADLINE_MAX) v.push("headline_too_long");
  if (chunk.body.length === 0) v.push("body_empty");
  if (chunk.body.length > GROUNDING_LIMITS.BODY_MAX) v.push("body_too_long");
  if (chunk.citations.length < GROUNDING_LIMITS.CITATIONS_MIN) v.push("citations_missing");
  if (chunk.citations.length > GROUNDING_LIMITS.CITATIONS_MAX) v.push("citations_too_many");
  for (const c of chunk.citations) {
    if (c.contract_version !== "1.0.0") v.push("citation_wrong_contract_version");
    if (!c.source_id) v.push("citation_missing_source_id");
  }
  // Hallucination guards: no marketing tone, no promises, no superlatives.
  if (/\b(garantiert|sicher bestehen|100 ?%|beste(?:r|s|n)? )/i.test(chunk.body)) {
    v.push("body_marketing_tone");
  }
  return { ok: v.length === 0, violations: v };
}

export function assertFaqContract(item: GroundedFaqItem): GroundingContractReport {
  const v: string[] = [];
  if (!item.faq_id.startsWith("faq_")) v.push("faq_id_missing_prefix");
  if (!item.question.endsWith("?")) v.push("question_missing_question_mark");
  if (item.question.length > GROUNDING_LIMITS.FAQ_QUESTION_MAX) v.push("question_too_long");
  v.push(...assertChunkContract(item.answer).violations);
  return { ok: v.length === 0, violations: v };
}

export function assertDocumentContract(doc: GroundedDocument): GroundingContractReport {
  const v: string[] = [];
  if (!doc.document_id.startsWith("doc_")) v.push("document_id_missing_prefix");
  if (doc.chunks.length === 0) v.push("document_empty");
  const seen = new Set<string>();
  for (const c of doc.chunks) {
    if (seen.has(c.chunk_id)) v.push("document_duplicate_chunk");
    seen.add(c.chunk_id);
    v.push(...assertChunkContract(c).violations);
  }
  return { ok: v.length === 0, violations: v };
}
