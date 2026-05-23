import { describe, it, expect } from 'vitest';
import { runtimePlanToProposal } from '../runtime-proposal-adapter';
import { reviewArchitecture } from '../architecture-review';

describe('runtime-proposal-adapter v1.2', () => {
  it('mappt eine Runtime-Action ohne Mutation und ist deterministisch (pure function)', () => {
    const plan = {
      action_type: 'enqueue_email_outbox',
      target_type: 'queue' as const,
      target_name: 'email_outbox',
      description: 'Outbox für ausgehende Mails',
      planned_tables: ['email_outbox'],
      planned_jobs: ['email_outbox_dispatch'],
      tags: ['email', 'queue'],
    };
    const a = runtimePlanToProposal(plan);
    const b = runtimePlanToProposal(plan);
    expect(a).toEqual(b);
    expect(a.kind).toBe('queue');
    expect(a.proposed_tables).toEqual(['email_outbox']);
  });

  it('Runtime-Action mit neuer Queue wird durch Review geblockt', () => {
    const plan = {
      action_type: 'enqueue_email_outbox',
      target_name: 'email_outbox',
      description: 'parallel mail outbox',
      planned_tables: ['email_outbox'],
      planned_jobs: ['email_outbox_dispatch'],
      tags: ['email', 'queue'],
    };
    const r = reviewArchitecture(runtimePlanToProposal(plan));
    expect(r.verdict).toBe('blocked');
    expect(r.findings.some((f) => f.required_bridge_target === 'email_delivery_queue')).toBe(true);
  });

  it('Bridge-Intent (View über 2 SSOTs) wird nicht geblockt', () => {
    const plan = {
      action_type: 'create_bridge_view',
      target_type: 'view' as const,
      target_name: 'v_grants_to_notifications_bridge',
      description: 'Bridge zwischen Grants und Notifications',
      touches: ['learner_course_grants', 'notification_events'],
      tags: ['bridge'],
      governance: {
        hasAuditContract: true,
        hasStopCondition: true,
        hasEligibilityGate: true,
        usesHasRole: true,
        rlsStatus: 'not_applicable' as const,
      },
    };
    const r = reviewArchitecture(runtimePlanToProposal(plan));
    expect(r.findings.some((f) => f.severity === 'block')).toBe(false);
  });

  it('Adapter bleibt pure — keine Supabase-Imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/governance/runtime-proposal-adapter.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/@\/integrations\/supabase/);
    expect(src).not.toMatch(/from ['"]@supabase\/supabase-js['"]/);
  });
});
