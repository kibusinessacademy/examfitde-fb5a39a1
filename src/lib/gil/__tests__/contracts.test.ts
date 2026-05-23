import { describe, it, expect } from 'vitest';
import {
  GIL_AGENT_CONTRACTS,
  GIL_AGENT_KINDS,
  isInsightTypeAllowed,
} from '../contracts';
import { GIL_STAGES, GIL_ACT_WHITELIST } from '../pipeline';
import { GIL_SCAFFOLD_MANIFEST_V1, validateManifest } from '../manifest';

describe('P19 GIL — contracts', () => {
  it('has 6 agents', () => {
    expect(GIL_AGENT_KINDS).toHaveLength(6);
  });

  it('only executive_director can produce briefings', () => {
    const briefers = GIL_AGENT_KINDS.filter((k) => GIL_AGENT_CONTRACTS[k].canProduceBriefings);
    expect(briefers).toEqual(['executive_director']);
  });

  it('insight type whitelist enforces contract', () => {
    expect(isInsightTypeAllowed('seo_intelligence', 'serp_drop_observed')).toBe(true);
    expect(isInsightTypeAllowed('seo_intelligence', 'rogue_action')).toBe(false);
    expect(isInsightTypeAllowed('product_intelligence', 'serp_drop_observed')).toBe(false);
  });

  it('every agent has a non-empty mission and allowed insight types', () => {
    for (const k of GIL_AGENT_KINDS) {
      const c = GIL_AGENT_CONTRACTS[k];
      expect(c.mission.length).toBeGreaterThan(10);
      // executive_director may have a thinner whitelist; others must have ≥3
      if (k !== 'executive_director') expect(c.allowedInsightTypes.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('P19 GIL — pipeline', () => {
  it('has 8 ordered stages', () => {
    expect(GIL_STAGES).toEqual([
      'collect',
      'normalize',
      'classify',
      'enrich',
      'link',
      'score',
      'detect',
      'act',
    ]);
  });

  it('act whitelist is bounded (no autonomous mutation)', () => {
    expect(GIL_ACT_WHITELIST).toEqual([
      'record_market_signal',
      'record_agent_insight',
      'record_growth_briefing',
      'emit_governance_audit',
    ]);
  });
});

describe('P19 GIL — scaffold manifest', () => {
  it('v1 validates', () => {
    expect(validateManifest(GIL_SCAFFOLD_MANIFEST_V1)).toEqual({ ok: true });
  });

  it('covers all 6 agents', () => {
    for (const k of GIL_AGENT_KINDS) {
      expect(GIL_SCAFFOLD_MANIFEST_V1.agents[k]).toBeDefined();
    }
  });
});
