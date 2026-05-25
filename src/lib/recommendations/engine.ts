/**
 * W1 Cut 3b — Semantic Recommendation Layer (SSOT, deterministic, governed).
 *
 * GOVERNANCE
 * ----------
 * Recommendations MUST be:
 *   - prüfungsbezogen   (linked to a Pruefung or exam-relevant Kompetenz)
 *   - lernwirksam       (addresses a weakness, gap, or oral pattern)
 *   - kompetenzlogisch  (derived from KnowledgeGraph edges only)
 *   - erklärbar         (every Recommendation carries a `reason` + scores)
 *   - deterministic     (same inputs ⇒ same ordering, no random)
 *   - SSOT-basiert      (KnowledgeGraph + Examiner Handover read-only)
 *
 * Recommendations MUST NEVER be:
 *   - engagement-optimised
 *   - addiction-oriented
 *   - blackbox / AI-generated text
 *   - "andere Nutzer haben gekauft"
 *   - based on free-text user input
 *
 * NOTE: This module never recomputes readiness, mastery, or verdicts.
 *       It consumes them via the frozen Examiner Handover Contract only.
 */

import type {
  KnowledgeGraphSnapshot,
  SemanticEntity,
  SemanticEdge,
  Kompetenz,
} from "@/lib/semantic/types";
import {
  classifyWeaknessClusters,
  type WeaknessClusterTag,
} from "./weakness-clusters";

export type ExamRelevance = "low" | "medium" | "high";
export type WeaknessRelation = "direct" | "adjacent" | "preventive";

export interface RecommendationEvidence {
  /** Machine-readable reason key (audit). */
  recommendation_reason: string;
  /** 0..1 — derived from edge weight + competency overlap. */
  semantic_similarity_score: number;
  /** Count of shared competencies / lernfelder. */
  competency_overlap: number;
  /** Examiner-aware exam-form proximity. */
  exam_relevance: ExamRelevance;
  /** How the recommendation relates to the user's weakness set. */
  weakness_relation: WeaknessRelation;
  /** Optional weakness cluster tags this recommendation addresses. */
  weakness_clusters: ReadonlyArray<WeaknessClusterTag>;
}

export interface Recommendation {
  /** Stable id: `${kind}:${slug}`. */
  id: string;
  kind: SemanticEntity["kind"];
  slug: string;
  title: string;
  description?: string;
  /** Optional internal route the UI can link to. */
  href?: string;
  evidence: RecommendationEvidence;
}

export interface RecommendForWeaknessInput {
  /** Kompetenz ids the learner is currently weak in. */
  weak_kompetenz_ids: ReadonlyArray<string>;
  /** Optional examination form to bias relevance. */
  exam_form?: "schriftlich" | "muendlich" | "praktisch" | "fachgespraech";
  /** Optional days until exam — biases preventive vs direct. */
  days_to_exam?: number | null;
  /** Hard cap (default 5). */
  limit?: number;
}

function compositeScore(e: RecommendationEvidence): number {
  // Deterministic, monotonic. Used for sort only — never displayed.
  const rel = e.exam_relevance === "high" ? 1 : e.exam_relevance === "medium" ? 0.6 : 0.3;
  const wr = e.weakness_relation === "direct" ? 1 : e.weakness_relation === "adjacent" ? 0.7 : 0.4;
  return e.semantic_similarity_score * 0.45 + rel * 0.3 + wr * 0.2 + Math.min(1, e.competency_overlap / 5) * 0.05;
}

function buildHref(kind: SemanticEntity["kind"], slug: string): string | undefined {
  switch (kind) {
    case "kompetenz": return `/wissen/kompetenz/${slug}`;
    case "pruefung": return `/wissen/pruefung/${slug}`;
    case "beruf": return `/wissen/beruf/${slug}`;
    case "oral_exam_topic":
    case "oral_pattern": return `/app/muendlich/${slug}`;
    case "lernpfad": return `/app/lernpfad/${slug}`;
    default: return undefined;
  }
}

