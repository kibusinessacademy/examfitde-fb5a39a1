/**
 * Phase P1 — Pillar Relation Resolvers.
 *
 * Pure, deterministic relation queries over the Knowledge Graph.
 * Used by Pillar pages, SRO grounding, FAQ generation, and the
 * SEO authority cluster builder.
 *
 * HARD RULE: These resolvers MUST NOT touch examiner readiness,
 * confidence, or verdict logic. They surface graph structure only.
 */

import type { KnowledgeGraph } from "./KnowledgeGraph";
import type {
  Faq,
  Fehlerbild,
  Karrierepfad,
  Kompetenz,
  Lernpfad,
  OralExamTopic,
  OralPattern,
  Pruefung,
  Risiko,
  SemanticEntity,
  TutorTopic,
} from "./types";

/** Stable identity helper — sort by (kind, key, id). */
function sortStable<T extends SemanticEntity>(items: ReadonlyArray<T>): ReadonlyArray<T> {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    if (a.key !== b.key) return a.key.localeCompare(b.key);
    return a.id.localeCompare(b.id);
  });
}

/**
 * Competencies related to the given entity (lernfeld, beruf, kompetenz,
 * or pruefung). Deterministic, deduplicated.
 */
export function relatedCompetencies(graph: KnowledgeGraph, entityId: string): ReadonlyArray<Kompetenz> {
  const root = graph.getEntity(entityId);
  if (!root) return [];

  const collected = new Map<string, Kompetenz>();

  const visit = (id: string): void => {
    for (const edge of graph.outgoingEdges(id)) {
      const target = graph.getEntity(edge.to);
      if (!target) continue;
      if (target.kind === "kompetenz" && !collected.has(target.id)) {
        collected.set(target.id, target);
      }
    }
  };

  visit(root.id);

  // Also pull "related_competency" edges from sibling competencies.
  if (root.kind === "kompetenz") {
    for (const edge of graph.outgoingEdges(root.id, "related_competency")) {
      const target = graph.getEntity(edge.to);
      if (target?.kind === "kompetenz" && !collected.has(target.id)) {
        collected.set(target.id, target);
      }
    }
  }

  return sortStable([...collected.values()]);
}

export function relatedRisks(graph: KnowledgeGraph, entityId: string): ReadonlyArray<Risiko> {
  const root = graph.getEntity(entityId);
  if (!root) return [];

  const out = new Map<string, Risiko>();

  // Direct risks on a competency.
  if (root.kind === "kompetenz") {
    for (const edge of graph.outgoingEdges(root.id, "kompetenz_has_risiko")) {
      const target = graph.getEntity(edge.to);
      if (target?.kind === "risiko") out.set(target.id, target);
    }
  }

  // Risks indirectly via related competencies.
  for (const comp of relatedCompetencies(graph, entityId)) {
    for (const edge of graph.outgoingEdges(comp.id, "kompetenz_has_risiko")) {
      const target = graph.getEntity(edge.to);
      if (target?.kind === "risiko" && !out.has(target.id)) out.set(target.id, target);
    }
  }

  return sortStable([...out.values()]);
}

export function relatedMistakes(graph: KnowledgeGraph, entityId: string): ReadonlyArray<Fehlerbild> {
  const root = graph.getEntity(entityId);
  if (!root) return [];

  const out = new Map<string, Fehlerbild>();

  const collectFor = (compId: string) => {
    for (const edge of graph.outgoingEdges(compId, "kompetenz_has_fehlerbild")) {
      const target = graph.getEntity(edge.to);
      if (target?.kind === "fehlerbild") out.set(target.id, target);
    }
    for (const edge of graph.outgoingEdges(compId, "related_mistake")) {
      const target = graph.getEntity(edge.to);
      if (target?.kind === "fehlerbild") out.set(target.id, target);
    }
  };

  if (root.kind === "kompetenz") collectFor(root.id);
  for (const comp of relatedCompetencies(graph, entityId)) collectFor(comp.id);

  return sortStable([...out.values()]);
}

export function relatedOralPatterns(graph: KnowledgeGraph, entityId: string): ReadonlyArray<OralPattern> {
  const root = graph.getEntity(entityId);
  if (!root) return [];

  const out = new Map<string, OralPattern>();

  if (root.kind === "kompetenz") {
    for (const edge of graph.outgoingEdges(root.id, "kompetenz_has_oral_pattern")) {
      const target = graph.getEntity(edge.to);
      if (target?.kind === "oral_pattern") out.set(target.id, target);
    }
  }

  for (const comp of relatedCompetencies(graph, entityId)) {
    for (const edge of graph.outgoingEdges(comp.id, "kompetenz_has_oral_pattern")) {
      const target = graph.getEntity(edge.to);
      if (target?.kind === "oral_pattern" && !out.has(target.id)) out.set(target.id, target);
    }
  }

  return sortStable([...out.values()]);
}

