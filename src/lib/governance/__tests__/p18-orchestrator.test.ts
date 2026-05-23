/**
 * P18 Cut 1 — Detection + Classification + Evidence
 *
 * Pure-Layer Tests. Keine DB. Keine Supabase-Imports. Deterministisch.
 */
import { describe, it, expect } from 'vitest';
import {
  runP18Cut1,
  detectFromKnownSystemsChange,
  detectFromArchitectureReview,
  isTriggerActive,
  P18_ACTIVE_TRIGGERS,
  fingerprint,
} from '../p18-orchestrator';
import { reviewArchitecture, type ArchitectureProposal } from '../architecture-review';
import type { KnownSystem } from '../known-systems';

const FIXED_NOW = new Date('2026-05-23T00:00:00.000Z');

describe('P18 Cut 1 — Trigger-Topologie', () => {
  it('aktiviert exakt 2 Trigger', () => {
    expect(P18_ACTIVE_TRIGGERS).toEqual(['known-systems-change', 'architecture-review-done']);
  });

  it('isTriggerActive: nur Cut-1-Trigger erlaubt', () => {
    expect(isTriggerActive('known-systems-change')).toBe(true);
    expect(isTriggerActive('architecture-review-done')).toBe(true);
    expect(isTriggerActive('static-guard-failed')).toBe(false);
    expect(isTriggerActive('runtime-anomaly-detected')).toBe(false);
    expect(isTriggerActive('memory-sync-drift')).toBe(false);
    expect(isTriggerActive('semantic-runtime-conflict')).toBe(false);
  });
});

