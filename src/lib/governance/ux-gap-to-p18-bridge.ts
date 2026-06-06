/**
 * UX-Gap → P18 Drift Bridge (PURE)
 * ────────────────────────────────
 * Reuses the existing P18 ledger contract. We do NOT introduce a parallel
 * UX-finding registry — every UX gap detected by the customer-reality gate,
 * the static surface scanner, or the entry-fallback signal is mapped to a
 * canonical `DriftSignal { drift_type: 'ux_gap', ... }` and pushed through
 * the same `mapP18DriftToGilSignal` bridge that already feeds GIL.
 *
 * Architecture Continuity: BRIDGE_DONT_FORK + EXTEND_ONLY.
 * Pure: no DB, no I/O, no PII. Persistence happens in
 * `p18-heal-executor.functions.ts#recordP18Detection` (existing RPC).
 */

import type {
  DriftSignal,
  DriftSeverity,
  P18TriggerSource,
} from './p18-orchestrator';
import { mapP18DriftToGilSignal, type BridgeMapResult } from './p18-gil-bridge';

export type UxGapSource =
  | 'pre-customer-reality'
  | 'learner-reality'
  | 'static-surface-scan'
  | 'entry-fallback-signal';

export type UxGapSeverity = 'P0' | 'P1' | 'P2';

/** Canonical UX-gap finding produced by the scanner. */
export interface UxGapFinding {
  /** Stable, content-addressed id — used to build idempotency_key. */
  id: string;
  /** Affected surface / route / testid. */
  surface: string;
  /** Short, human-readable why-it's-broken (≤ 280 chars). */
  message: string;
  severity: UxGapSeverity;
  source: UxGapSource;
  /** ISO date this evidence was captured. Defaults to now() in scanner. */
  detected_at: string;
  /** Optional: matched system ids (routes, components) for evidence. */
  matched_systems?: string[];
  /** Optional: recommended action / fix. */
  recommended_action?: string;
}

const SEV_MAP: Record<UxGapSeverity, DriftSeverity> = {
  P0: 'block',
  P1: 'warn',
  P2: 'info',
};

const TRIGGER_MAP: Record<UxGapSource, P18TriggerSource> = {
  'pre-customer-reality': 'architecture-review-done',
  'learner-reality': 'architecture-review-done',
  'static-surface-scan': 'static-guard-failed',
  'entry-fallback-signal': 'runtime-anomaly-detected',
};

const POLICY_VERSION = 'ux-gap-bridge-v1';

function timeBucket(iso: string): string {
  return iso.slice(0, 10);
}

function fingerprint(finding: UxGapFinding): string {
  // Stable hash-ish: surface + id. Avoid PII (no learner ids, no emails).
  return `ux:${finding.surface}:${finding.id}`.replace(/[^a-zA-Z0-9:_\-/]/g, '_').slice(0, 200);
}

/** Build a canonical P18 DriftSignal from a UX-gap finding. PURE. */
export function uxGapToDriftSignal(finding: UxGapFinding): DriftSignal {
  const severity = SEV_MAP[finding.severity];
  const trigger = TRIGGER_MAP[finding.source];
  const target_fp = fingerprint(finding);
  const tb = timeBucket(finding.detected_at);

  return {
    trigger,
    drift_type: 'ux_gap',
    category: 'runtime',
    severity,
    message: finding.message.slice(0, 600),
    evidence: {
      matched_systems: (finding.matched_systems ?? [finding.surface]).slice(0, 12),
      recommended_action:
        finding.recommended_action ??
        `Repair surface "${finding.surface}" so the learner reaches business content.`,
      escalation_target:
        severity === 'block' ? 'human-architect' : severity === 'warn' ? 'auto-bounded-cut2' : 'observe-only',
      target_fingerprint: target_fp,
    },
    idempotency_key: `p18:ux_gap:${target_fp}:${POLICY_VERSION}:${tb}`,
    source_ref: `${finding.source}:${finding.id}`,
    policy_version: POLICY_VERSION,
    detected_at: finding.detected_at,
  };
}

/** Convenience: finding → DriftSignal → GIL bridge draft. */
export function mapUxGapToGil(finding: UxGapFinding): BridgeMapResult {
  const sig = uxGapToDriftSignal(finding);
  return mapP18DriftToGilSignal({
    idempotency_key: sig.idempotency_key,
    drift_type: sig.drift_type,
    severity: sig.severity,
    trigger_source: sig.trigger,
    target_fingerprint: sig.evidence.target_fingerprint,
    policy_version: sig.policy_version,
    matched_system_ids: sig.evidence.matched_systems,
    message: sig.message,
  });
}