/**
 * Exam scenarios for an entity = the Pruefungen reachable from this
 * entity's Beruf, optionally narrowed by form.
 */
export function relatedExamScenarios(
  graph: KnowledgeGraph,
  entityId: string,
  opts?: { form?: Pruefung["form"] }
): ReadonlyArray<Pruefung> {
  const root = graph.getEntity(entityId);
  if (!root) return [];

  // Find the anchoring Beruf id (may be the entity itself).
  let berufId: string | undefined;
  if (root.kind === "beruf") berufId = root.id;
  else if ("beruf_id" in root && typeof (root as { beruf_id?: string }).beruf_id === "string") {
    berufId = (root as { beruf_id?: string }).beruf_id;
  }
  if (!berufId) return [];

  const out: Pruefung[] = [];
  for (const edge of graph.outgoingEdges(berufId, "beruf_has_pruefung")) {
    const target = graph.getEntity(edge.to);
    if (target?.kind === "pruefung" && (!opts?.form || target.form === opts.form)) {
      out.push(target);
    }
  }

  return sortStable(out);
}

/* ---- W1 Cut 1 — Semantic Gravity resolvers ---- */

/** Lernpfade for an entity (kompetenz or beruf). Deterministic, deduped. */
export function relatedLernpfade(graph: KnowledgeGraph, entityId: string): ReadonlyArray<Lernpfad> {
  const root = graph.getEntity(entityId);
  if (!root) return [];
  const out = new Map<string, Lernpfad>();

  const collect = (id: string) => {
    for (const edge of graph.outgoingEdges(id, "kompetenz_has_lernpfad")) {
      const t = graph.getEntity(edge.to);
      if (t?.kind === "lernpfad" && !out.has(t.id)) out.set(t.id, t);
    }
  };

  if (root.kind === "kompetenz") collect(root.id);
  for (const comp of relatedCompetencies(graph, entityId)) collect(comp.id);

  return sortStable([...out.values()]);
}

/** Karrierepfade outgoing from a beruf. */
export function relatedKarrierepfade(graph: KnowledgeGraph, berufId: string): ReadonlyArray<Karrierepfad> {
  const root = graph.getEntity(berufId);
  if (!root || root.kind !== "beruf") return [];
  const out: Karrierepfad[] = [];
  for (const edge of graph.outgoingEdges(root.id, "beruf_has_karrierepfad")) {
    const t = graph.getEntity(edge.to);
    if (t?.kind === "karrierepfad") out.push(t);
  }
  return sortStable(out);
}

/** Tutor topics for a kompetenz (or via related competencies). */
export function relatedTutorTopics(graph: KnowledgeGraph, entityId: string): ReadonlyArray<TutorTopic> {
  const root = graph.getEntity(entityId);
  if (!root) return [];
  const out = new Map<string, TutorTopic>();

  const collect = (id: string) => {
    for (const edge of graph.outgoingEdges(id, "kompetenz_has_tutor_topic")) {
      const t = graph.getEntity(edge.to);
      if (t?.kind === "tutor_topic" && !out.has(t.id)) out.set(t.id, t);
    }
  };

  if (root.kind === "kompetenz") collect(root.id);
  for (const comp of relatedCompetencies(graph, entityId)) collect(comp.id);

  return sortStable([...out.values()]);
}

/** Oral exam topics directly attached to a pruefung. */
export function relatedOralExamTopics(graph: KnowledgeGraph, pruefungId: string): ReadonlyArray<OralExamTopic> {
  const root = graph.getEntity(pruefungId);
  if (!root || root.kind !== "pruefung") return [];
  const out: OralExamTopic[] = [];
  for (const edge of graph.outgoingEdges(root.id, "pruefung_has_oral_exam_topic")) {
    const t = graph.getEntity(edge.to);
    if (t?.kind === "oral_exam_topic") out.push(t);
  }
  return sortStable(out);
}

/** Polymorphic FAQs attached to any entity via entity_has_faq. */
export function relatedFaqs(graph: KnowledgeGraph, entityId: string): ReadonlyArray<Faq> {
  const root = graph.getEntity(entityId);
  if (!root) return [];
  const out: Faq[] = [];
  for (const edge of graph.outgoingEdges(root.id, "entity_has_faq")) {
    const t = graph.getEntity(edge.to);
    if (t?.kind === "faq") out.push(t);
  }
  return sortStable(out);
}
