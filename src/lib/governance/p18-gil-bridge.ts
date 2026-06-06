/**
 * P20 Cut 0B — P18 → GIL Strategic Bridge (PURE)
 *
 * Mappt einen P18-Ledger-/Drift-Eintrag deterministisch auf einen
 * internen GIL-Signal-Draft (signal_type='internal_drift', source='p18').
 *
 * Pure: keine DB, keine Secrets, kein Raw-Proposal-Dump, kein PII.
 * Idempotenz: über `idempotency_key` (= P18-Ledger-Key).
 *
 * Diese Datei mutiert NICHTS. Persistenz erfolgt ausschließlich über
 * den SECURITY DEFINER RPC `admin_bridge_p18_drift_to_gil`.
 */

import type { DriftSignal, DriftSeverity, DriftType } from './p18-orchestrator';

export type GilSignalSeverity = 'info' | 'warning' | 'critical';

export const KNOWN_BRIDGEABLE_DRIFT_TYPES: ReadonlyArray<DriftType> = [
  'ssot_conflict',
  'healability_missing',
  'cross_domain_unbridged',
  'orphan_node',
  'rule_violation',
  'reuse_recommendation',
  'duplicate_registration',
  'ux_gap',
];

const SEV_MAP: Record<DriftSeverity, GilSignalSeverity> = {
  block: 'critical',
  warn: 'warning',
  info: 'info',
};

const CONFIDENCE_MAP: Record<DriftSeverity, number> = {
  block: 0.9,
  warn: 0.7,
  info: 0.5,
};

/** Subset of the P18 ledger row needed by the bridge. */
export interface BridgeInput {
  idempotency_key: string;
  drift_type: string;
  severity: DriftSeverity;
  trigger_source: string;
  target_fingerprint: string;
  policy_version: string;
  matched_system_ids: string[];
  message?: string | null;
  ledger_status?: string | null;
}

export interface GilInternalDriftSignalDraft {
  signal_type: 'internal_drift';
  source: 'p18';
  severity: GilSignalSeverity;
  title: string;
  summary: string;
  payload: {
    drift_type: string;
    idempotency_key: string;
    target_fingerprint: string;
    policy_version: string;
    trigger_source: string;
    matched_system_ids: string[];
    confidence: number;
    evidence_refs: string[];
    /** Tags helfen Filterung im Signal-Feed. */
    tags: string[];
  };
}

export type BridgeMapResult =
  | { ok: true; draft: GilInternalDriftSignalDraft }
  | { ok: false; reason: 'unknown_drift_type' | 'invalid_input'; detail: string };

/** Sanitize message → keine Stack-Traces, keine offensichtlichen Secrets. */
function sanitizeMessage(msg: string | null | undefined, fallback: string): string {
  if (!msg || typeof msg !== 'string') return fallback;
  // Strip likely secret/token-shaped substrings (defensive, kein Hard-Guard).
  const stripped = msg
    .replace(/sb_[a-zA-Z0-9_-]{8,}/g, '[redacted]')
    .replace(/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[redacted]')
    .trim();
  return stripped.length > 0 ? stripped.slice(0, 600) : fallback;
}

export function mapP18DriftToGilSignal(input: BridgeInput): BridgeMapResult {
  if (!input.idempotency_key || !input.target_fingerprint || !input.policy_version) {
    return { ok: false, reason: 'invalid_input', detail: 'required fields missing' };
  }
  const isKnown = (KNOWN_BRIDGEABLE_DRIFT_TYPES as readonly string[]).includes(input.drift_type);
  if (!isKnown) {
    return {
      ok: false,
      reason: 'unknown_drift_type',
      detail: `drift_type "${input.drift_type}" not in bridge whitelist`,
    };
  }

  const severity = SEV_MAP[input.severity] ?? 'info';
  const confidence = CONFIDENCE_MAP[input.severity] ?? 0.5;

  const matched = (input.matched_system_ids ?? []).slice(0, 12);
  const title = `[P18] ${input.drift_type} — ${matched[0] ?? 'system'}`;
  const summary = sanitizeMessage(
    input.message,
    `P18 Drift "${input.drift_type}" auf ${matched.length || 0} System(en) (severity=${input.severity}).`,
  );

  return {
    ok: true,
    draft: {
      signal_type: 'internal_drift',
      source: 'p18',
      severity,
      title: title.slice(0, 200),
      summary,
      payload: {
        drift_type: input.drift_type,
        idempotency_key: input.idempotency_key,
        target_fingerprint: input.target_fingerprint,
        policy_version: input.policy_version,
        trigger_source: input.trigger_source,
        matched_system_ids: matched,
        confidence,
        evidence_refs: [`p18:ledger:${input.idempotency_key}`],
        tags: ['p18', 'internal_drift', input.drift_type],
      },
    },
  };
}

/** Convenience: from a fresh DriftSignal (Cut 1 output) — noch ohne Ledger-Status. */
export function mapDriftSignalToGil(s: DriftSignal): BridgeMapResult {
  return mapP18DriftToGilSignal({
    idempotency_key: s.idempotency_key,
    drift_type: s.drift_type,
    severity: s.severity,
    trigger_source: s.trigger,
    target_fingerprint: s.evidence.target_fingerprint,
    policy_version: s.policy_version,
    matched_system_ids: s.evidence.matched_systems,
    message: s.message,
  });
}
