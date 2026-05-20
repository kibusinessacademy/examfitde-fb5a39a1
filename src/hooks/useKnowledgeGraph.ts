/**
 * Phase P4 — Knowledge Graph hook (SSOT data access).
 *
 * Returns a singleton KnowledgeGraph instance for the current snapshot.
 *
 * NOTE: In P4 we ship an empty graph by default. The DB-fed materializer
 * lands in P5 (semantic_graph_snapshot + materializer edge function).
 * Pillar/Satellite pages already handle the empty case gracefully
 * (404-style "noch nicht verfügbar"), so the routing/serialization
 * surface is fully testable today.
 */

import { useMemo } from "react";
import {
  buildKnowledgeGraph,
  type KnowledgeGraph,
  type KnowledgeGraphSnapshot,
  type SemanticEntity,
} from "@/lib/semantic";

const EMPTY_SNAPSHOT: KnowledgeGraphSnapshot = Object.freeze({
  entities: [],
  edges: [],
  snapshot_at: "1970-01-01T00:00:00.000Z",
});

let _cached: { snap: KnowledgeGraphSnapshot; graph: KnowledgeGraph } | null = null;

export function useKnowledgeGraph(): KnowledgeGraph {
  return useMemo(() => {
    if (!_cached || _cached.snap !== EMPTY_SNAPSHOT) {
      _cached = { snap: EMPTY_SNAPSHOT, graph: buildKnowledgeGraph(EMPTY_SNAPSHOT) };
    }
    return _cached.graph;
  }, []);
}

/** Resolve an entity by (kind, key) — null if absent (404-able). */
export function useEntityByKey(
  graph: KnowledgeGraph,
  kind: SemanticEntity["kind"],
  key: string | undefined,
): SemanticEntity | null {
  return useMemo(() => {
    if (!key) return null;
    const decoded = decodeURIComponent(key);
    for (const e of graph.entitiesOfKind(kind)) {
      if (e.key === decoded) return e;
    }
    return null;
  }, [graph, kind, key]);
}
