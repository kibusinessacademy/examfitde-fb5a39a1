/**
 * Semantic Runtime Graph — pure derivation aus known-systems.ts (v1.3).
 *
 * Erkennt zentrale Systeme, Cascade-Risiken, Orphans und Coupling aus
 * Metadaten-Beziehungen (neighbors / event_contracts / audit_actions / domain).
 *
 * Reine Funktion. Keine DB-Reads, keine Mutation, kein Supabase-Import.
 * Output ist deterministisch (sortiert nach Name).
 */

import {
  KNOWN_SYSTEMS,
  type KnownSystem,
  type SystemKind,
  type SystemDomain,
  healabilityScore,
} from './known-systems';

export interface GraphNode {
  id: string;
  name: string;
  kind: SystemKind;
  domain?: SystemDomain;
  ownership?: string;
  governance_tier?: 'core' | 'extension' | 'helper';
  degree_in: number;
  degree_out: number;
  degree_total: number;
  is_orphan: boolean;
  healability_score: number;
  has_drift_signal: boolean;
  emits_count: number;
  audit_count: number;
}

export type GraphEdgeType = 'neighbor' | 'event' | 'audit';

export interface GraphEdge {
  from: string;
  to: string;
  type: GraphEdgeType;
}

export interface CascadeRisk {
  node: string;
  downstream_reach: number;
  downstream_sample: string[];
}

export interface GraphMetrics {
  total_nodes: number;
  total_edges: number;
  total_neighbor_edges: number;
  total_event_edges: number;
  total_audit_edges: number;
  domains: Record<string, number>;
  orphans: string[];
  hubs: { node: string; degree: number }[];
  cascade_risks: CascadeRisk[];
  unhealable: { node: string; score: number; missing: string[] }[];
  cross_domain_coupling: { from: string; to: string; from_domain: string; to_domain: string }[];
}

export interface SemanticRuntimeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metrics: GraphMetrics;
}

const HEAL_KEYS = ['replayable', 'recoverable', 'auditable', 'observable', 'drift_detectable'] as const;

function missingHealAspects(sys: KnownSystem): string[] {
  const h = sys.healing_context;
  if (!h) return [...HEAL_KEYS];
  return HEAL_KEYS.filter((k) => !h[k]);
}

/**
 * Rein deterministische Graph-Derivation.
 * Default: Registry KNOWN_SYSTEMS. Optional injizierbar für Tests.
 */
