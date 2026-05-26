/**
 * P70.2 — Background Agent Cockpit Actions: Contract Tests
 *
 * Invariants (must hold forever):
 *  - Action resolver is capability/status/risk/approval gated.
 *  - Only existing dispatchers are referenced (no new runtime/queue/table).
 *  - Client never reads source tables directly (no supabase.from('job_queue') etc.).
 *  - All mutating actions route through admin_background_agent_dispatch_action.
 *  - Dangerous actions are flagged dangerous=true (UI must confirm).
 *  - Audit trail: SQL emits fn_emit_audit('background_agent_action_dispatched').
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveBackgroundAgentActions,
  isNavigationAction,
  type BackgroundTaskLike,
} from '@/lib/governance/backgroundAgentActions';

const ROOT = resolve(__dirname, '../..');
const COCKPIT = resolve(ROOT, 'pages/admin/governance/BackgroundAgentRuntimePage.tsx');
const RESOLVER = resolve(ROOT, 'lib/governance/backgroundAgentActions.ts');
const MIG_DIR = resolve(ROOT, '../supabase/migrations');

function loadDispatchMigration(): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql'));
  let combined = '';
  for (const f of files) {
    const sql = readFileSync(resolve(MIG_DIR, f), 'utf-8');
    if (sql.includes('admin_background_agent_dispatch_action')) {
      combined += '\n-- FILE: ' + f + '\n' + sql;
    }
  }
  if (!combined) throw new Error('P70.2 dispatch migration not found');
  return combined;
}

const PAGE = readFileSync(COCKPIT, 'utf-8');
const RESOLVER_SRC = readFileSync(RESOLVER, 'utf-8');
const SQL = loadDispatchMigration();

const ALLOWED_SOURCES = [
  'job_queue',
  'system_intents',
  'berufs_ki_agent_runs',
  'runtime_action_results',
  'heal_permanent_fix_tasks',
];

function task(p: Partial<BackgroundTaskLike>): BackgroundTaskLike {
  return {
    source_type: 'job_queue',
    source_id: 'fake-id',
    status: 'queued',
    risk_level: 'low',
    approval_state: 'not_required',
    artifact_count: 0,
    package_id: 'pkg-1',
    capability_summary: 'demo',
    ...p,
  };
}

describe('P70.2 — Action resolver: visibility & gating', () => {
  it('open_source is always present', () => {
    for (const src of ALLOWED_SOURCES) {
      const a = resolveBackgroundAgentActions(task({ source_type: src }));
      expect(a.some((x) => x.action === 'open_source')).toBe(true);
    }
  });

  it('open_artifacts only when artifact_count > 0', () => {
    expect(
      resolveBackgroundAgentActions(task({ artifact_count: 0 })).some((x) => x.action === 'open_artifacts'),
    ).toBe(false);
    expect(
      resolveBackgroundAgentActions(task({ artifact_count: 3 })).some((x) => x.action === 'open_artifacts'),
    ).toBe(true);
  });

  it('open_approval only when approval_state=pending', () => {
    expect(
      resolveBackgroundAgentActions(task({ approval_state: 'not_required' })).some((x) => x.action === 'open_approval'),
    ).toBe(false);
    expect(
      resolveBackgroundAgentActions(task({ approval_state: 'pending' })).some((x) => x.action === 'open_approval'),
    ).toBe(true);
  });

  it('retry only enabled on failed/cancelled/blocked job_queue rows', () => {
    const failed = resolveBackgroundAgentActions(task({ status: 'failed' })).find((x) => x.action === 'retry');
    const running = resolveBackgroundAgentActions(task({ status: 'processing' })).find((x) => x.action === 'retry');
    expect(failed?.enabled).toBe(true);
    expect(running?.enabled).toBe(false);
    expect(running?.reason).toMatch(/Retry nur bei failed/);
  });

  it('cancel only enabled on active states and is dangerous', () => {
    const queued = resolveBackgroundAgentActions(task({ status: 'queued' })).find((x) => x.action === 'cancel');
    const done = resolveBackgroundAgentActions(task({ status: 'completed' })).find((x) => x.action === 'cancel');
    expect(queued?.enabled).toBe(true);
    expect(queued?.dangerous).toBe(true);
    expect(done?.enabled).toBe(false);
  });

  it('retry is disabled when approval is pending (gating)', () => {
    const a = resolveBackgroundAgentActions(
      task({ status: 'failed', approval_state: 'pending' }),
    ).find((x) => x.action === 'retry');
    expect(a?.enabled).toBe(false);
    expect(a?.approvalRequired).toBe(true);
  });

  it('high-risk retry stays dangerous=true', () => {
    const a = resolveBackgroundAgentActions(
      task({ status: 'failed', risk_level: 'high' }),
    ).find((x) => x.action === 'retry');
    expect(a?.dangerous).toBe(true);
  });

  it('system_intents has navigation-only actions (no retry/cancel/approve)', () => {
    const actions = resolveBackgroundAgentActions(
      task({ source_type: 'system_intents', status: 'failed' }),
    );
    for (const a of actions) {
      expect(isNavigationAction(a.action)).toBe(true);
    }
  });

  it('runtime_action_results and heal_permanent_fix_tasks have no mutating actions', () => {
    for (const src of ['runtime_action_results', 'heal_permanent_fix_tasks']) {
      const actions = resolveBackgroundAgentActions(
        task({ source_type: src, status: 'failed', approval_state: 'pending' }),
      );
      const mutating = actions.filter((a) => !isNavigationAction(a.action));
      expect(mutating, `${src} must not expose mutating actions`).toEqual([]);
    }
  });

  it('berufs_ki_agent_runs approve disabled without package_id', () => {
    const a = resolveBackgroundAgentActions(
      task({ source_type: 'berufs_ki_agent_runs', approval_state: 'pending', package_id: null }),
    ).find((x) => x.action === 'approve');
    expect(a?.enabled).toBe(false);
    expect(a?.reason).toMatch(/package_id/);
  });

  it('berufs_ki_agent_runs approve is dangerous and approval-required', () => {
    const a = resolveBackgroundAgentActions(
      task({ source_type: 'berufs_ki_agent_runs', approval_state: 'pending', package_id: 'pkg' }),
    ).find((x) => x.action === 'approve');
    expect(a?.enabled).toBe(true);
    expect(a?.dangerous).toBe(true);
    expect(a?.approvalRequired).toBe(true);
  });

  it('nudge appears only for blocked job_queue rows', () => {
    expect(
      resolveBackgroundAgentActions(task({ status: 'blocked' })).some((x) => x.action === 'nudge'),
    ).toBe(true);
    expect(
      resolveBackgroundAgentActions(task({ status: 'queued' })).some((x) => x.action === 'nudge'),
    ).toBe(false);
  });
});

describe('P70.2 — Invariants: no parallel runtime, no direct table reads', () => {
  it('Client uses ONLY the action-dispatch RPC for mutations', () => {
    expect(RESOLVER_SRC).toMatch(/admin_background_agent_dispatch_action/);
    // No direct supabase.from(<source>) in resolver or cockpit
    for (const src of ALLOWED_SOURCES) {
      const pat = new RegExp(`supabase\\.from\\(\\s*['"]${src}['"]`);
      expect(RESOLVER_SRC, `resolver must not read ${src}`).not.toMatch(pat);
      expect(PAGE, `cockpit must not read ${src}`).not.toMatch(pat);
    }
  });

  it('SQL dispatcher routes ONLY into existing dispatchers (no new queue/runtime)', () => {
    expect(SQL).toMatch(/admin_retry_failed_step/);
    expect(SQL).toMatch(/cancel_jobs_for_package/);
    expect(SQL).toMatch(/admin_bronze_manual_approve_for_publish/);
    expect(SQL).toMatch(/admin_nudge_atomic_trigger/);
    // No new tables introduced
    expect(SQL).not.toMatch(/CREATE\s+TABLE\s+public\.\w*(background|agent_action|cockpit)/i);
  });

  it('SQL dispatcher is admin-gated (has_role)', () => {
    expect(SQL).toMatch(/has_role\(\s*v_caller\s*,\s*'admin'/);
  });

  it('SQL dispatcher emits fn_emit_audit on every path', () => {
    const audits = SQL.match(/fn_emit_audit/g) ?? [];
    expect(audits.length).toBeGreaterThanOrEqual(2); // denied + ok branches
    expect(SQL).toMatch(/'background_agent_action_dispatched'/);
  });

  it('audit contract registered with required_keys', () => {
    expect(SQL).toMatch(/INSERT INTO public\.ops_audit_contract/);
    expect(SQL).toMatch(/'background_agent_action_dispatched'/);
    expect(SQL).toMatch(/source_type/);
    expect(SQL).toMatch(/source_id/);
    expect(SQL).toMatch(/action/);
    expect(SQL).toMatch(/route/);
    expect(SQL).toMatch(/outcome/);
  });

  it('Cockpit confirms dangerous actions via AlertDialog', () => {
    expect(PAGE).toMatch(/AlertDialog/);
    expect(PAGE).toMatch(/setPendingDispatch/);
    expect(PAGE).toMatch(/performDispatch/);
  });
});
