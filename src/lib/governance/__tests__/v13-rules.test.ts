/**
 * Architectural Continuity Guard v1.3 — neue Regeln Tests
 */
import { describe, it, expect } from 'vitest';
import { reviewArchitecture, type ArchitectureProposal } from '../architecture-review';

describe('architecture-review v1.3 — HEALABILITY_IS_REQUIRED', () => {
  it('blockt RPC mit Mutationspfad ohne Healability-Profil', () => {
    const p: ArchitectureProposal = {
      kind: 'rpc',
      name: 'admin_do_mutation',
      purpose: 'Mutiert State.',
      tags: ['ops'],
      hasAuditContract: true,
      hasStopCondition: true,
      hasEligibilityGate: true,
      usesHasRole: true,
      rlsStatus: 'not_applicable',
    };
    const r = reviewArchitecture(p);
    const heal = r.findings.find((f) => f.rule === 'HEALABILITY_IS_REQUIRED');
    expect(heal).toBeDefined();
    expect(heal!.severity).toBe('block');
    expect(r.verdict).toBe('blocked');
  });

  it('approved RPC mit vollem Healability-Profil', () => {
    const p: ArchitectureProposal = {
      kind: 'rpc',
      name: 'admin_safe_op',
      purpose: 'Heilbarer Mutationspfad.',
      tags: ['ops'],
      hasAuditContract: true,
      hasStopCondition: true,
      hasEligibilityGate: true,
      usesHasRole: true,
      rlsStatus: 'not_applicable',
      healability: {
        replayable: true,
        recoverable: true,
        auditable: true,
        observable: true,
        drift_detectable: true,
      },
    };
    const r = reviewArchitecture(p);
    expect(r.findings.find((f) => f.rule === 'HEALABILITY_IS_REQUIRED')).toBeUndefined();
  });

  it('Views ohne Healability werden NICHT geblockt (kein Mutationspfad)', () => {
    const p: ArchitectureProposal = {
      kind: 'view',
      name: 'v_pure_read',
      purpose: 'Read-only View.',
      tags: ['view'],
      rlsStatus: 'not_applicable',
      usesHasRole: true,
    };
    const r = reviewArchitecture(p);
    expect(r.findings.find((f) => f.rule === 'HEALABILITY_IS_REQUIRED')).toBeUndefined();
  });
});

describe('architecture-review v1.3 — EVENT_DRIVEN_BY_DEFAULT', () => {
  it('warnt bei Cross-Domain-Touches ohne Event-Contract', () => {
    const p: ArchitectureProposal = {
      kind: 'rpc',
      name: 'cross_domain_op',
      purpose: 'Schreibt in Marketing und Notifications direkt.',
      tags: ['ops'],
      touches: ['learner_course_grants', 'notification_events'],
      hasAuditContract: true,
      hasStopCondition: true,
      hasEligibilityGate: true,
      usesHasRole: true,
      rlsStatus: 'not_applicable',
      healability: {
        replayable: true, recoverable: true, auditable: true, observable: true, drift_detectable: true,
      },
    };
    const r = reviewArchitecture(p);
    const ev = r.findings.find((f) => f.rule === 'EVENT_DRIVEN_BY_DEFAULT');
    expect(ev).toBeDefined();
    expect(ev!.severity).toBe('warn');
  });

  it('keine Warnung wenn isBridgeAdapter=true', () => {
    const p: ArchitectureProposal = {
      kind: 'view',
      name: 'v_bridge',
      purpose: 'Bridge zwischen Domains.',
      tags: ['bridge'],
      touches: ['learner_course_grants', 'notification_events'],
      isBridgeAdapter: true,
      rlsStatus: 'not_applicable',
      usesHasRole: true,
    };
    const r = reviewArchitecture(p);
    expect(r.findings.find((f) => f.rule === 'EVENT_DRIVEN_BY_DEFAULT')).toBeUndefined();
  });

  it('keine Warnung wenn emits_events gesetzt', () => {
    const p: ArchitectureProposal = {
      kind: 'rpc',
      name: 'good_op',
      purpose: 'Cross-Domain via Event.',
      tags: ['ops'],
      touches: ['learner_course_grants', 'notification_events'],
      emits_events: ['grant_activated'],
      hasAuditContract: true,
      hasStopCondition: true,
      hasEligibilityGate: true,
      usesHasRole: true,
      rlsStatus: 'not_applicable',
      healability: {
        replayable: true, recoverable: true, auditable: true, observable: true, drift_detectable: true,
      },
    };
    const r = reviewArchitecture(p);
    expect(r.findings.find((f) => f.rule === 'EVENT_DRIVEN_BY_DEFAULT')).toBeUndefined();
  });
});