/**
 * Build deterministic recommendations from weak competencies.
 *
 * Strategy (no random, no AI):
 *   1. Look up each weak Kompetenz in the graph.
 *   2. Collect adjacent entities via curated EdgeKinds (kompetenz_has_fehlerbild,
 *      kompetenz_has_risiko, kompetenz_has_oral_pattern, kompetenz_has_tutor_topic,
 *      kompetenz_has_lernpfad, related_competency, related_mistake).
 *   3. Score each candidate (semantic_similarity from edge weight + overlap with
 *      other weak competencies; exam_relevance from exam_form match; weakness_relation
 *      from edge kind).
 *   4. Sort by (-compositeScore, kind, slug) — deterministic tiebreak.
 *   5. Slice to `limit` (default 5).
 */
export function recommendForWeaknesses(
  graph: KnowledgeGraphSnapshot,
  input: RecommendForWeaknessInput,
): ReadonlyArray<Recommendation> {
  const limit = Math.max(1, Math.min(20, input.limit ?? 5));
  const weakSet = new Set(input.weak_kompetenz_ids);
  if (weakSet.size === 0) return [];

  const byId = new Map(graph.entities.map((e) => [e.id, e] as const));
  const candidates = new Map<string, { entity: SemanticEntity; overlap: number; bestWeight: number; bestKind: SemanticEdge["kind"] }>();

  const RELEVANT_OUT_EDGES: ReadonlySet<SemanticEdge["kind"]> = new Set([
    "kompetenz_has_fehlerbild",
    "kompetenz_has_risiko",
    "kompetenz_has_oral_pattern",
    "kompetenz_has_tutor_topic",
    "kompetenz_has_lernpfad",
    "related_competency",
    "related_mistake",
  ]);

  for (const edge of graph.edges) {
    const sourceIsWeak = weakSet.has(edge.from);
    if (!sourceIsWeak) continue;
    if (!RELEVANT_OUT_EDGES.has(edge.kind)) continue;
    const target = byId.get(edge.to);
    if (!target) continue;
    // Never recommend the weak competency itself.
    if (weakSet.has(target.id)) continue;
    const prev = candidates.get(target.id);
    const w = edge.weight ?? 0.5;
    if (prev) {
      prev.overlap += 1;
      if (w > prev.bestWeight) {
        prev.bestWeight = w;
        prev.bestKind = edge.kind;
      }
    } else {
      candidates.set(target.id, { entity: target, overlap: 1, bestWeight: w, bestKind: edge.kind });
    }
  }

  const formMatches = (e: SemanticEntity): boolean => {
    if (!input.exam_form) return false;
    if (e.kind === "oral_pattern" || e.kind === "oral_exam_topic") {
      return input.exam_form === "muendlich" || input.exam_form === "fachgespraech";
    }
    if (e.kind === "pruefung") return (e as { form?: string }).form === input.exam_form;
    return false;
  };

  const recs: Recommendation[] = [];
  for (const [, c] of candidates) {
    const e = c.entity;
    const exam_relevance: ExamRelevance =
      formMatches(e) ? "high"
        : (c.overlap >= 2 ? "medium" : "low");
    const weakness_relation: WeaknessRelation =
      c.bestKind === "kompetenz_has_risiko" || c.bestKind === "kompetenz_has_fehlerbild"
        ? "direct"
        : c.bestKind === "related_competency" || c.bestKind === "related_mistake"
          ? "adjacent"
          : "preventive";
    const clusters = e.kind === "kompetenz" ? classifyWeaknessClusters(e as Kompetenz) : [];
    const evidence: RecommendationEvidence = {
      recommendation_reason: `${c.bestKind}/${weakness_relation}`,
      semantic_similarity_score: Math.max(0, Math.min(1, c.bestWeight)),
      competency_overlap: c.overlap,
      exam_relevance,
      weakness_relation,
      weakness_clusters: clusters,
    };
    recs.push({
      id: `${e.kind}:${e.key ?? e.id}`,
      kind: e.kind,
      slug: e.key ?? e.id,
      title: e.name,
      description: e.description,
      href: buildHref(e.kind, e.key ?? e.id),
      evidence,
    });
  }

  recs.sort((a, b) => {
    const sa = compositeScore(a.evidence);
    const sb = compositeScore(b.evidence);
    if (sb !== sa) return sb - sa;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.slug < b.slug ? -1 : 1;
  });

  // Days-to-exam bias: when imminent, drop "preventive" recs to free slots.
  const filtered =
    input.days_to_exam != null && input.days_to_exam <= 14
      ? recs.filter((r) => r.evidence.weakness_relation !== "preventive")
      : recs;

  return filtered.slice(0, limit);
}

export const __scoring = { compositeScore };
