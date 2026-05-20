/**
 * Phase P1 — Knowledge Graph SSOT (pure builder + queries).
 *
 * Deterministic, in-memory graph. No database calls here — callers pass
 * already-fetched entities/edges (typically from Supabase views via a
 * dedicated hook). This keeps the SSOT pure, testable, and SSR-safe.
 */

import type {
  EdgeKind,
  EntityKind,
  KnowledgeGraphSnapshot,
  SemanticEdge,
  SemanticEntity,
} from "./types";

export class KnowledgeGraph {
  private readonly byId = new Map<string, SemanticEntity>();
  private readonly outgoing = new Map<string, SemanticEdge[]>();
  private readonly incoming = new Map<string, SemanticEdge[]>();
  public readonly snapshot_at: string;

  constructor(snapshot: KnowledgeGraphSnapshot) {
    this.snapshot_at = snapshot.snapshot_at;

    // Deterministic insertion order: sort entities by id.
    const sortedEntities = [...snapshot.entities].sort((a, b) => a.id.localeCompare(b.id));
    for (const e of sortedEntities) {
      if (this.byId.has(e.id)) continue;
      this.byId.set(e.id, e);
    }

    // Deterministic edge order: sort by (kind, from, to).
    const sortedEdges = [...snapshot.edges].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      if (a.from !== b.from) return a.from.localeCompare(b.from);
      return a.to.localeCompare(b.to);
    });

    const seen = new Set<string>();
    for (const edge of sortedEdges) {
      const key = `${edge.kind}|${edge.from}|${edge.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.pushEdge(this.outgoing, edge.from, edge);
      this.pushEdge(this.incoming, edge.to, edge);
    }
  }

  private pushEdge(map: Map<string, SemanticEdge[]>, key: string, edge: SemanticEdge): void {
    const list = map.get(key);
    if (list) list.push(edge);
    else map.set(key, [edge]);
  }

  /* ----- queries ----- */

  getEntity(id: string): SemanticEntity | undefined {
    return this.byId.get(id);
  }

  entitiesOfKind<K extends EntityKind>(kind: K): ReadonlyArray<Extract<SemanticEntity, { kind: K }>> {
    const out: Extract<SemanticEntity, { kind: K }>[] = [];
    for (const entity of this.byId.values()) {
      if (entity.kind === kind) out.push(entity as Extract<SemanticEntity, { kind: K }>);
    }
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }

  outgoingEdges(from: string, kind?: EdgeKind): ReadonlyArray<SemanticEdge> {
    const list = this.outgoing.get(from) ?? [];
    return kind ? list.filter((e) => e.kind === kind) : list;
  }

  incomingEdges(to: string, kind?: EdgeKind): ReadonlyArray<SemanticEdge> {
    const list = this.incoming.get(to) ?? [];
    return kind ? list.filter((e) => e.kind === kind) : list;
  }

  /** Resolve a list of edge targets to their entities, preserving edge order. */
  resolveTargets(edges: ReadonlyArray<SemanticEdge>): ReadonlyArray<SemanticEntity> {
    const out: SemanticEntity[] = [];
    for (const edge of edges) {
      const target = this.byId.get(edge.to);
      if (target) out.push(target);
    }
    return out;
  }

  /** Stats for observatory (Phase P6). */
  stats(): { entities: number; edges: number; by_kind: Record<EntityKind, number> } {
    const byKind = {
      beruf: 0,
      pruefung: 0,
      lernfeld: 0,
      kompetenz: 0,
      risiko: 0,
      fehlerbild: 0,
      pruefungsform: 0,
      pruefungsstrategie: 0,
      oral_pattern: 0,
      industry_context: 0,
    } as Record<EntityKind, number>;

    let edgeCount = 0;
    for (const entity of this.byId.values()) byKind[entity.kind] += 1;
    for (const list of this.outgoing.values()) edgeCount += list.length;

    return { entities: this.byId.size, edges: edgeCount, by_kind: byKind };
  }
}

/** Convenience builder. */
export function buildKnowledgeGraph(snapshot: KnowledgeGraphSnapshot): KnowledgeGraph {
  return new KnowledgeGraph(snapshot);
}
