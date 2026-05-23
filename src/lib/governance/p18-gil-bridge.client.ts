/**
 * P20 Cut 0B — GIL Bridge Client
 *
 * Dünner Wrapper um die SECURITY DEFINER RPCs:
 *   - admin_bridge_p18_drift_to_gil(idempotency_key, reason)
 *   - admin_create_manual_market_signal(...)
 *
 * Schreibt KEINE Tabelle direkt. Reason-Validierung läuft client-seitig vorab.
 */

import { supabase } from '@/integrations/supabase/client';

const rpc = supabase.rpc as unknown as (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: any; error: any }>;

export interface BridgeResult {
  ok: boolean;
  result: 'created' | 'already_exists';
  signal_id: string;
  idempotency_key: string;
  severity?: string;
}

export async function bridgeP18DriftToGil(
  idempotency_key: string,
  reason: string,
): Promise<BridgeResult> {
  if (reason.trim().length < 8) throw new Error('Reason ≥ 8 Zeichen erforderlich');
  const { data, error } = await rpc('admin_bridge_p18_drift_to_gil', {
    p_idempotency_key: idempotency_key,
    p_reason: reason.trim(),
  });
  if (error) throw error;
  return data as BridgeResult;
}

export interface ManualSignalInput {
  signal_type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  summary?: string;
  source: string;
  confidence?: number;
  tags?: string[];
  reason: string;
}

export async function createManualMarketSignal(input: ManualSignalInput): Promise<{
  ok: boolean;
  signal_id: string;
  severity: string;
}> {
  if (input.reason.trim().length < 8) throw new Error('Reason ≥ 8 Zeichen erforderlich');
  if (input.title.trim().length < 3) throw new Error('Titel ≥ 3 Zeichen erforderlich');
  if (input.source.trim().toLowerCase() === 'p18') {
    throw new Error('Quelle "p18" ist für die Bridge reserviert');
  }
  const { data, error } = await rpc('admin_create_manual_market_signal', {
    p_signal_type: input.signal_type,
    p_severity: input.severity,
    p_title: input.title,
    p_summary: input.summary ?? '',
    p_source: input.source,
    p_confidence: input.confidence ?? 0.5,
    p_tags: input.tags ?? [],
    p_reason: input.reason.trim(),
  });
  if (error) throw error;
  return data as { ok: boolean; signal_id: string; severity: string };
}
