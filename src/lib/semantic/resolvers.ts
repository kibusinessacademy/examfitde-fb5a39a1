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
import type { Fehlerbild, Kompetenz, OralPattern, Pruefung, Risiko, SemanticEntity } from "./types";

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