describe('P18 Cut 1 — fingerprint', () => {
  it('ist deterministisch & stabil', () => {
    expect(fingerprint('foo')).toBe(fingerprint('foo'));
    expect(fingerprint('foo')).not.toBe(fingerprint('bar'));
    // 8 hex chars
    expect(fingerprint('x')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('P18 Cut 1 — known-systems-change Detection', () => {
  it('detected duplicate_registration als block', () => {
    const dup: KnownSystem[] = [
      { kind: 'table', name: 'dup_x', purpose: 'a', tags: [], domain: 'audit', neighbors: ['y'] },
      { kind: 'table', name: 'dup_x', purpose: 'b', tags: [], domain: 'audit', neighbors: ['y'] },
    ];
    const sig = detectFromKnownSystemsChange({ systems: dup, now: FIXED_NOW });
    const dupSig = sig.find((s) => s.drift_type === 'duplicate_registration');
    expect(dupSig).toBeDefined();
    expect(dupSig!.severity).toBe('block');
    expect(dupSig!.evidence.escalation_target).toBe('human-architect');
  });

  it('detected healability_missing für Mutationspfad ohne healing_context', () => {
    const sys: KnownSystem[] = [
      { kind: 'table', name: 'no_heal_table', purpose: 'mut', tags: [], neighbors: ['x'] },
    ];
    const sig = detectFromKnownSystemsChange({ systems: sys, now: FIXED_NOW });
    expect(sig.find((s) => s.drift_type === 'healability_missing')).toBeDefined();
  });

  it('keine healability_missing für views/registries', () => {
    const sys: KnownSystem[] = [
      { kind: 'view', name: 'v_pure', purpose: 'read', tags: [], neighbors: ['x'] },
      { kind: 'registry', name: 'r_pure', purpose: 'list', tags: [], neighbors: ['x'] },
    ];
    const sig = detectFromKnownSystemsChange({ systems: sys, now: FIXED_NOW });
    expect(sig.find((s) => s.drift_type === 'healability_missing')).toBeUndefined();
  });

  it('detected orphan_node bei fehlenden neighbors+events+audit', () => {
    const sys: KnownSystem[] = [
      { kind: 'view', name: 'lonely_view', purpose: 'x', tags: [] },
    ];
    const sig = detectFromKnownSystemsChange({ systems: sys, now: FIXED_NOW });
    const orphan = sig.find((s) => s.drift_type === 'orphan_node');
    expect(orphan).toBeDefined();
    expect(orphan!.severity).toBe('info');
  });

  it('detected cross_domain_unbridged ohne event_contracts', () => {
    const sys: KnownSystem[] = [
      {
        kind: 'table', name: 'a', purpose: 'a', tags: [],
        domain: 'marketing', neighbors: ['b'],
        healing_context: { replayable: true, recoverable: true, auditable: true, observable: true, drift_detectable: true },
      },
      {
        kind: 'table', name: 'b', purpose: 'b', tags: [],
        domain: 'license', neighbors: ['a'],
        healing_context: { replayable: true, recoverable: true, auditable: true, observable: true, drift_detectable: true },
      },
    ];
    const sig = detectFromKnownSystemsChange({ systems: sys, now: FIXED_NOW });
    const x = sig.filter((s) => s.drift_type === 'cross_domain_unbridged');
    // Genau eine Kante (deduped)
    expect(x.length).toBe(1);
    expect(x[0].severity).toBe('warn');
  });

  it('keine cross_domain_unbridged wenn ein Knoten event_contracts hat', () => {
    const sys: KnownSystem[] = [
      {
        kind: 'table', name: 'a', purpose: 'a', tags: [],
        domain: 'marketing', neighbors: ['b'], event_contracts: ['e'],
        healing_context: { replayable: true, recoverable: true, auditable: true, observable: true, drift_detectable: true },
      },
      {
        kind: 'table', name: 'b', purpose: 'b', tags: [],
        domain: 'license', neighbors: ['a'],
        healing_context: { replayable: true, recoverable: true, auditable: true, observable: true, drift_detectable: true },
      },
    ];
    const sig = detectFromKnownSystemsChange({ systems: sys, now: FIXED_NOW });
    expect(sig.find((s) => s.drift_type === 'cross_domain_unbridged')).toBeUndefined();
  });

  it('läuft auch ohne Input gegen reale KNOWN_SYSTEMS-Registry', () => {
    const sig = detectFromKnownSystemsChange({ now: FIXED_NOW });
    expect(Array.isArray(sig)).toBe(true);
    // Output muss komplett gültige Signale liefern (Pflichtfelder)
    for (const s of sig) {
      expect(s.policy_version).toBe('p18-cut1.v1.0');
      expect(s.idempotency_key).toMatch(/^p18:/);
      expect(s.evidence.target_fingerprint).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe('P18 Cut 1 — architecture-review-done Detection', () => {
  it('mappt NO_PARALLEL_SYSTEMS → ssot_conflict (block)', () => {
    const proposal: ArchitectureProposal = {
      kind: 'audit_log',
      name: 'marketing_audit_log',
      purpose: 'separate audit',
      tags: ['audit'],
      proposed_tables: ['marketing_audit_log'],
    };
    const review = reviewArchitecture(proposal);
    const sig = detectFromArchitectureReview({ review, now: FIXED_NOW });
    const ssot = sig.find((s) => s.drift_type === 'ssot_conflict');
    expect(ssot).toBeDefined();
    expect(ssot!.severity).toBe('block');
    expect(ssot!.evidence.escalation_target).toBe('human-architect');
  });

  it('mappt HEALABILITY_IS_REQUIRED → healability_missing', () => {
    const proposal: ArchitectureProposal = {
      kind: 'rpc',
      name: 'admin_unsafe',
      purpose: 'mutate',
      tags: ['ops'],
      hasAuditContract: true, hasStopCondition: true, hasEligibilityGate: true,
      usesHasRole: true, rlsStatus: 'not_applicable',
    };
    const review = reviewArchitecture(proposal);
    const sig = detectFromArchitectureReview({ review, now: FIXED_NOW });
    expect(sig.find((s) => s.drift_type === 'healability_missing')).toBeDefined();
  });
});

describe('P18 Cut 1 — runP18Cut1 Aggregator', () => {
  it('ist deterministisch (gleicher Input → gleicher Output)', () => {
    const proposal: ArchitectureProposal = {
      kind: 'queue', name: 'email_outbox', purpose: 'Outbox', tags: ['email', 'queue'],
      proposed_tables: ['email_outbox'],
    };
    const review = reviewArchitecture(proposal);
    const a = runP18Cut1({ architectureReviewDone: { review }, now: FIXED_NOW });
    const b = runP18Cut1({ architectureReviewDone: { review }, now: FIXED_NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('Idempotency-Key dedupliziert über Trigger-Quellen', () => {
    const proposal: ArchitectureProposal = {
      kind: 'queue', name: 'email_outbox', purpose: 'Outbox', tags: ['email', 'queue'],
    };
    const review = reviewArchitecture(proposal);
    const result = runP18Cut1({
      knownSystemsChange: { systems: [], now: FIXED_NOW },
      architectureReviewDone: { review },
      now: FIXED_NOW,
    });
    const keys = result.signals.map((s) => s.idempotency_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('summary aggregiert by_severity / by_trigger korrekt', () => {
    const proposal: ArchitectureProposal = {
      kind: 'audit_log', name: 'x_audit', purpose: 'x', tags: ['audit'],
      proposed_tables: ['x_audit'],
    };
    const review = reviewArchitecture(proposal);
    const r = runP18Cut1({ architectureReviewDone: { review }, now: FIXED_NOW });
    expect(r.summary.total).toBe(r.signals.length);
    expect(r.summary.by_trigger['architecture-review-done']).toBe(r.signals.length);
    expect(r.summary.by_trigger['known-systems-change']).toBe(0);
  });

  it('policy_version + active_triggers sind im Result enthalten', () => {
    const r = runP18Cut1({ now: FIXED_NOW });
    expect(r.policy_version).toBe('p18-cut1.v1.0');
    expect(r.active_triggers).toEqual(['known-systems-change', 'architecture-review-done']);
  });
});

describe('P18 Cut 1 — Pureness Contract', () => {
  it('Modul hat keine Supabase-/DB-Imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/governance/p18-orchestrator.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/@\/integrations\/supabase/);
    expect(src).not.toMatch(/from ['"]@supabase\/supabase-js['"]/);
    expect(src).not.toMatch(/fn_emit_audit/);
    // Cut 1 darf keinen "Heal"-Action-Pfad einbauen
    expect(src).not.toMatch(/INSERT\s+INTO/i);
  });
});
