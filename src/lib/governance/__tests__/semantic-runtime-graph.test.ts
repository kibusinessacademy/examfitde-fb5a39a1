import { describe, it, expect } from 'vitest';
import {
  deriveSemanticRuntimeGraph,
} from '../semantic-runtime-graph';
import { KNOWN_SYSTEMS } from '../known-systems';

describe('semantic-runtime-graph v1.3', () => {
  it('derivation ist deterministisch (gleicher Input → gleicher Output)', () => {
    const a = deriveSemanticRuntimeGraph();
    const b = deriveSemanticRuntimeGraph();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('jeder KNOWN_SYSTEMS-Eintrag ist als Node enthalten', () => {
    const g = deriveSemanticRuntimeGraph();
    expect(g.nodes.length).toBe(KNOWN_SYSTEMS.length);
    for (const s of KNOWN_SYSTEMS) {
      expect(g.nodes.find((n) => n.name === s.name)).toBeDefined();
    }
  });

  it('auto_heal_log ist Audit-Hub (eingehende audit-Edges > 0)', () => {
    const g = deriveSemanticRuntimeGraph();
    const audit = g.edges.filter((e) => e.type === 'audit' && e.to === 'auto_heal_log');
    expect(audit.length).toBeGreaterThan(0);
  });

  it('Cascade-Risks sind nach reach absteigend sortiert', () => {
    const g = deriveSemanticRuntimeGraph();
    for (let i = 1; i < g.metrics.cascade_risks.length; i++) {
      expect(g.metrics.cascade_risks[i - 1].downstream_reach).toBeGreaterThanOrEqual(
        g.metrics.cascade_risks[i].downstream_reach,
      );
    }
  });

  it('cross_domain_coupling enthält keine same-domain Edges', () => {
    const g = deriveSemanticRuntimeGraph();
    for (const c of g.metrics.cross_domain_coupling) {
      expect(c.from_domain).not.toBe(c.to_domain);
    }
  });

  it('isolierter Test-System mit leeren Metadaten gilt als Orphan', () => {
    const g = deriveSemanticRuntimeGraph([
      {
        kind: 'table',
        name: 'lonely_table',
        purpose: 'no neighbors',
        tags: [],
      },
    ]);
    expect(g.metrics.orphans).toContain('lonely_table');
  });

  it('System mit fehlender Healability landet in unhealable', () => {
    const g = deriveSemanticRuntimeGraph([
      {
        kind: 'table',
        name: 'no_heal',
        purpose: 'x',
        tags: [],
      },
    ]);
    expect(g.metrics.unhealable.find((u) => u.node === 'no_heal')?.score).toBe(0);
  });
});