export function deriveSemanticRuntimeGraph(systems: KnownSystem[] = KNOWN_SYSTEMS): SemanticRuntimeGraph {
  const byName = new Map<string, KnownSystem>();
  for (const s of systems) byName.set(s.name, s);

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const pushEdge = (from: string, to: string, type: GraphEdgeType) => {
    if (from === to) return;
    const key = `${from}→${to}|${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, type });
  };

  // 1. neighbor edges (gerichtet)
  for (const s of systems) {
    for (const n of s.neighbors ?? []) {
      pushEdge(s.name, n, 'neighbor');
    }
  }
  // 2. event edges: Producer von event → alle Konsumenten via touches/neighbors
  //    Heuristik: Systeme, die dasselbe event_contract auflisten, sind verknüpft.
  const eventToProducers = new Map<string, string[]>();
  for (const s of systems) {
    for (const e of s.event_contracts ?? []) {
      if (!eventToProducers.has(e)) eventToProducers.set(e, []);
      eventToProducers.get(e)!.push(s.name);
    }
  }
  // 3. audit edges: System mit audit_actions → auto_heal_log
  for (const s of systems) {
    if ((s.audit_actions?.length ?? 0) > 0 && byName.has('auto_heal_log')) {
      pushEdge(s.name, 'auto_heal_log', 'audit');
    }
  }

  // sort edges deterministisch
  edges.sort((a, b) =>
    a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type),
  );

  // Adjazenz-Aufbau
  const outAdj = new Map<string, Set<string>>();
  const inAdj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!outAdj.has(e.from)) outAdj.set(e.from, new Set());
    if (!inAdj.has(e.to)) inAdj.set(e.to, new Set());
    outAdj.get(e.from)!.add(e.to);
    inAdj.get(e.to)!.add(e.from);
  }

  const nodes: GraphNode[] = systems
    .map((s) => {
      const out = outAdj.get(s.name)?.size ?? 0;
      const inc = inAdj.get(s.name)?.size ?? 0;
      return {
        id: s.name,
        name: s.name,
        kind: s.kind,
        domain: s.domain,
        ownership: s.ownership,
        governance_tier: s.governance_tier,
        degree_in: inc,
        degree_out: out,
        degree_total: inc + out,
        is_orphan: inc === 0 && out === 0,
        healability_score: healabilityScore(s),
        has_drift_signal: Boolean(s.drift_context?.drift_signal),
        emits_count: (s.event_contracts ?? []).length,
        audit_count: (s.audit_actions ?? []).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Cascade-Reach: BFS über out-Edges
  const reach = (start: string): string[] => {
    const visited = new Set<string>([start]);
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const n of outAdj.get(cur) ?? []) {
        if (!visited.has(n)) {
          visited.add(n);
          stack.push(n);
        }
      }
    }
    visited.delete(start);
    return [...visited].sort();
  };

  // Top-Cascade-Risks: nur core/extension mit reach >= 3
  const cascadeRisks: CascadeRisk[] = nodes
    .filter((n) => n.governance_tier !== 'helper')
    .map((n) => {
      const downstream = reach(n.name);
      return {
        node: n.name,
        downstream_reach: downstream.length,
        downstream_sample: downstream.slice(0, 5),
      };
    })
    .filter((r) => r.downstream_reach >= 3)
    .sort((a, b) => b.downstream_reach - a.downstream_reach || a.node.localeCompare(b.node))
    .slice(0, 10);

  const hubs = nodes
    .filter((n) => n.degree_total >= 3)
    .map((n) => ({ node: n.name, degree: n.degree_total }))
    .sort((a, b) => b.degree - a.degree || a.node.localeCompare(b.node))
    .slice(0, 8);

  const orphans = nodes.filter((n) => n.is_orphan).map((n) => n.name);

  const unhealable = systems
    .map((s) => ({ node: s.name, score: healabilityScore(s), missing: missingHealAspects(s) }))
    .filter((x) => x.score < 5)
    .sort((a, b) => a.score - b.score || a.node.localeCompare(b.node));

  // Cross-Domain-Coupling: neighbor-Edge zwischen unterschiedlichen Domains (ohne explizite Bridge)
  const crossDomain: GraphMetrics['cross_domain_coupling'] = [];
  for (const e of edges) {
    if (e.type !== 'neighbor') continue;
    const from = byName.get(e.from);
    const to = byName.get(e.to);
    if (!from || !to) continue;
    if (from.domain && to.domain && from.domain !== to.domain) {
      crossDomain.push({
        from: e.from,
        to: e.to,
        from_domain: from.domain,
        to_domain: to.domain,
      });
    }
  }
  crossDomain.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const domains: Record<string, number> = {};
  for (const n of nodes) {
    const d = n.domain ?? '_unset';
    domains[d] = (domains[d] ?? 0) + 1;
  }

  const metrics: GraphMetrics = {
    total_nodes: nodes.length,
    total_edges: edges.length,
    total_neighbor_edges: edges.filter((e) => e.type === 'neighbor').length,
    total_event_edges: edges.filter((e) => e.type === 'event').length,
    total_audit_edges: edges.filter((e) => e.type === 'audit').length,
    domains,
    orphans,
    hubs,
    cascade_risks: cascadeRisks,
    unhealable,
    cross_domain_coupling: crossDomain,
  };

  return { nodes, edges, metrics };
}
