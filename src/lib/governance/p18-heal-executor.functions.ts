/**
 * P18 Cut 2 — Bounded Heal Executor (SERVER/RPC-Bridge)
 *
 * Diese Datei DARF Supabase-Imports haben — sie ist der einzige Ort,
 * an dem P18-Mutationen (RPCs auf p18_idempotency_ledger + fn_emit_audit)
 * ausgelöst werden.
 *
 * Sie ruft AUSSCHLIESSLICH SECURITY DEFINER RPCs:
 *   - admin_p18_record_detection
 *   - admin_p18_request_heal
 *   - admin_p18_mark_healed
 *   - admin_get_p18_ledger
 *
 * Sie schreibt KEINE Tabelle direkt. Sie schreibt KEIN known-systems.ts.
 * Sie ruft KEINE eigenen Audit-Pfade (alles via fn_emit_audit in den RPCs).
 */

import { supabase } from '@/integrations/supabase/client';
import {
  validateP18HealRequest,
  isP18HealActionAllowed,
  deriveAllowedHealActions,
  type HealAction,
  type HealRequest,
} from './p18-heal-policy';
import type { DriftSignal } from './p18-orchestrator';

export interface LedgerRow {
  idempotency_key: string;
  drift_type: string;
  trigger_source: string;
  target_fingerprint: string;
  policy_version: string;
  time_bucket: string;
  status: 'detected' | 'escalated' | 'heal_requested' | 'healed' | 'rejected' | 'suppressed';
  severity: 'block' | 'warn' | 'info';
  verdict: string;
  finding_count: number;
  matched_system_ids: string[];
  allowed_actions: string[];
  last_action: string | null;
  action_reason: string | null;
  created_at: string;
  updated_at: string;
}

function timeBucket(detectedAtIso: string): string {
  return detectedAtIso.slice(0, 10);
}

function verdictForSeverity(s: DriftSignal['severity']): string {
  if (s === 'block') return 'review_required';
  if (s === 'warn') return 'review';
  return 'observe';
}

/** Schreibt eine Detection idempotent ins Ledger (admin-only RPC). */
export async function recordP18Detection(drift: DriftSignal): Promise<LedgerRow> {
  const allowed = deriveAllowedHealActions(drift);
  const payload = {
    idempotency_key: drift.idempotency_key,
    drift_type: drift.drift_type,
    trigger_source: drift.trigger,
    target_fingerprint: drift.evidence.target_fingerprint,
    policy_version: drift.policy_version,
    time_bucket: timeBucket(drift.detected_at),
    severity: drift.severity,
    verdict: verdictForSeverity(drift.severity),
    finding_count: 1,
    matched_system_ids: drift.evidence.matched_systems,
    allowed_actions: allowed,
  };
  const { data, error } = await supabase.rpc('admin_p18_record_detection', { p_drift: payload });
  if (error) throw error;
  return data as unknown as LedgerRow;
}

/** Fordert eine bounded Heal-Aktion an. Pure Validierung läuft client-seitig vorab. */
export async function requestP18Heal(req: HealRequest): Promise<LedgerRow> {
  const v = validateP18HealRequest(req);
  if (!v.ok) throw new Error(v.error);
  const { data, error } = await supabase.rpc('admin_p18_request_heal', {
    p_idempotency_key: req.idempotency_key,
    p_action: req.action,
    p_reason: req.reason.trim(),
  });
  if (error) throw error;
  return data as unknown as LedgerRow;
}

/** Markiert eine bounded Heal-Aktion als abgeschlossen / abgelehnt. */
export async function markP18Healed(
  idempotency_key: string,
  action: string,
  result_status: 'healed' | 'rejected',
): Promise<LedgerRow> {
  if (!isP18HealActionAllowed(action)) {
    throw new Error(`action "${action}" not in P18 whitelist`);
  }
  const { data, error } = await supabase.rpc('admin_p18_mark_healed', {
    p_idempotency_key: idempotency_key,
    p_action: action,
    p_result_status: result_status,
  });
  if (error) throw error;
  return data as unknown as LedgerRow;
}

/** Liest Ledger-Zeilen (admin-only, read-only RPC). */
export async function listP18Ledger(opts: {
  limit?: number;
  status?: LedgerRow['status'] | null;
  drift_type?: string | null;
} = {}): Promise<LedgerRow[]> {
  const { data, error } = await supabase.rpc('admin_get_p18_ledger', {
    p_limit: opts.limit ?? 100,
    p_status: opts.status ?? undefined,
    p_drift_type: opts.drift_type ?? undefined,
  });
  if (error) throw error;
  return (data ?? []) as unknown as LedgerRow[];
}

export type { HealAction };
