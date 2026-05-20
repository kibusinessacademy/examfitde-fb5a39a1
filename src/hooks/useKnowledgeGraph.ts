/**
 * Phase P5 — Knowledge Graph hook (DB-fed published snapshot).
 *
 * Loads the currently published graph via the public RPC
 * `semantic_graph_get_published()`. The result is cached in module
 * scope (single fetch per session). Pillar/Satellite pages already
 * tolerate the empty-graph case during the first paint.
 *
 * SSR-safe: no synchronous DB calls — if the snapshot is not yet
 * loaded, callers receive the empty graph and re-render once the
 * fetch resolves.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildKnowledgeGraph,
  type KnowledgeGraph,
  type KnowledgeGraphSnapshot,
  type SemanticEntity,
  type SemanticEdge,
} from "@/lib/semantic";

const EMPTY_SNAPSHOT: KnowledgeGraphSnapshot = Object.freeze({
  entities: [],
  edges: [],
  snapshot_at: "1970-01-01T00:00:00.000Z",
});

let cachedSnapshot: KnowledgeGraphSnapshot | null = null;
let cachedGraph: KnowledgeGraph | null = null;
let inflight: Promise<KnowledgeGraphSnapshot> | null = null;
const listeners = new Set<() => void>();

interface RpcPayload {
  snapshot_id: string | null;
  snapshot_at: string;
  source_hash: string;
  entity_count: number;
  edge_count: number;
  entities: Array<{ id: string; kind: SemanticEntity["kind"]; key: string; name: string; description?: string | null; meta?: Record<string, unknown> | null }>;
  edges: Array<{ from: string; to: string; kind: SemanticEdge["kind"]; weight?: number | null }>;
}

function toSnapshot(p: RpcPayload): KnowledgeGraphSnapshot {
  const entities = (p.entities ?? []).map((e) => ({
    id: e.id,
    kind: e.kind,
    key: e.key,
    name: e.name,
    description: e.description ?? undefined,
    meta: (e.meta as Record<string, string | number | boolean | null> | null) ?? undefined,
  })) as SemanticEntity[];
  const edges = (p.edges ?? []).map((x) => ({
    from: x.from,
    to: x.to,
    kind: x.kind,
    weight: x.weight ?? undefined,
  })) as SemanticEdge[];
  return Object.freeze({ entities, edges, snapshot_at: p.snapshot_at });
}

async function loadPublished(): Promise<KnowledgeGraphSnapshot> {
  if (cachedSnapshot) return cachedSnapshot;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.rpc("semantic_graph_get_published");
      if (error || !data) {
        cachedSnapshot = EMPTY_SNAPSHOT;
      } else {
        cachedSnapshot = toSnapshot(data as unknown as RpcPayload);
      }
    } catch {
      cachedSnapshot = EMPTY_SNAPSHOT;
    }
    cachedGraph = buildKnowledgeGraph(cachedSnapshot);
    inflight = null;
    listeners.forEach((l) => l());
    return cachedSnapshot;
  })();
  return inflight;
}

export function useKnowledgeGraph(): KnowledgeGraph {
  const [, force] = useState(0);
  useEffect(() => {
    if (cachedGraph) return;
    const tick = () => force((n) => n + 1);
    listeners.add(tick);
    void loadPublished();
    return () => {
      listeners.delete(tick);
    };
  }, []);
  if (cachedGraph) return cachedGraph;
  return buildKnowledgeGraph(EMPTY_SNAPSHOT);
}

/** Resolve an entity by (kind, key) — null if absent (404-able). */
export function useEntityByKey(
  graph: KnowledgeGraph,
  kind: SemanticEntity["kind"],
  key: string | undefined,
): SemanticEntity | null {
  if (!key) return null;
  const decoded = decodeURIComponent(key);
  for (const e of graph.entitiesOfKind(kind)) {
    if (e.key === decoded) return e;
  }
  return null;
}

/** Test/build hook: fetch published snapshot directly (no React). */
export async function fetchPublishedGraphSnapshot(): Promise<KnowledgeGraphSnapshot> {
  return loadPublished();
}
