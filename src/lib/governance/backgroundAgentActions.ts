/**
 * P70.2 — Background Agent Cockpit Action Resolver
 *
 * Pure, capability-/status-gated resolver. NO direct mutations here.
 * Every "perform" routes through admin RPC `admin_background_agent_dispatch_action`,
 * which itself routes ONLY into existing dispatchers (admin_retry_failed_step,
 * cancel_jobs_for_package, admin_bronze_manual_approve_for_publish,
 * admin_nudge_atomic_trigger) and audits via fn_emit_audit.
 *
 * Invariants (P70.1 + P70.2):
 *  - no new tables
 *  - no new runtime / no new queue
 *  - no direct table reads in client
 *  - no direct source mutation from UI
 */
import { supabase } from '@/integrations/supabase/client';

export type BackgroundAgentSource =
  | 'job_queue'
  | 'system_intents'
  | 'berufs_ki_agent_runs'
  | 'runtime_action_results'
  | 'heal_permanent_fix_tasks';

export type BackgroundAgentAction =
  | 'open_source'
  | 'open_artifacts'
  | 'open_approval'
  | 'retry'
  | 'cancel'
  | 'approve'
  | 'nudge';

export interface BackgroundTaskLike {
  source_type: string;
  source_id: string;
  status: string | null;
  risk_level: string | null;
  approval_state: string | null;
  artifact_count: number | null;
  package_id: string | null;
  capability_summary: string | null;
}

export interface ResolvedAction {
  action: BackgroundAgentAction;
  label: string;
  enabled: boolean;
  /** dangerous = approval-required or destructive; UI must require confirmation. */
  dangerous: boolean;
  /** approvalRequired = action is gated by a separate approval step. */
  approvalRequired: boolean;
  /** Reason rendered in disabled tooltip. */
  reason?: string;
}

const NAVIGATION_ONLY: BackgroundAgentAction[] = ['open_source', 'open_artifacts', 'open_approval'];

/**
 * Pure resolver. Determines which actions are visible/enabled for a task row.
 * No side effects. No network calls.
 */
export function resolveBackgroundAgentActions(task: BackgroundTaskLike): ResolvedAction[] {
  const out: ResolvedAction[] = [];
  const status = (task.status ?? '').toLowerCase();
  const risk = (task.risk_level ?? 'low').toLowerCase();
  const approval = (task.approval_state ?? 'not_required').toLowerCase();
  const src = task.source_type as BackgroundAgentSource;

  // Always available: open source
  out.push({
    action: 'open_source',
    label: 'Quelle öffnen',
    enabled: true,
    dangerous: false,
    approvalRequired: false,
  });

  // Open artifacts if any artifact_count > 0
  if ((task.artifact_count ?? 0) > 0) {
    out.push({
      action: 'open_artifacts',
      label: 'Artefakte',
      enabled: true,
      dangerous: false,
      approvalRequired: false,
    });
  }

  // Open approval surface when pending
  if (approval === 'pending') {
    out.push({
      action: 'open_approval',
      label: 'Approval prüfen',
      enabled: true,
      dangerous: false,
      approvalRequired: true,
    });
  }

  // --- Mutating actions, source-scoped ---

  if (src === 'job_queue') {
    const canRetry = ['failed', 'cancelled', 'blocked'].includes(status);
    out.push({
      action: 'retry',
      label: 'Retry',
      enabled: canRetry && approval !== 'pending',
      dangerous: risk === 'high',
      approvalRequired: approval === 'pending',
      reason: !canRetry ? `Retry nur bei failed/cancelled/blocked (aktuell: ${status || '—'})` : undefined,
    });

    const canCancel = ['queued', 'pending', 'processing', 'blocked'].includes(status);
    out.push({
      action: 'cancel',
      label: 'Cancel',
      enabled: canCancel,
      dangerous: true,
      approvalRequired: risk === 'high',
      reason: !canCancel ? `Cancel nur bei aktiven Jobs (aktuell: ${status || '—'})` : undefined,
    });

    if (status === 'blocked') {
      out.push({
        action: 'nudge',
        label: 'Nudge',
        enabled: true,
        dangerous: false,
        approvalRequired: false,
      });
    }
  } else if (src === 'berufs_ki_agent_runs' && approval === 'pending') {
    out.push({
      action: 'approve',
      label: 'Approve (Bronze-Publish)',
      enabled: !!task.package_id,
      dangerous: true,
      approvalRequired: true,
      reason: !task.package_id ? 'Kein package_id gebunden — Approval nicht möglich' : undefined,
    });
  }
  // system_intents, runtime_action_results, heal_permanent_fix_tasks:
  //   navigation-only by design (no existing mutating dispatcher).

  return out;
}

export function isNavigationAction(a: BackgroundAgentAction): boolean {
  return NAVIGATION_ONLY.includes(a);
}

/**
 * Dispatch a mutating action through the single admin RPC choke point.
 * Throws on RPC error so caller can toast.
 */
export async function dispatchBackgroundAgentAction(
  source_type: BackgroundAgentSource,
  source_id: string,
  action: Exclude<BackgroundAgentAction, 'open_source' | 'open_artifacts' | 'open_approval'>,
  reason?: string,
): Promise<{ ok: boolean; route: string; result?: unknown }> {
  const { data, error } = await supabase.rpc('admin_background_agent_dispatch_action', {
    p_source_type: source_type,
    p_source_id: source_id,
    p_action: action,
    p_reason: reason ?? undefined,
  });
  if (error) throw error;
  return (data ?? { ok: false, route: 'unknown' }) as { ok: boolean; route: string; result?: unknown };
}

