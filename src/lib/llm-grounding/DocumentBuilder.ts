/**
 * Phase P2 — GroundedDocument builder.
 *
 * Composes serialiser output (graph chunks) + optional Examiner
 * Handover chunks + FAQ chunks into a single, deterministic document
 * suitable for embedding / retrieval indexing.
 */

import type { KnowledgeGraph } from "@/lib/semantic/KnowledgeGraph";
import type { SemanticEntity } from "@/lib/semantic/types";

import {
  serialiseExaminerHandover,
  type ExaminerHandoverLike,
} from "./ExaminerEvidenceSerializer";
import { generateFaqs } from "./FaqGenerator";
import { documentHash } from "./hash";
import { serialiseEntity } from "./serializers";
import type { GroundedChunk, GroundedDocument } from "./types";

export interface BuildDocumentOptions {
  /** Optional verbatim Examiner Handover for this anchor. */
  examiner?: ExaminerHandoverLike;
  /** Whether to append generated FAQ chunks. Default true. */
  includeFaqs?: boolean;
}

export function buildGroundedDocument(
  graph: KnowledgeGraph,
  entity: SemanticEntity,
  options: BuildDocumentOptions = {},
): GroundedDocument {
  const chunks: GroundedChunk[] = [];

  for (const c of serialiseEntity(graph, entity)) chunks.push(c);

  if (options.examiner) {
    for (const c of serialiseExaminerHandover(options.examiner, graph.snapshot_at)) {
      chunks.push(c);
    }
  }

  if (options.includeFaqs !== false) {
    for (const f of generateFaqs(graph, entity)) chunks.push(f.answer);
  }

  // Stable ordering: by role, then chunk_id.
  const ordered = [...chunks].sort((a, b) => {
    if (a.role !== b.role) return a.role.localeCompare(b.role);
    return a.chunk_id.localeCompare(b.chunk_id);
  });

  // Dedupe by chunk_id (identical content collapses).
  const seen = new Set<string>();
  const deduped = ordered.filter((c) => {
    if (seen.has(c.chunk_id)) return false;
    seen.add(c.chunk_id);
    return true;
  });

  return {
    document_id: documentHash(deduped.map((c) => c.chunk_id)),
    anchor_entity_id: entity.id,
    chunks: deduped,
    snapshot_at: graph.snapshot_at,
  };
}
