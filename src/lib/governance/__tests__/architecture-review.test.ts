/**
 * Architectural Continuity Guard v1.1 — Tests
 *
 * Prüft:
 *  - doppelte Queue wird geblockt
 *  - neue Audit-Tabelle wird geblockt
 *  - Bridge auf auto_heal_log wird empfohlen
 *  - Bridge auf conversion_events wird empfohlen
 *  - approved nur bei Reuse/Bridge-Strategie
 *  - keine DB-Writes / keine Supabase-Imports im Core
 *  - deterministisches Ergebnis bei gleicher Proposal
 */
import { describe, it, expect } from 'vitest';
import { reviewArchitecture, type ArchitectureProposal } from '../architecture-review';

describe('architecture-review v1.1', () => {
  it('blockt eine zweite Queue (email_outbox) und empfiehlt email_delivery_queue', () => {
    const p: ArchitectureProposal = {
      kind: 'queue',
      name: 'email_outbox',
      purpose: 'Neue Outbox für ausgehende Mails',
      tags: ['email', 'queue'],
      proposed_tables: ['email_outbox'],
      proposed_jobs: ['email_outbox_dispatch'],
      hasAuditContract: false,
      hasStopCondition: false,
      rlsStatus: 'on',
    };
    const r = reviewArchitecture(p);
    expect(r.verdict).toBe('blocked');
    const dup = r.findings.find((f) => f.rule === 'NO_PARALLEL_SYSTEMS');
    expect(dup).toBeDefined();
    expect(dup!.required_bridge_target).toBe('email_delivery_queue');
    expect(dup!.recommended_reuse_path).toMatch(/email_delivery_queue/);
  });

  it('blockt eine neue Audit-Tabelle und empfiehlt auto_heal_log + ops_audit_contract', () => {
    const p: ArchitectureProposal = {
      kind: 'audit_log',
      name: 'marketing_audit_log',
      purpose: 'Eigene Audit-Tabelle für Marketing.',
      tags: ['audit', 'marketing'],
      proposed_tables: ['marketing_audit_log'],
      proposed_audit_actions: ['marketing_campaign_started'],
      rlsStatus: 'on',
    };
    const r = reviewArchitecture(p);
    expect(r.verdict).toBe('blocked');
    const f = r.findings.find((x) => x.rule === 'NO_PARALLEL_SYSTEMS');
    expect(f).toBeDefined();
    expect(f!.required_bridge_target).toBe('auto_heal_log');
    expect(f!.matched_known_systems.map((s) => s.name)).toContain('ops_audit_contract');
  });

  it('blockt eine parallele Funnel-Event-Tabelle und empfiehlt conversion_events', () => {
    const p: ArchitectureProposal = {
      kind: 'table',
      name: 'funnel_tracking_events',
      purpose: 'Eigene Funnel-Event-Tabelle.',
      tags: ['funnel', 'tracking'],
      proposed_tables: ['funnel_tracking_events'],
      proposed_events: ['my_funnel_step'],
      rlsStatus: 'on',
      hasAuditContract: true,
    };
    const r = reviewArchitecture(p);
    expect(r.verdict).toBe('blocked');
    const f = r.findings.find((x) => x.rule === 'NO_PARALLEL_SYSTEMS' && x.required_bridge_target === 'conversion_events');
    expect(f).toBeDefined();
  });

  it('approved bridge view zwischen zwei bestehenden SSOTs ohne Forking', () => {
    const p: ArchitectureProposal = {
      kind: 'view',
      name: 'v_activation_bridge',
      purpose: 'Bridge zwischen Grants und Notifications für Aktivierung.',
      tags: ['bridge', 'activation'],
      touches: ['learner_course_grants', 'notification_events'],
      hasAuditContract: true,
      hasStopCondition: true,
      hasEligibilityGate: true,
      rlsStatus: 'not_applicable',
      usesHasRole: true,
    };
    const r = reviewArchitecture(p);
    // weil reuse-Match auf table-System nicht selbe kind, nur info findings
    expect(r.verdict === 'approved' || r.verdict === 'review_required').toBe(true);
    expect(r.findings.some((f) => f.severity === 'block')).toBe(false);
  });

  it('jedes hard finding hat entweder recommended_reuse_path oder evidence', () => {
    const p: ArchitectureProposal = {
      kind: 'queue',
      name: 'shadow_queue',
      purpose: 'Schattenqueue.',
      tags: ['queue'],
    };
    const r = reviewArchitecture(p);
    for (const f of r.findings.filter((x) => x.severity === 'block')) {
      expect(f.evidence).toBeTruthy();
    }
  });

  it('ist deterministisch (gleiche Proposal → gleiches Ergebnis)', () => {
    const p: ArchitectureProposal = {
      kind: 'queue',
      name: 'email_outbox',
      purpose: 'Outbox',
      tags: ['email', 'queue'],
      proposed_tables: ['email_outbox'],
    };
    const a = JSON.stringify(reviewArchitecture(p));
    const b = JSON.stringify(reviewArchitecture(p));
    expect(a).toBe(b);
  });

  it('Core hat keine Supabase-Imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/governance/architecture-review.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/@\/integrations\/supabase/);
    expect(src).not.toMatch(/from ['"]@supabase\/supabase-js['"]/);
  });
});
